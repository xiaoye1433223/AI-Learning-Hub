#!/usr/bin/env python3
"""OpenSSH 强制命令：专用监控密钥只能读取两种状态，不能选择路径或执行 shell。"""
import json
import os
from pathlib import Path
import sys


def read_status(root, command):
    names = {'aihub-health': 'runtime/health.json', 'aihub-backup': 'backup/backup.json'}
    if command not in names:
        raise ValueError('监控密钥不允许该命令')
    root = Path(root).resolve(strict=True)
    file = root / names[command]
    if file.is_symlink() or file.parent.is_symlink() or root not in file.resolve(strict=True).parents or file.stat().st_size > 65536:
        raise ValueError('监控状态路径或大小不合法')
    value = json.loads(file.read_text())
    if not isinstance(value, dict):
        raise ValueError('监控状态格式不合法')
    return value


if __name__ == '__main__':
    try:
        print(json.dumps(read_status(sys.argv[1], os.environ.get('SSH_ORIGINAL_COMMAND', '')), ensure_ascii=False))
    except Exception:
        print('{}')
        raise SystemExit(1)
