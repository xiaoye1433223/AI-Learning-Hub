import { Prisma, PrismaClient } from '@prisma/client'
import { ConfigService } from '@nestjs/config'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PrismaService } from '../../prisma/prisma.service'
import { createStorageAdapter } from '../storage/storage.module'
import { StorageQuotaService } from '../storage/storage-quota.service'
import { collectArchivedMedia } from '../media/media-gc'
import { PersistenceService } from './persistence.service'

// 固定的过期凭证名单；不清理用户、实名材料、审计、处罚、申诉或业务历史。
export async function cleanExpiredCredentials(prisma: PrismaClient) {
  return prisma.$transaction(async (tx) => {
    const [lock] = await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtextextended('operations-expiry', 0)) AS locked`
    if (!lock.locked) return { skipped: true, deleted: {} }
    const deleted: Record<string, number> = {}
    for (const table of ['password_reset_tokens', 'email_verification_tokens', 'refresh_tokens', 'request_idempotency', 'registration_throttles', 'login_throttles']) {
      deleted[table] = await tx.$executeRaw(Prisma.sql`DELETE FROM ${Prisma.raw(table)} WHERE ctid IN (SELECT ctid FROM ${Prisma.raw(table)} WHERE expires_at < NOW() ORDER BY expires_at LIMIT 1000 FOR UPDATE SKIP LOCKED)`)
    }
    return { skipped: false, deleted }
  }, { maxWait: 1000, timeout: 20000 })
}

async function main() {
  const prisma = new PrismaClient(), config = new ConfigService()
  const root = join(config.get('OPS_STATE_DIRECTORY') || './var/operations', 'runtime')
  const write = async (value: unknown) => {
    await mkdir(root, { recursive: true, mode: 0o700 })
    await writeFile(join(root, 'maintenance.next.json'), JSON.stringify(value), { mode: 0o600 })
    await rename(join(root, 'maintenance.next.json'), join(root, 'maintenance.json'))
  }
  try {
    if (process.env.OPS_MAINTENANCE_APPLY !== 'true') throw new Error('定时维护需要 OPS_MAINTENANCE_APPLY=true')
    const quota = new StorageQuotaService(prisma as PrismaService, config)
    const storage = createStorageAdapter(prisma as PrismaService, config, quota)
    const persistence = new PersistenceService(prisma as PrismaService, config, storage)
    const expiry = await cleanExpiredCredentials(prisma)
    if (expiry.skipped) return
    const expiredUploads = await quota.reapExpiredUploads()
    const workspaces = await quota.cleanupWorkspaces()
    const archived = await collectArchivedMedia(prisma, storage, true)
    // 沿用既有游标和文件引用检查；每次最多检查50条，跨日向后推进。
    let cursor: string | undefined
    try { const { readFile } = await import('node:fs/promises'); cursor = JSON.parse(await readFile(join(root, 'maintenance.json'), 'utf8')).nextCursor || undefined } catch { /* 首次运行 */ }
    const unused = await persistence.maintain('system:scheduled-maintenance', 'unused-files', '定时清理过期且无业务引用的文件', cursor)
    if (archived.pending.length) throw new Error('部分文件尚未安全清理，将保留队列重试')
    const result = { status: 'ok', lastSuccessAt: Date.now() / 1000, deleted: expiry.deleted, expiredUploads, workspaces, archived: archived.removed, unused }
    await write({ ...result, nextCursor: 'nextCursor' in unused ? unused.nextCursor : null })
    console.log(JSON.stringify(result))
  } catch {
    await write({ status: 'failed', failedAt: Date.now() / 1000 })
    console.error('定时维护失败；未完成记录保留，下次安全重试')
    process.exitCode = 1
  } finally { await prisma.$disconnect() }
}
if (require.main === module) void main()
