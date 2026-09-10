# 备份、恢复与监控执行入口

适用 PostgreSQL 17、本地文件存储和现有 Docker Compose。保留既有账号、投稿、课程、实训及媒体；不运行完整 Seed，不提供 `migrate reset`。本目录的可执行机制需要先完成环境配置和隔离演练，再启用定时器。源码检查通过不代表已部署或 RPO/RTO 达标。

## 执行链路

| 入口 | 行为 | 调度 |
| --- | --- | --- |
| `backup.py backup` | PostgreSQL 只读一致快照、全表摘要、媒体逐项 SHA-256、同次配置进入加密 restic 快照；逐项从独立仓库读回校验 | `aihub-backup.timer` 每30分钟 |
| `backup.py restore` | 明确指定快照 ID，恢复到尚不存在的目录，校验 DB、媒体及配置 | 人工启动演练或应急恢复 |
| `drill.py` | 新内部网络、新数据库和文件副本；全表摘要/约束、重复迁移、旧行保留、用户/帖子/评论/课程/文件/视频访问；切换候选和上一应用镜像读取 | 每月及发布前执行，报告保留实际结果 |
| `archive-release.py` | 保存现行三个健康应用的真实镜像及指定配置，生成 SHA-256 清单 | 相关发布前；归档纳入独立备份 |
| `maintenance.js` | 过期令牌/会话/幂等/限流记录；复用上传租约、临时目录和文件引用保护；固定批量 | `aihub-maintenance.timer` 每日03:20 |
| `monitor.py` | 从独立监控主机检查两个入口、受限 SSH 状态文件和备份时间；企业微信告警及恢复通知 | `aihub-monitor.timer` 每分钟 |

备份期间只取得 `operations-backup` 排他锁；所有文件删除先取得同名共享锁。普通写入继续，物理删除等待或超时后重试。数据库 dump 与文件清单使用同一个 `pg_export_snapshot()`。文件不可变对象键、大小和摘要均核验，未绑定或正在上传的临时文件不进入清单。配置文件在上传前后校验，发生切版则本次失败，不记成功。

## 主机与最小权限

部署前在私有运维记录填写：源主机、PostgreSQL 容器/卷及数据库、上传卷实际位置、容量、当前源码摘要和三端镜像 ID、上一配置位置、负责人、备份主机及其物理磁盘、独立监控主机、告警接收群。仓库只保留模板，不放内网地址与凭据。

源应用账号不持有备份仓库凭据。用数据库管理账号执行 `backup-role.sql`，`app_owner` 必须是当前迁移对象所有者；通过 TTY 的 `\password aihub_backup` 设置备份账号密码。该账号仅允许读取本库 public 表与序列，连接限制放在当前数据库的 `pg_hba.conf`；不要为此开放宿主数据库端口。脚本拒绝数据库管理账号和有业务写权限的账号。

独立主机安装官方 rest-server，启用 `aihub-vault.service` 的 TLS、独立认证、`--private-repos` 和 `--append-only`。使用 `htpasswd` 交互设置专用账号。源端不能删除或覆盖历史备份；保留期删除仅由独立主机负责人在批准后执行。默认不自动 prune，也不自动删审计、处罚、实名材料或业务数据。定期检查独立仓库容量。

restic 的加密密码保存在独立保管位置，另做密钥恢复演练；不要只保存在源主机。备份客户端提供只读的 `secrets/restic-password`、`secrets/pgpass`，目录0700、文件0600。配置 `backup.env` 的 REST 仓库认证与 `backup.json`；用户名/密码不嵌入 URL。模板中的 `release` 替换为真实 Git SHA 或源码 SHA-256，`config_files` 包含该次 Compose、Nginx 配置、应用 `.env` 及三端镜像清单。敏感配置随备份加密，明文数据库暂存于容器内受限 tmpfs。

发布前运行 `archive-release.py --compose <现行Compose> --config-file <现行.env> --config-file <学生Nginx配置> --config-file <后台Nginx配置> --destination <新归档目录>`；把输出的 `application-images.tar`、清单和配置纳入 `config_files` 并只读挂载给备份容器。归档至少保留上一可用版本，不执行镜像 prune。灾难恢复时先验证归档 SHA-256，再 `docker image load -i application-images.tar`，按清单中的完整镜像 ID 演练；不依赖可移动标签或临时构建服务器。

## 安装与调度

把本目录安装到 `/opt/aihub-operations`。在源主机 `/etc/aihub-operations/runtime.env` 写入当前部署的绝对路径：

```dotenv
COMPOSE_PROJECT_NAME=ai-learning-hub
COMPOSE_FILE=/srv/ai-learning-hub/current/docker-compose.yml:/opt/aihub-operations/compose.operations.yml
OPS_CODE_DIRECTORY=/opt/aihub-operations
OPS_DIRECTORY=/srv/ai-learning-hub/operations
OPS_RELEASE_DIRECTORY=/srv/ai-learning-hub/current
OPS_IMAGE_TAG=填写本次源码摘要
```

创建 `OPS_DIRECTORY` 下的 `runtime`、`backup`、`secrets`，属主与现有应用 UID 一致，显式0700；备份容器固定 UID1000。备份状态挂载到应用为只读，运行采样目录可写。通过现有发布流程加入 `compose.operations.yml`，重建 API 和后台以及 operations 镜像，先人工执行并核验一次备份；不要直接覆盖现行私有 Compose 或 `.env`。

```bash
systemctl start aihub-backup.service
systemctl status aihub-backup.service
# 检查 backup/backup.json 的 verified、snapshotAt、snapshotId、大小与耗时。
systemctl enable --now aihub-backup.timer aihub-maintenance.timer
systemctl list-timers 'aihub-*'
```

独立监控主机安装 Python3 和 OpenSSH，使用专用 `aihub-monitor` 用户运行 `aihub-monitor.service`。新建专用 SSH 密钥，在源端状态文件属主账号的 `authorized_keys` 追加以下受限条目（替换状态目录和公钥，保留已有密钥）；`read-status.py` 由 root 安装且不可被该账号改写。不要给监控密钥配置 sudo 或通用 shell。

```text
restrict,command="/usr/bin/python3 /opt/aihub-operations/read-status.py /srv/ai-learning-hub/operations" ssh-ed25519 专用监控公钥
```

独立主机的 SSH 别名 `aihub-monitor-source` 固定源端账号、主机、IdentityFile 和已核验的 known_hosts。测试 `ssh aihub-monitor-source aihub-health` 能读状态、`ssh aihub-monitor-source id` 被拒绝。私有 `monitor.json` 配置两个真实入口和企业微信密钥文件。Webhook 文件0600，明确测试群接收人后执行 `systemctl start aihub-monitor.service`，收件确认后启用 timer。HTTP200 且企业微信 `errcode=0` 才记录送达；发送失败保留待发送状态。备份失败/超过1小时立即通知；其他故障持续2分钟通知，持续恢复2分钟通知；同一故障不周期刷屏。

调度器与仓库应位于源主机之外，才能在源主机断电时告警。同机运行只覆盖进程和应用故障，不能作为独立监控验收。

## 恢复与回滚演练

```bash
python3 backup.py restore --config /etc/aihub-operations/backup.json \
  --snapshot 明确快照ID --target /srv/restore/新的恢复目录
sudo python3 drill.py --config /etc/aihub-operations/drill.json
```

`drill.json` 使用恢复包中的配置路径、已在演练主机存在的完整 Docker 镜像 ID、受保护验收账号文件和专用 workspace 父目录。验收账号 JSON 键为 `studentIdentifier`、`studentPassword`、`adminIdentifier`、`adminPassword`。脚本只能新建随机命名容器，不接受目标库连接字符串、不挂源业务卷、不发布宿主端口。数据库恢复后先验证所有旧表摘要和主外键，再运行候选镜像的 `migrate deploy` 两次；禁止将旧业务库直接作为演练目标。

增加字段的升级按恢复前的旧列比较摘要。校园安全迁移必须撤销全部旧会话，演练单独验证这一预期变更及原撤销时间，其余旧数据仍完整比较。管理员通过真实 MFA 登录；仅在无外部端口的恢复副本读取备份密文和对应密钥验证可恢复性，不改变线上绑定。新会话边界上线后，上一版本的读取验证不代表允许重新开放不具备该边界的旧镜像。

应用验证要求已有可见帖子、评论、已发布课程及可播放视频；无样本即失败，不把空列表当通过。文件必须授权下载且摘要一致，视频必须 Range206 且 FFmpeg 实际解码。候选和上一可用 API 镜像对同一克隆库读取通过，才具备本次应用回滚证据。实际发布仍保留上一份三个镜像和完整配置；只切应用，数据库使用向前修复。已经开放新流量后禁止自动回灌旧库丢弃新数据。

报告记录备份年龄、实际恢复耗时、全表摘要结果、关键对象、镜像和清理状态。RPO≤1小时、RTO≤4小时是待验证目标；当前逻辑快照不提供 WAL/PITR，整机恢复、DNS/TLS切换和完整教学视频规模必须另计入正式演练。

## 状态与清理边界

- `/api/v1/health/live`：进程能响应。
- `/api/v1/health/ready`（兼容 `/health`）：数据库和文件存储可用；失败503，不公开依赖详情。
- `/api/v1/admin/persistence/operations`：仅 `platform.manage` 读取数据库、容量、队列、FFmpeg、邮件、备份和定时清理详情。沿用后台“数据与存储状态”，未新增导航。
- 验证/重置令牌、Refresh会话、幂等与限流记录只按既定到期时间删，每表每次1000条。审计、处罚、申诉、个人资料和业务版本不进入删除名单。
- 临时上传与过期工作目录沿用 StorageQuotaService；无引用普通文件沿用7天规则和50条游标；归档素材至少30天。隔离文件保留，待批准的安全规则单独处理。
- Docker日志使用 `local` 驱动，每容器10MiB×5；保留重启策略，限制API、数据库和前端的CPU、内存与进程数。

## 本地检查

```bash
python3 -m unittest discover -s deploy/operations -p 'test_*.py' -v
cd server
npm run typecheck
npx vitest run test/operations.unit.spec.ts test/persistence.unit.spec.ts test/media-storage.unit.spec.ts test/media-runtime.unit.spec.ts
```

主机、数据库、加密仓库、告警实际送达和浏览器验收使用飞牛及独立设施执行，不能由本地单测代替。
