import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { mkdir, readFile, rename, statfs, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { OperationalCheckDto, OperationsStatusDto } from '@ai-learning-hub/contracts'
import { PrismaService } from '../../prisma/prisma.service'
import { httpMetrics, metricsStartedAt } from '../../common/http-metrics'
import { runMediaCommand } from '../../common/media-process'
import { STORAGE_SERVICE, type StorageService } from '../storage/storage.types'
import { StorageQuotaService } from '../storage/storage-quota.service'

const ok = (message: string, value?: number): OperationalCheckDto => ({ status: 'ok', message, ...(value === undefined ? {} : { value }) })
const failed = (message: string): OperationalCheckDto => ({ status: 'failed', message })
const asTime = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0 && value * 1000 <= Date.now() + 60_000 ? new Date(value * 1000).toISOString() : null

export async function readOperationalFile(file: string): Promise<Record<string, unknown>> {
  try { const value: unknown = JSON.parse(await readFile(file, 'utf8')); return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} }
  catch { return {} }
}

@Injectable()
export class OperationsService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout
  private running?: Promise<void>
  readonly root: string
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService, private readonly quota: StorageQuotaService) {
    this.root = config.get('OPS_STATE_DIRECTORY') || './var/operations'
  }
  onModuleInit() {
    if (this.config.get('NODE_ENV') === 'test') return
    const tick = () => {
      if (this.running) return
      this.running = this.persist().catch(() => { Logger.error('运行状态采样失败；监控将按心跳过期告警', 'Operations') }).finally(() => { this.running = undefined })
    }
    this.timer = setInterval(tick, 60_000)
    tick()
  }
  async onModuleDestroy() { if (this.timer) clearInterval(this.timer); await this.running }

  async databaseReady() {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL statement_timeout = '2000ms'`
        await tx.$queryRaw`SELECT 1`
      }, { maxWait: 1000, timeout: 3000 })
      return true
    } catch { return false }
  }

  async readiness() {
    return await this.databaseReady() && await this.storage.writable()
  }

  async status(): Promise<OperationsStatusDto> {
    const database = await this.databaseReady()
    const checks: OperationsStatusDto['checks'] = {
      database: database ? ok('数据库可查询') : failed('数据库不可查询'),
      storage: failed('存储检查未完成'), videoQueue: failed('数据库不可用，队列状态未知'),
      ffmpeg: failed('视频工具检查未完成'), mail: failed('数据库不可用，邮件状态未知'),
      backup: failed('没有有效的独立备份记录'), maintenance: failed('没有定时清理成功记录'),
    }
    try {
      const capacity = await this.quota.capacity()
      const fs = await statfs(this.quota.storageRoot)
      const percent = Math.round((1 - fs.bavail / fs.blocks) * 100)
      const writable = await this.storage.writable()
      checks.storage = !writable || capacity.unavailableReason ? failed('存储不可写或容量未配置')
        : { status: percent >= 85 || capacity.site.availableBytes < this.quota.minimumFree ? 'warning' : 'ok', message: `文件盘使用 ${percent}%，可分配 ${Math.floor(capacity.site.availableBytes / 1024 / 1024)} MiB`, value: percent }
    } catch { checks.storage = failed('文件存储或容量检查失败') }
    try {
      for (const [key, command] of [['FFMPEG_PATH', 'ffmpeg'], ['FFPROBE_PATH', 'ffprobe']]) await runMediaCommand(this.config.get(key) || command, ['-version'], { timeoutMs: 3000, maxOutputBytes: 65536 })
      checks.ffmpeg = ok('FFmpeg 与 ffprobe 可执行')
    } catch { checks.ffmpeg = failed('FFmpeg 或 ffprobe 不可执行') }
    if (database) {
      try {
        const stalled = await this.prisma.videoAsset.count({ where: { OR: [
          { status: 'uploaded', createdAt: { lt: new Date(Date.now() - 30 * 60_000) } },
          { status: 'processing', OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: new Date(Date.now() - 5 * 60_000) } }, { startedAt: { lt: new Date(Date.now() - 35 * 60_000) } }] },
        ] } })
        checks.videoQueue = { status: stalled ? 'warning' : 'ok', message: stalled ? `${stalled} 个视频任务超过处理或排队时限` : '视频队列无长期停滞', value: stalled }
        if (!this.config.get('SMTP_HOST') || !this.config.get('SMTP_FROM') || !this.config.get('FRONTEND_URL')) checks.mail = { status: 'unconfigured', message: '邮件通道未配置' }
        else {
          const records = await this.prisma.operationLog.findMany({ where: { method: 'MAIL', path: '/internal/mail/delivery' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 20, select: { result: true, createdAt: true } })
          const failures = records.findIndex((record) => record.result === 'success')
          const consecutive = failures < 0 ? records.length : failures
          checks.mail = { status: consecutive >= 3 ? 'failed' : records.length ? 'ok' : 'unconfigured', message: consecutive >= 3 ? `邮件连续失败 ${consecutive} 次` : records.length ? '邮件最近发送未持续失败' : '已配置但尚无实际发送记录', value: consecutive }
        }
      } catch { checks.videoQueue = failed('队列读取失败'); checks.mail = failed('邮件记录读取失败') }
    }
    const backup = await readOperationalFile(join(this.root, 'backup/backup.json'))
    const snapshotAt = asTime(backup.snapshotAt), verifiedAt = asTime(backup.lastSuccessAt)
    if (backup.status === 'failed') checks.backup = failed('最近一次备份失败')
    else if (snapshotAt && verifiedAt && backup.verified === true) {
      const age = Math.floor((Date.now() - Date.parse(snapshotAt)) / 1000)
      checks.backup = { status: age > 3600 ? 'failed' : 'ok', message: age > 3600 ? '最近可恢复快照超过1小时' : '独立备份已读回校验', value: age }
    }
    const maintenance = await readOperationalFile(join(this.root, 'runtime/maintenance.json'))
    const cleanedAt = asTime(maintenance.lastSuccessAt)
    if (cleanedAt && maintenance.status === 'ok' && Date.now() - Date.parse(cleanedAt) < 26 * 3600_000) checks.maintenance = ok('每日过期凭证与安全文件清理已执行')
    return { sampledAt: new Date().toISOString(), startedAt: metricsStartedAt, checks, http: httpMetrics(),
      backup: { snapshotAt, verifiedAt, snapshotId: typeof backup.snapshotId === 'string' && /^[a-f0-9]{8,64}$/.test(backup.snapshotId) ? backup.snapshotId : null },
      targets: { rpoSeconds: 3600, rtoSeconds: 14400, verified: false } }
  }

  private async persist() {
    const status = await this.status()
    const directory = join(this.root, 'runtime')
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const target = join(directory, 'health.json')
    await writeFile(`${target}.${process.pid}.tmp`, JSON.stringify(status), { mode: 0o600 })
    await rename(`${target}.${process.pid}.tmp`, target)
  }
}
