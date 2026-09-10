import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from backup import Snapshot, backup, fingerprint_sql, media_path, private_json, restore, validate_repository, verify_media, verify_remote_file
from monitor import problems, transition, notify_wecom
from drill import validate_clone


class OperationsTests(unittest.TestCase):
    def test_clone_digest_check_ignores_query_order_but_rejects_changed_rows(self):
        rows = [{'table': 'course_versions', 'rows': 2, 'digest': 'first'}, {'table': 'users', 'rows': 3, 'digest': 'second'}]
        unordered = '\n'.join(json.dumps(row) for row in reversed(rows))
        with patch('drill.query', side_effect=[unordered, '0', '1']):
            self.assertTrue(validate_clone('isolated', {'tables': rows})['allDigestsMatch'])
        changed = [{**rows[0], 'digest': 'changed'}, rows[1]]
        with patch('drill.query', return_value='\n'.join(json.dumps(row) for row in changed)), self.assertRaisesRegex(RuntimeError, 'course_versions'):
            validate_clone('isolated', {'tables': rows})

    def test_configuration_failure_marks_attempt_failed_immediately(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch('backup.validate_repository', side_effect=ValueError('配置失效')), self.assertRaises(ValueError):
                backup({'state_dir': directory})
            self.assertEqual(json.loads((Path(directory) / 'backup.json').read_text())['status'], 'failed')

    def test_remote_readback_rejects_extra_bytes_and_stalled_process(self):
        import subprocess
        import sys
        popen = subprocess.Popen
        def child(program):
            return lambda command, **kwargs: popen([sys.executable, '-c', program], **kwargs)
        expected = hashlib.sha256(b'ok').hexdigest()
        with patch('backup.subprocess.Popen', side_effect=child("import sys; sys.stdout.write('ok')")):
            verify_remote_file(None, 'abcd1234', '/media/file', expected, 2)
        with patch('backup.subprocess.Popen', side_effect=child("import sys; sys.stdout.write('extra')")), self.assertRaises(RuntimeError):
            verify_remote_file(None, 'abcd1234', '/media/file', expected, 2)
        with patch('backup.subprocess.Popen', side_effect=child('import time; time.sleep(60)')), self.assertRaises(RuntimeError):
            # macOS 使用 KqueueSelector、Linux 使用 EpollSelector，统一替换该实例的方法。
            with patch.object(__import__('selectors').DefaultSelector, 'select', return_value=[]):
                verify_remote_file(None, 'abcd1234', '/media/file', expected, 2)

    def test_restricted_ssh_key_rejects_commands_paths_and_symlinks(self):
        import runpy
        reader = runpy.run_path(str(Path(__file__).with_name('read-status.py')))['read_status']
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'runtime').mkdir()
            state = root / 'runtime/health.json'
            state.write_text('{"sampledAt":"test"}')
            self.assertEqual(reader(root, 'aihub-health'), {'sampledAt': 'test'})
            for command in ['id', 'cat /etc/passwd', 'aihub-health; id', 'aihub-health\n', '../.env']:
                with self.subTest(command=command), self.assertRaises(ValueError):
                    reader(root, command)
            state.unlink()
            state.symlink_to('/etc/passwd')
            with self.assertRaises(ValueError):
                reader(root, 'aihub-health')

    def test_snapshot_process_stays_alive_until_context_exits(self):
        import subprocess
        import sys
        popen = subprocess.Popen
        def fake_psql(command, **kwargs):
            self.assertEqual(command[0], 'psql')
            program = "import sys; sys.stdin.readline(); sys.stdout.write('\\n00000003-0000001B-1\\n'); sys.stdout.flush(); sys.stdin.readline()"
            return popen([sys.executable, '-c', program], **kwargs)
        with patch('backup.subprocess.Popen', side_effect=fake_psql):
            with Snapshot(None) as snapshot:
                self.assertEqual(snapshot.id, '00000003-0000001B-1')
                self.assertIsNone(snapshot.process.poll())
            self.assertIsNotNone(snapshot.process.poll())

    def test_media_checks_bytes_hash_and_path(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'video.mp4').write_bytes(b'real-video-content')
            row = {'storage_driver': 'local', 'object_key': 'video.mp4', 'size': 18, 'checksum': hashlib.sha256(b'real-video-content').hexdigest()}
            self.assertEqual(verify_media(root, [row])['count'], 1)
            (root / 'video.mp4').write_bytes(b'corrupt')
            with self.assertRaises(ValueError):
                verify_media(root, [row])
            (root / 'escape').symlink_to('/etc/passwd')
            for key in ['../secret', '/etc/passwd', 'escape', 'missing', 'video.mp4\n/etc/passwd']:
                with self.subTest(key=key), self.assertRaises(ValueError):
                    media_path(root, key)

    def test_repository_is_remote_and_password_private(self):
        with tempfile.TemporaryDirectory() as directory:
            password = Path(directory) / 'password'
            password.write_text('synthetic-restic-secret')
            password.chmod(0o600)
            config = {'source_host': 'source.test', 'source_fault_domain': 'source-disk', 'repository_fault_domain': 'independent-disk'}
            env = {'RESTIC_REPOSITORY': 'rest:https://backup.test/repo', 'RESTIC_PASSWORD_FILE': str(password)}
            validate_repository(config, env)
            for repository in ['/local/backup', 'rest:http://backup.test/repo', 'rest:https://source.test/repo', 'rest:https://user:password@backup.test/repo']:
                with self.subTest(repository=repository), self.assertRaises(ValueError):
                    validate_repository(config, {**env, 'RESTIC_REPOSITORY': repository})
            password.chmod(0o644)
            with self.assertRaises(ValueError):
                validate_repository(config, env)

    def test_restore_never_overwrites_existing_or_selects_latest(self):
        with patch('backup.validate_repository'), tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                restore({}, 'a' * 64, directory)
            with self.assertRaises(ValueError):
                restore({}, 'latest', str(Path(directory) / 'child'))

    def test_atomic_state_is_private(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / 'status.json'
            private_json(state, {'status': 'failed'})
            self.assertEqual(state.stat().st_mode & 0o777, 0o600)
            self.assertEqual(json.loads(state.read_text())['status'], 'failed')

    def test_deduplicate_persist_and_recover_after_stability(self):
        state, sent = {}, []
        transition(state, {'service': True}, 1000, sent.append, 'test')
        self.assertFalse(sent)
        transition(state, {'service': True}, 1120, sent.append, 'test')
        state = json.loads(json.dumps(state))
        transition(state, {'service': True}, 2000, sent.append, 'test')
        self.assertEqual(len(sent), 1)
        transition(state, {'service': False}, 2001, sent.append, 'test')
        self.assertEqual(len(sent), 1)
        transition(state, {'service': False}, 2121, sent.append, 'test')
        self.assertEqual(len(sent), 2)
        self.assertIn('恢复', sent[-1])

    def test_failed_delivery_is_retried_not_marked_sent(self):
        state = {}
        def fail(_):
            raise RuntimeError('offline')
        with self.assertRaises(RuntimeError):
            transition(state, {'backup': True}, 100, fail, 'test')
        self.assertFalse(state['backup']['notified'])
        sent = []
        transition(state, {'backup': True}, 160, sent.append, 'test')
        self.assertEqual(len(sent), 1)

    def test_stale_health_never_reports_false_dependency_recovery(self):
        current = problems({}, {}, False, 5000)
        self.assertTrue(current['telemetry'])
        self.assertIsNone(current['videoQueue'])
        self.assertIsNone(current['http5xx'])
        self.assertTrue(current['backup'])

    def test_backup_age_uses_snapshot_not_upload_finish(self):
        health = {'sampledAt': '1970-01-01T01:23:20+00:00', 'http': {'requests': 100, 'errors5xx': 5}, 'checks': {}}
        current = problems(health, {'snapshotAt': 100, 'lastSuccessAt': 4999, 'verified': True, 'status': 'ok'}, True, 5000)
        self.assertTrue(current['backup'])
        self.assertTrue(current['http5xx'])

    def test_all_required_incidents_have_failure_and_recovery(self):
        for key in ['service', 'http5xx', 'storage', 'videoQueue', 'backup', 'mail']:
            with self.subTest(key=key):
                state, sent = {}, []
                transition(state, {key: True}, 100, sent.append, 'test')
                transition(state, {key: True}, 220, sent.append, 'test')
                transition(state, {key: True}, 280, sent.append, 'test')
                transition(state, {key: False}, 300, sent.append, 'test')
                transition(state, {key: False}, 420, sent.append, 'test')
                self.assertEqual(len(sent), 2)

    def test_recovery_failure_retries_and_flapping_resets_stability(self):
        state, sent = {}, []
        transition(state, {'backup': True}, 100, sent.append, 'test')
        transition(state, {'backup': False}, 101, sent.append, 'test')
        transition(state, {'backup': True}, 160, sent.append, 'test')
        transition(state, {'backup': False}, 200, sent.append, 'test')
        transition(state, {'backup': False}, 250, sent.append, 'test')
        self.assertEqual(len(sent), 1)
        with self.assertRaises(RuntimeError):
            transition(state, {'backup': False}, 320, lambda _: (_ for _ in ()).throw(RuntimeError('offline')), 'test')
        transition(state, {'backup': False}, 380, sent.append, 'test')
        self.assertEqual(len(sent), 2)

    def test_abandoned_backup_is_not_reported_healthy(self):
        state = {'status': 'running', 'snapshotAt': 4900, 'lastAttemptAt': 1000, 'verified': True}
        self.assertTrue(problems({}, state, True, 5000)['backup'])

    def test_table_digest_query_cannot_inject_sql(self):
        self.assertIn('ORDER BY md5', fingerprint_sql(['users', 'course_versions']))
        with self.assertRaises(ValueError):
            fingerprint_sql(['users; DROP TABLE users'])
        self.assertIn('SELECT "id","email" FROM public."users"', fingerprint_sql(['users'], {'users': ['id', 'email']}))
        for columns in ({}, {'users': []}, {'users': ['id; DROP TABLE users']}):
            with self.assertRaises(ValueError):
                fingerprint_sql(['users'], columns)

    def test_channel_does_not_accept_http_200_with_vendor_error(self):
        with tempfile.TemporaryDirectory() as directory:
            secret = Path(directory) / 'webhook'
            secret.write_text('https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=synthetic')
            secret.chmod(0o600)
            from io import BytesIO
            response = BytesIO(b'{"errcode":93000}')
            response.status = 200
            with patch('monitor.request.urlopen', return_value=response), self.assertRaises(RuntimeError):
                notify_wecom(secret, 'synthetic test')


if __name__ == '__main__':
    unittest.main()
