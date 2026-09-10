import { PrismaClient } from '@prisma/client'
import { ConfigService } from '@nestjs/config'
import { lockFileReferences } from '../../common/persistence'
import type { PrismaService } from '../../prisma/prisma.service'
import type { StorageService } from '../storage/storage.types'
import { createStorageAdapter } from '../storage/storage.module'
import { mediaUsage } from './media-usage'

/** 上传第二阶段失败后，仅排队未绑定的文件；共享引用由原Storage删除锁再次保护。 */
export async function releaseUnboundMediaFile(prisma: PrismaClient, storage: StorageService, fileId: string) {
  const job = await prisma.$transaction(async (tx) => {
    await lockFileReferences(tx)
    if (await tx.mediaAsset.count({ where: { fileId } })) return null
    return tx.mediaGcJob.upsert({ where: { fileId }, create: { fileId }, update: {} })
  })
  if (!job) return
  try {
    await storage.delete(fileId)
    await prisma.mediaGcJob.delete({ where: { id: job.id } })
  } catch { /* 对象或数据库不可用时保留已提交队列，下一次受控GC重试。 */ }
}

/** 默认只预览；队列确保对象删除/数据库提交失败可安全重试，不声称跨PG与对象存储原子。 */
export async function collectArchivedMedia(prisma: PrismaClient, storage: StorageService, apply = false, retentionDays = 30) {
  if (!Number.isInteger(retentionDays) || retentionDays < 30) throw new Error('孤立素材安全保留期不得少于30天')
  const cutoff = new Date(Date.now() - retentionDays * 86400000)
  const candidates = await prisma.mediaAsset.findMany({ where: { status: 'archived', updatedAt: { lt: cutoff } }, select: { id: true, assetKey: true, fileId: true }, orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }], take: 50 })
  const eligible: string[] = []
  for (const asset of candidates) {
    await prisma.$transaction(async (tx) => {
      await lockFileReferences(tx)
      if (!await tx.mediaAsset.count({ where: { id: asset.id, status: 'archived', updatedAt: { lt: cutoff } } }) || (await mediaUsage(tx, asset.id)).length) return
      eligible.push(asset.assetKey)
      if (!apply) return
      await tx.mediaGcJob.upsert({ where: { fileId: asset.fileId }, create: { fileId: asset.fileId }, update: {} })
      await tx.mediaAsset.delete({ where: { id: asset.id } })
    }, { timeout: 20000 })
  }
  let removed = 0
  const pending: string[] = []
  if (apply) for (const job of await prisma.mediaGcJob.findMany({ orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }], take: 50 })) {
    try {
      await storage.delete(job.fileId)
      await prisma.mediaGcJob.delete({ where: { id: job.id } })
      removed++
    } catch { pending.push(job.id) }
  }
  return { apply, retentionDays, eligible, removed, pending }
}
if (require.main === module) {
  const prisma = new PrismaClient(), apply = process.argv.includes('--apply')
  const run = async () => {
    if (apply && process.env.MEDIA_GC_CONFIRM !== 'ARCHIVED_UNREFERENCED') throw new Error('实际清理须显式设置MEDIA_GC_CONFIRM=ARCHIVED_UNREFERENCED')
    const result = await collectArchivedMedia(prisma, createStorageAdapter(prisma as PrismaService, new ConfigService()), apply)
    console.log(JSON.stringify(result))
    if (result.pending.length) process.exitCode = 1
  }
  run().catch(() => { console.error('素材清理失败；未完成队列保留供复核后重试'); process.exitCode = 1 }).finally(() => prisma.$disconnect())
}
