#!/usr/bin/env python3
"""在独立监控主机每分钟运行一次；状态持久化、故障去重、恢复通知。"""
import argparse
import fcntl
import json
import os
from pathlib import Path
import subprocess
import time
from urllib import request
from urllib.parse import urlsplit

from backup import private_json

LABELS = {'service': '服务不可用', 'telemetry': '运行状态采样失联', 'http5xx': '5xx持续上升',
          'storage': '磁盘或存储容量不足', 'videoQueue': '视频任务长期停滞', 'ffmpeg': '视频工具不可用',
          'backup': '备份失败或超期', 'mail': '邮件持续失败或未配置', 'maintenance': '定时清理失败或漏跑'}


def load_json(path):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return {}


def source_file(config, name):
    if name not in ('runtime/health.json', 'backup/backup.json'):
        raise ValueError('不支持读取该状态文件')
    host = config['source_ssh_host']
    if not host or host.startswith('-') or any(c.isspace() for c in host):
        raise ValueError('监控 SSH 主机不合法')
    command = 'aihub-health' if name == 'runtime/health.json' else 'aihub-backup'
    result = subprocess.run(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', '-o', 'StrictHostKeyChecking=yes',
                             host, command], capture_output=True, timeout=10)
    if result.returncode:
        return {}
    return json.loads(result.stdout)


def ready(url):
    try:
        if urlsplit(url).scheme not in ('http', 'https'):
            return False
        with request.urlopen(url, timeout=5) as response:
            body = json.load(response)
            return response.status == 200 and body.get('code') == 0 and body.get('data', {}).get('status') == 'ready'
    except Exception:
        return False


def problems(health, backup, service_ready, now):
    sample = health.get('sampledAt', '')
    try:
        from datetime import datetime
        age = now - datetime.fromisoformat(sample.replace('Z', '+00:00')).timestamp()
    except (TypeError, ValueError):
        age = float('inf')
    telemetry_stale = age < -60 or age > 180
    result = {'service': not service_ready, 'telemetry': telemetry_stale}
    http = health.get('http', {})
    errors, total = http.get('errors5xx', 0), http.get('requests', 0)
    result['http5xx'] = None if telemetry_stale else errors >= 5 and errors / max(total, 1) >= 0.05
    checks = health.get('checks', {})
    for key in ['storage', 'videoQueue', 'ffmpeg', 'mail', 'maintenance']:
        # 失联时保持原故障，不发送虚假的依赖恢复；telemetry 独立告警。
        result[key] = None if telemetry_stale else checks.get(key, {}).get('status') != 'ok'
    snapshot = backup.get('snapshotAt')
    attempt = backup.get('lastAttemptAt', 0)
    stuck = backup.get('status') == 'running' and isinstance(attempt, (int, float)) and now - attempt > 25 * 60
    result['backup'] = stuck or backup.get('status') == 'failed' or backup.get('verified') is not True or not isinstance(snapshot, (int, float)) or not 0 <= now - snapshot <= 3600
    return result


def notify_wecom(secret_file, text):
    file = Path(secret_file)
    if file.stat().st_mode & 0o077:
        raise ValueError('告警密钥文件必须仅账号可读')
    url = file.read_text().strip()
    parsed = urlsplit(url)
    if parsed.scheme != 'https' or parsed.hostname != 'qyapi.weixin.qq.com' or parsed.path != '/cgi-bin/webhook/send' or not parsed.query:
        raise ValueError('必须配置有效的企业微信机器人 HTTPS 地址')
    payload = json.dumps({'msgtype': 'text', 'text': {'content': text}}, ensure_ascii=False).encode()
    # 消息仅含服务名称、故障类别和时间；不携带用户信息、主机路径或密钥。
    req = request.Request(url, data=payload, headers={'Content-Type': 'application/json'}, method='POST')
    with request.urlopen(req, timeout=10) as response:
        result = json.load(response)
        if response.status != 200 or result.get('errcode') != 0:
            raise RuntimeError('校内告警通道未接受消息')


def transition(state, current, now, send, service_name):
    events = []
    for key, unhealthy in current.items():
        if unhealthy is None:
            continue
        entry = state.setdefault(key, {'since': None, 'notified': False})
        if unhealthy:
            entry.pop('healthySince', None)
            if entry['since'] is None:
                entry['since'] = now
            # 备份失败/漏跑立即通知，其他故障持续两分钟才通知。
            delay = 0 if key == 'backup' else 120
            if not entry['notified'] and now - entry['since'] >= delay:
                send(f'{service_name} 告警：{LABELS[key]}。请检查管理端运行状态。')
                entry['notified'] = True
                events.append({'key': key, 'event': 'firing', 'at': now})
        elif entry['since'] is not None:
            entry.setdefault('healthySince', now)
            if now - entry['healthySince'] >= 120:
                if entry['notified']:
                    send(f'{service_name} 恢复：{LABELS[key]}已恢复。')
                    events.append({'key': key, 'event': 'resolved', 'at': now})
                state[key] = {'since': None, 'notified': False}
    return events


def main(config):
    directory = Path(config['monitor_state_directory'])
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(directory, 0o700)
    with (directory / 'monitor.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        state = load_json(directory / 'alerts.json')
        now = time.time()
        try:
            health, backup = source_file(config, 'runtime/health.json'), source_file(config, 'backup/backup.json')
        except Exception:
            health, backup = {}, {}
        current = problems(health, backup, all(ready(url) for url in config['ready_urls']), now)
        # 每次发送成功后马上落盘；后续另一告警失败不会使已发消息重复发送。
        events = []
        for key, value in current.items():
            try:
                emitted = transition(state, {key: value}, now, lambda text: notify_wecom(config['wecom_secret_file'], text), config['service_name'])
                events.extend(emitted)
            finally:
                private_json(directory / 'alerts.json', state)
        record = {'checkedAt': now, 'channel': 'wecom', 'events': events, 'active': [key for key, value in current.items() if value]}
        private_json(directory / 'monitor.json', record)
        print(json.dumps(record, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    args = parser.parse_args()
    try:
        main(json.loads(Path(args.config).read_text()))
    except Exception as error:
        print(json.dumps({'status': 'failed', 'reason': type(error).__name__, 'message': '监控运行或告警投递失败；未确认送达的告警下次重试'}, ensure_ascii=False))
        raise SystemExit(1)
