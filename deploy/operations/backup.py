#!/usr/bin/env python3
"""同一 PostgreSQL 快照、媒体清单和部署配置进入一个加密 restic 快照。"""
import argparse
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import stat
import subprocess
import tempfile
import time
from urllib.parse import urlsplit


def run(args, *, env=None, input=None, timeout=1800):
    # 子程序错误可能带连接信息，只向日志返回命令名与退出码。
    result = subprocess.run(args, input=input, capture_output=True, env=env, timeout=timeout)
    if result.returncode:
        raise RuntimeError(f'{Path(args[0]).name} 执行失败（{result.returncode}）')
    return result.stdout


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def private_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    # 显式 chmod 处理 NAS 的继承 ACL；只改本工具自己的文件。
    with tempfile.NamedTemporaryFile(dir=path.parent, mode='w', encoding='utf-8', delete=False) as out:
        os.chmod(out.name, 0o600)
        json.dump(value, out, ensure_ascii=False, indent=2)
        out.write('\n')
        out.flush()
        os.fsync(out.fileno())
    os.replace(out.name, path)


def media_path(root, key):
    root = Path(root).resolve()
    relative = Path(key)
    if not key or relative.is_absolute() or any(p in ('..', '.') for p in key.split('/')) or '\n' in key or '\r' in key:
        raise ValueError('媒体对象路径不合法')
    target = root / relative
    for part in [target, *target.parents]:
        if part == root:
            break
        if part.is_symlink():
            raise ValueError('媒体对象不允许符号链接')
    if not target.is_file() or root not in target.resolve().parents:
        raise ValueError('媒体对象缺失或越界')
    return target


def verify_media(root, rows):
    total = 0
    seen = set()
    for row in rows:
        if row['storage_driver'] != 'local':
            raise ValueError('本脚本只接受已核验的本地文件存储，其他驱动须提供对象版本恢复机制')
        key = row['object_key']
        if key in seen:
            raise ValueError('媒体对象键重复')
        seen.add(key)
        file = media_path(root, key)
        if file.stat().st_size != row['size'] or sha256(file) != row['checksum']:
            raise ValueError('媒体大小或校验值不一致')
        total += row['size']
    return {'count': len(rows), 'bytes': total, 'verified': True}


def validate_repository(config, env):
    repository = env.get('RESTIC_REPOSITORY', '')
    url = urlsplit(repository.removeprefix('rest:'))
    if not repository.startswith('rest:https://') or not url.hostname or url.username or url.password:
        raise ValueError('必须使用独立主机的 HTTPS rest-server；凭据通过受保护的环境注入')
    if url.hostname in ('localhost', '127.0.0.1', '::1', config['source_host']):
        raise ValueError('备份不能只位于源主机')
    if not config.get('repository_fault_domain') or config['repository_fault_domain'] == config['source_fault_domain']:
        raise ValueError('必须记录并核验独立备份故障域')
    password_file = Path(env['RESTIC_PASSWORD_FILE'])
    if stat.S_IMODE(password_file.stat().st_mode) & 0o077 or not password_file.read_bytes().strip():
        raise ValueError('restic 密码文件必须非空且只有备份账号可读')


def fingerprint_sql(tables, columns=None):
    # 只输出全表行数和稳定摘要，证据中不包含账号或正文内容。
    statements = []
    for table in tables:
        if not re.fullmatch(r'[a-zA-Z_][a-zA-Z0-9_]*', table):
            raise ValueError('业务表名称不合法')
        source = f'public."{table}"'
        if columns is not None:
            selected = columns.get(table)
            if not selected or any(not re.fullmatch(r'[a-zA-Z_][a-zA-Z0-9_]*', column) for column in selected):
                raise ValueError('旧列清单不合法')
            names = ','.join('"' + column + '"' for column in selected)
            source = f'(SELECT {names} FROM {source})'
        statements.append(f'''SELECT json_build_object('table','{table}','rows',count(*),'digest',md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),''))) FROM {source} t''')
    return ' UNION ALL '.join(statements)


class Snapshot:
    """先取得删除屏障，再建立只读快照；上传和普通业务写入仍可继续。"""
    def __init__(self, env):
        self.env = env
        self.process = None

    def __enter__(self):
        self.process = subprocess.Popen(['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'],
                                        env=self.env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, bufsize=0)
        sql = ("SET lock_timeout='30s'; SET statement_timeout='30s'; "
               "SELECT pg_advisory_lock(hashtextextended('operations-backup',0)); "
               "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; "
               "SELECT pg_export_snapshot();\n")
        self.process.stdin.write(sql.encode())
        self.process.stdin.flush()
        deadline = time.monotonic() + 40
        with selectors.DefaultSelector() as selector:
            selector.register(self.process.stdout, selectors.EVENT_READ)
            while time.monotonic() < deadline:
                if not selector.select(max(0, deadline - time.monotonic())):
                    break
                line = self.process.stdout.readline().decode().strip()
                if re.fullmatch(r'[0-9A-Fa-f]+-[0-9A-Fa-f]+-\d+', line):
                    self.id = line
                    return self
                if self.process.poll() is not None:
                    break
        self.__exit__(None, None, None)
        raise RuntimeError('数据库快照或删除屏障取得失败')

    def __exit__(self, *_):
        if self.process:
            try:
                with contextlib.suppress(BrokenPipeError):
                    self.process.communicate(b'ROLLBACK;\n', timeout=5)
            finally:
                if self.process.poll() is None:
                    self.process.kill()
                    self.process.wait()

    def query(self, sql):
        command = f"BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET TRANSACTION SNAPSHOT '{self.id}'; {sql}; ROLLBACK;"
        return run(['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', command], env=self.env, timeout=60).decode().strip()


def backup(config, env=None):
    env = dict(os.environ if env is None else env)
    state = Path(config['state_dir']) / 'backup.json'
    started = time.time()
    previous = json.loads(state.read_text()) if state.exists() else {}
    private_json(state, {**previous, 'lastAttemptAt': started, 'status': 'running'})
    try:
        validate_repository(config, env)
        # 私有暂存区只存 DB 与清单；媒体直接流式进入 restic，避免复制整个视频库。
        stage = Path(config['stage_dir'])
        stage.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(stage, 0o700)
        with tempfile.TemporaryDirectory(prefix='snapshot-', dir=stage) as temporary:
            temporary = Path(temporary)
            os.chmod(temporary, 0o700)
            with Snapshot(env) as snapshot:
                role = json.loads(snapshot.query("SELECT row_to_json(r) FROM (SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=current_user) r"))
                if any(role.values()):
                    raise ValueError('备份数据库账号不能拥有管理或绕过行级权限')
                writable = snapshot.query("SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND (has_table_privilege(current_user,quote_ident(table_schema)||'.'||quote_ident(table_name),'INSERT,UPDATE,DELETE,TRUNCATE'))")
                if writable != '0':
                    raise ValueError('备份账号只能读取业务表')
                rows = json.loads(snapshot.query("SELECT coalesce(json_agg(f ORDER BY f.id),'[]') FROM (SELECT id,storage_driver,object_key,size,checksum,mime_type FROM files) f"))
                media = verify_media(config['media_root'], rows)
                dump = temporary / 'database.dump'
                run(['pg_dump', '--format=custom', '--no-owner', '--no-acl', '--snapshot=' + snapshot.id, '--file=' + str(dump)], env=env)
                os.chmod(dump, 0o600)
                run(['pg_restore', '--list', str(dump)], env=env)
                migrations = json.loads(snapshot.query("SELECT coalesce(json_agg(m ORDER BY m.migration_name),'[]') FROM (SELECT migration_name,checksum,finished_at FROM _prisma_migrations WHERE rolled_back_at IS NULL) m"))
                if any(not m['finished_at'] for m in migrations):
                    raise ValueError('存在未完成迁移，不生成成功备份')
                tables = json.loads(snapshot.query("SELECT json_agg(tablename ORDER BY tablename) FROM pg_tables WHERE schemaname='public'"))
                fingerprints = [json.loads(line) for line in snapshot.query(fingerprint_sql(tables)).splitlines()]
                config_files = []
                for filename in config['config_files']:
                    file = Path(filename)
                    if not file.is_file() or file.is_symlink():
                        raise ValueError('配置文件缺失或为符号链接')
                    config_files.append({'path': str(file.resolve()), 'sha256': sha256(file), 'bytes': file.stat().st_size})
                if not config_files or not re.fullmatch(r'[a-f0-9]{40,64}', config.get('release', '')):
                    raise ValueError('必须绑定可恢复的部署配置和版本')
                manifest = {'schemaVersion': 1, 'createdAt': started, 'release': config['release'],
                            'database': {'sha256': sha256(dump), 'bytes': dump.stat().st_size, 'snapshot': snapshot.id},
                            'media': media, 'mediaRoot': config['media_root'], 'files': rows, 'migrations': migrations, 'tables': fingerprints, 'config': config_files,
                            'sourceHost': config['source_host'], 'sourceFaultDomain': config['source_fault_domain'],
                            'repositoryFaultDomain': config['repository_fault_domain']}
                private_json(temporary / 'manifest.json', manifest)
                paths = [str(dump), str(temporary / 'manifest.json'), *[x['path'] for x in config_files],
                         *[str(media_path(config['media_root'], x['object_key'])) for x in rows]]
                if any('\n' in p or '\r' in p for p in paths):
                    raise ValueError('备份路径不允许换行')
                filelist = temporary / 'files.txt'
                filelist.write_text('\n'.join(paths) + '\n')
                os.chmod(filelist, 0o600)
                output = run(['restic', 'backup', '--json', '--host', config['source_host'], '--tag', 'aihub-consistent',
                              '--files-from-verbatim', str(filelist)], env=env)
                summaries = [json.loads(line) for line in output.splitlines() if line.startswith(b'{')]
                summary = next((x for x in summaries if x.get('message_type') == 'summary'), {})
                backup_id = summary.get('snapshot_id')
                if not backup_id or self_changed(config_files):
                    raise RuntimeError('备份未返回快照标识或备份期间配置发生变化')
            # 逐项从独立仓库读回并计算摘要，不把整个视频库再次落入暂存内存盘。
            expected = [(str(dump), manifest['database']['sha256'], manifest['database']['bytes']),
                        (str(temporary / 'manifest.json'), sha256(temporary / 'manifest.json'), (temporary / 'manifest.json').stat().st_size),
                        *[(x['path'], x['sha256'], x['bytes']) for x in config_files],
                        *[(str(Path(config['media_root']) / x['object_key']), x['checksum'], x['size']) for x in rows]]
            for filename, checksum, size in expected:
                verify_remote_file(env, backup_id, filename, checksum, size)
            result = {'status': 'ok', 'lastAttemptAt': started, 'lastSuccessAt': time.time(), 'snapshotAt': started,
                      'snapshotId': backup_id, 'durationSeconds': round(time.time() - started, 2),
                      'databaseBytes': manifest['database']['bytes'], 'mediaBytes': media['bytes'], 'fileCount': media['count'],
                      'verified': True, 'release': config['release'], 'manifestPath': str(temporary / 'manifest.json'),
                      'dumpPath': str(dump), 'mediaRoot': config['media_root']}
            private_json(state, result)
            return result
    except Exception:
        private_json(state, {**previous, 'lastAttemptAt': started, 'status': 'failed', 'failedAt': time.time()})
        raise


def self_changed(files):
    return any(sha256(x['path']) != x['sha256'] for x in files)


def verify_remote_file(env, snapshot, filename, checksum, size):
    with selectors.DefaultSelector() as selector:
        process = subprocess.Popen(['restic', 'dump', snapshot, filename], env=env, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, bufsize=0)
        selector.register(process.stdout, selectors.EVENT_READ)
        digest, length = hashlib.sha256(), 0
        deadline = time.monotonic() + 1200
        try:
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0 or not selector.select(min(60, remaining)):
                    raise RuntimeError('远端备份读回超时')
                chunk = os.read(process.stdout.fileno(), 1024 * 1024)
                if not chunk:
                    break
                length += len(chunk)
                if length > size:
                    raise RuntimeError('远端备份字节数超过清单')
                digest.update(chunk)
            if process.wait(timeout=30) or length != size or digest.hexdigest() != checksum:
                raise RuntimeError('远端备份读回校验失败')
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()
            process.stdout.close()


def restored_path(root, absolute):
    if not str(absolute).startswith('/'):
        raise ValueError('备份路径必须为绝对路径')
    return media_path(root, str(absolute).lstrip('/'))


def verify_bundle(root, manifest, dump_path, media_root):
    if manifest.get('schemaVersion') != 1:
        raise ValueError('未知备份清单版本')
    dump = restored_path(root, dump_path)
    if dump.stat().st_size != manifest['database']['bytes'] or sha256(dump) != manifest['database']['sha256']:
        raise ValueError('数据库备份校验失败')
    for row in manifest['config']:
        file = restored_path(root, row['path'])
        if file.stat().st_size != row['bytes'] or sha256(file) != row['sha256']:
            raise ValueError('部署配置校验失败')
    return verify_media(Path(root) / str(media_root).lstrip('/'), manifest['files'])


def restore(config, snapshot_id, target, env=None):
    """仅恢复到新目录。数据库恢复由无生产挂载的独立演练容器完成。"""
    env = dict(os.environ if env is None else env)
    validate_repository(config, env)
    if not re.fullmatch(r'[0-9a-f]{8,64}', snapshot_id):
        raise ValueError('必须明确指定已记录的 restic 快照 ID，禁止自动选择 latest')
    target = Path(target)
    if target.exists():
        raise ValueError('隔离恢复目录必须尚不存在，禁止覆盖已有目录')
    target.mkdir(parents=True, mode=0o700)
    os.chmod(target, 0o700)
    run(['restic', 'restore', snapshot_id, '--target', str(target), '--verify'], env=env)
    manifests = list(target.glob('**/snapshot-*/manifest.json'))
    if len(manifests) != 1:
        raise ValueError('必须恰有一个一致性备份清单')
    manifest = json.loads(manifests[0].read_text())
    dump = manifests[0].with_name('database.dump')
    verify_bundle(target, manifest, '/' + str(dump.relative_to(target)), manifest['mediaRoot'])
    return {'snapshotId': snapshot_id, 'target': str(target), 'manifest': str(manifests[0]), 'dump': str(dump), 'verified': True}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['backup', 'restore'])
    parser.add_argument('--config', required=True)
    parser.add_argument('--snapshot')
    parser.add_argument('--target')
    args = parser.parse_args()
    try:
        config = json.loads(Path(args.config).read_text())
        Path(config['state_dir']).mkdir(parents=True, exist_ok=True, mode=0o700)
        with (Path(config['state_dir']) / 'backup.lock').open('w') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            result = backup(config) if args.action == 'backup' else restore(config, args.snapshot or '', args.target or '')
        print(json.dumps(result, ensure_ascii=False))
    except Exception as error:
        print(json.dumps({'status': 'failed', 'reason': str(error) if isinstance(error, (ValueError, RuntimeError)) else type(error).__name__}, ensure_ascii=False))
        raise SystemExit(1)
