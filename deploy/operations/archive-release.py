#!/usr/bin/env python3
"""从现行 Compose 的三个应用容器保存实际镜像与配置；供备份及回滚演练使用。"""
import argparse
import json
import os
from pathlib import Path
import shutil
from backup import private_json, run, sha256


def archive(compose, config_files, destination):
    compose = Path(compose).resolve(strict=True)
    destination = Path(destination)
    if destination.exists():
        raise ValueError('版本归档目录必须尚不存在')
    destination.mkdir(parents=True, mode=0o700)
    images, containers = {}, {}
    for service in ['server', 'student-web', 'admin-web']:
        ids = run(['docker', 'compose', '-f', str(compose), 'ps', '-q', service]).decode().split()
        if len(ids) != 1:
            raise ValueError('每个应用必须恰有一个现行容器')
        data = json.loads(run(['docker', 'inspect', ids[0]]))[0]
        if not data['State']['Running'] or data['State'].get('Health', {}).get('Status') != 'healthy':
            raise ValueError('仅归档已就绪的实际应用镜像')
        images[service] = data['Image']
        containers[service] = ids[0]
    target = destination / 'application-images.tar'
    run(['docker', 'image', 'save', '-o', str(target), *sorted(set(images.values()))])
    os.chmod(target, 0o600)
    copied = []
    configs = destination / 'config'
    configs.mkdir(mode=0o700)
    for file in [str(compose), *config_files]:
        source = Path(file).resolve(strict=True)
        if not source.is_file() or (configs / source.name).exists():
            raise ValueError('配置文件缺失或文件名重复')
        before = sha256(source)
        shutil.copyfile(source, configs / source.name)
        os.chmod(configs / source.name, 0o600)
        if before != sha256(configs / source.name) or before != sha256(source):
            raise ValueError('归档期间配置发生变化')
        copied.append({'name': source.name, 'sha256': before})
    for service, container in containers.items():
        current = run(['docker', 'compose', '-f', str(compose), 'ps', '-q', service]).decode().split()
        if current != [container]:
            raise ValueError('归档期间应用发生切换，请对稳定版本重新归档')
    result = {'schemaVersion': 1, 'images': images, 'imageArchive': {'name': target.name, 'bytes': target.stat().st_size, 'sha256': sha256(target)}, 'config': copied}
    private_json(destination / 'release-manifest.json', result)
    # 新建的专用归档供 UID1000 的只读备份容器访问，绝不改现行业务目录。
    for directory, folders, files in os.walk(destination):
        os.chown(directory, 1000, 1000)
        for name in files:
            os.chown(Path(directory) / name, 1000, 1000)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--compose', required=True)
    parser.add_argument('--config-file', action='append', required=True)
    parser.add_argument('--destination', required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(archive(args.compose, args.config_file, args.destination), ensure_ascii=False))
    except Exception as error:
        print(json.dumps({'status': 'failed', 'reason': type(error).__name__}))
        raise SystemExit(1)
