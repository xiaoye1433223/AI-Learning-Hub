import { ConfigService } from '@nestjs/config'
import { Prisma, PrismaClient } from '@prisma/client'
import { hash as passwordHash } from 'bcryptjs'
import { createHash, randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { link, lstat, mkdir, open, readFile, realpath, rm } from 'node:fs/promises'
import path from 'node:path'
import type { CommunityContentBlock, CommunityPostType } from '@ai-learning-hub/contracts'
import type { PrismaService } from '../../prisma/prisma.service'
import { createStorageAdapter } from '../storage/storage.module'
import type { StorageService } from '../storage/storage.types'
import { inspectMediaImage } from '../media/image-validation'
import { releaseUnboundMediaFile } from '../media/media-gc'
import { CommunityVisibilityPolicyService } from './visibility.service'
import { learningFeedPolicy } from '../feed/feed-policy'

export const starterPackId = 'ai-discussions-v1'
export const starterSettingKey = 'community_starter:ai-discussions-v1'
const bundleRoot = path.resolve(__dirname, '../../../resources/community-starter')
const digest = (value: Buffer | string) => createHash('sha256').update(value).digest('hex')
interface Profile { id: string; username: string; displayName: string; email: string; bio: string }
interface Reply { id: string; authorId: string; body: string }
interface Post { id: string; authorId: string; title: string; body: string; postType: CommunityPostType; category: string; image: string; replies: Reply[] }
interface Content { batch: string; profiles: Profile[]; posts: Post[] }
interface Asset { id: string; file: string; width: number; height: number; bytes: number; sha256: string }
interface Manifest { id: string; version: number; batch: string; contentSha256: string; images: Asset[] }
interface Credential { username: string; password: string }
type ImportResult = { status: 'created' | 'adopted' | 'skipped'; pack: string; accounts: number; posts: number; comments: number; images: number }
function requireResource(value: unknown, message: string): asserts value {
  if (!value) throw new Error('社区初始化资源：' + message)
}

export async function readStarterBundle(root = bundleRoot) {
  const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8')) as Manifest
  const raw = await readFile(path.join(root, 'content.json'))
  requireResource(manifest.id === starterPackId && manifest.version === 1 && digest(raw) === manifest.contentSha256, '清单版本或内容摘要不符')
  const content = JSON.parse(raw.toString('utf8')) as Content
  requireResource(content.batch === manifest.batch && content.profiles.length === 30 && content.posts.length === 100 && manifest.images.length === 20, '批次或数量不符')
  const unique = (values: string[]) => new Set(values).size === values.length
  const users = new Set(content.profiles.map(p => p.id))
  requireResource(unique(content.profiles.map(p => p.id)) && unique(content.profiles.map(p => p.username)) && unique(content.profiles.map(p => p.email)), '账号标识重复')
  requireResource(unique(content.posts.map(p => p.id)) && unique(content.posts.map(p => p.title)), '帖子标识或标题重复')
  requireResource(unique(manifest.images.map(a => a.id)) && unique(manifest.images.map(a => a.file)), '图片标识重复')
  for (const p of content.profiles) {
    requireResource(/^aix01-user-\d{2}$/.test(p.id) && /^aix_\d{2}$/.test(p.username) && p.email.endsWith('@accounts.invalid'), '账号标识不合法')
    requireResource(p.bio.startsWith('社区演示账号｜') && p.displayName.length > 0 && p.displayName.length <= 50, '账号身份说明或昵称缺失')
  }
  for (const p of content.posts) {
    requireResource(/^aix01-post-\d{3}$/.test(p.id) && users.has(p.authorId), '帖子或作者标识不合法')
    requireResource(p.title.length > 0 && p.title.length <= 160 && p.body.length >= 50 && p.body.length <= 20000, '正文长度不合法')
    requireResource(['general', 'frontier_discussion', 'note', 'question'].includes(p.postType), '帖子类型不合法')
    requireResource(manifest.images.some(a => a.id === p.image) && p.replies.length === 2, '配图或叠楼缺失')
    requireResource(p.replies[0]!.authorId !== p.authorId && p.replies[1]!.authorId === p.authorId, '叠楼作者关系不符')
    for (const r of p.replies) requireResource(/^aix01-comment-\d+-[12]$/.test(r.id) && users.has(r.authorId) && r.body.length > 5 && r.body.length < 2000, '回复不合法')
  }
  const replies = content.posts.flatMap(p => p.replies)
  requireResource(unique(replies.map(r => r.id)) && unique(replies.map(r => r.body)), '回复重复')
  const canonicalRoot = await realpath(root)
  const images = []
  for (const a of manifest.images) {
    requireResource(/^images\/[a-z-]+\.webp$/.test(a.file), '图片路径不合法')
    const target = path.join(root, a.file)
    requireResource((await lstat(target)).isFile() && await realpath(target) === path.join(canonicalRoot, a.file), '图片必须位于资源目录且不能是符号链接')
    const buffer = await readFile(target)
    requireResource(buffer.length === a.bytes && buffer.length <= 5 * 1024 * 1024 && digest(buffer) === a.sha256, '图片摘要或大小不符')
    const file = { buffer, size: buffer.length, originalname: content.batch + '-' + path.basename(a.file), mimetype: 'image/webp' }
    const size = await inspectMediaImage(file)
    requireResource(size.width === a.width && size.height === a.height, '图片尺寸不符')
    images.push({ asset: a, file })
  }
  return { content, manifest, images }
}

/** 凭据先落入私有持久目录，再提交账号；重试复用同一清单，不输出密码。 */
async function credentials(file: string, content: Content, config: ConfigService) {
  const target = path.resolve(file), storageRoot = path.resolve(config.get('STORAGE_LOCAL_PATH') || './var/uploads')
  requireResource(!target.startsWith(storageRoot + path.sep) && target !== storageRoot, '凭据文件不能放入上传目录')
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
  const present = await lstat(target).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; return null })
  if (!present) {
    const temporary = target + '.' + randomBytes(8).toString('hex') + '.pending'
    const handle = await open(temporary, 'wx', 0o600)
    try {
      const accounts = content.profiles.map(p => ({ username: p.username, password: randomBytes(24).toString('base64url') + '!a9' }))
      await handle.chmod(0o600)
      await handle.writeFile(JSON.stringify({ pack: starterPackId, accounts }, null, 2), 'utf8')
      await handle.sync()
      await link(temporary, target)
      const directory = await open(path.dirname(target), 'r')
      try { await directory.sync() } finally { await directory.close() }
    } finally { await handle.close(); await rm(temporary, { force: true }) }
  }
  const input = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW)
  let saved: { pack: string; accounts: Credential[] }
  try {
    const info = await input.stat()
    requireResource(info.isFile() && (info.mode & 0o077) === 0, '凭据文件必须是0600普通文件')
    saved = JSON.parse(await input.readFile('utf8')) as typeof saved
  } finally { await input.close() }
  requireResource(saved.pack === starterPackId && saved.accounts.length === 30, '已有凭据文件不属于本批次')
  for (const p of content.profiles) requireResource(saved.accounts.filter(c => c.username === p.username && c.password.length >= 30).length === 1, '已有凭据账号不匹配')
  return new Map(await Promise.all(saved.accounts.map(async c => [c.username, await passwordHash(c.password, 12)] as const)))
}

export async function importCommunityStarter(prisma: PrismaClient, config = new ConfigService(), options: { root?: string; storage?: StorageService } = {}): Promise<ImportResult> {
  const { content, manifest, images } = await readStarterBundle(options.root)
  const summary = { pack: starterPackId, accounts: 30, posts: 100, comments: 200, images: 20 }
  const storage = options.storage || createStorageAdapter(prisma as PrismaService, config)
  const newFiles: string[] = []
  try {
    return await prisma.$transaction(async tx => {
      await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))::text', starterSettingKey)
      const marker = await tx.systemSetting.findUnique({ where: { key: starterSettingKey } })
      if (marker) {
        const value = marker.value as Record<string, unknown>
        requireResource(value.pack === starterPackId && value.contentSha256 === manifest.contentSha256, '已安装版本不同，请使用显式升级流程')
        return { ...summary, status: 'skipped' }
      }
      const existingPosts = await tx.communityPost.findMany({ where: { OR: [{ id: { in: content.posts.map(p => p.id) } }, { sourceId: content.batch }] }, select: { id: true, sourceId: true, sourceType: true } })
      const existingUsers = await tx.user.findMany({ where: { OR: [{ id: { in: content.profiles.map(p => p.id) } }, { username: { in: content.profiles.map(p => p.username) } }, { email: { in: content.profiles.map(p => p.email) } }] }, select: { id: true, profile: true } })
      const legacyImport = await tx.auditLog.findFirst({ where: { action: 'community.managed_content.import', targetType: 'community_batch', targetId: content.batch } })
      const legacyOwned = legacyImport && existingUsers.length === 30 && existingUsers.every(u => content.profiles.some(p => p.id === u.id) && (u.profile as Record<string, unknown>).contentBatch === content.batch) && existingPosts.every(p => content.posts.some(s => s.id === p.id) && p.sourceId === content.batch && p.sourceType === 'managed_community_content')
      requireResource(legacyOwned || (!existingUsers.length && !existingPosts.length && !legacyImport), '账号或帖子标识已占用，未覆盖现有数据')
      const admin = await tx.user.findFirst({ where: { status: 'active', userRoles: { some: { role: { code: { in: ['admin', 'super_admin'] } } } } }, orderBy: { createdAt: 'asc' }, select: { id: true } })
      requireResource(admin, '请先运行基础bootstrap并配置管理员')
      const mark = async (status: 'created' | 'adopted') => {
        await tx.systemSetting.create({ data: { key: starterSettingKey, value: { ...summary, batch: content.batch, contentSha256: manifest.contentSha256, status } } })
        await tx.auditLog.create({ data: { actorId: admin.id, action: 'community.starter.' + status, targetType: 'community_batch', targetId: content.batch, details: { ...summary, contentSha256: manifest.contentSha256 } } })
        return { ...summary, status }
      }
      // 旧部署的完整导入审计是完成凭据；接管后不复活已删除帖子，不更改密码、正文、审核或排序。
      if (legacyOwned) return mark('adopted')
      const role = await tx.role.findUniqueOrThrow({ where: { code: 'student' } })
      await new CommunityVisibilityPolicyService(prisma as PrismaService).assertMediaEligibility(admin.id)
      const hashes = await credentials(config.get('COMMUNITY_STARTER_CREDENTIALS_FILE') || './var/initialization/community-accounts.json', content, config)
      const fileIds = new Map<string, string>()
      for (const { asset, file } of images) {
        const existing = await tx.fileRecord.findFirst({ where: { originalName: file.originalname, checksum: asset.sha256, uploadedBy: admin.id, quarantinedAt: null } })
        if (existing && await storage.exists(existing.id)) { fileIds.set(asset.id, existing.id); continue }
        const uploaded = await storage.upload(file, { uploadedBy: admin.id, visibility: 'private', maxBytes: 5 * 1024 * 1024 })
        newFiles.push(uploaded.id)
        requireResource(!uploaded.securityScan?.quarantined, '图片扫描未通过，停止发布')
        fileIds.set(asset.id, uploaded.id)
      }
      for (const p of content.profiles) await tx.user.create({ data: {
        id: p.id, username: p.username, displayName: p.displayName, email: p.email, passwordHash: hashes.get(p.username),
        registrationSource: content.batch, profile: { demo: true, managed: true, contentBatch: content.batch },
        userRoles: { create: { roleId: role.id } }, communityProfile: { create: { bio: p.bio, postCount: content.posts.filter(s => s.authorId === p.id).length } },
      } })
      const now = Date.now() - 60000
      for (const [i, p] of content.posts.entries()) {
        const contentBlocks: CommunityContentBlock[] = [{ type: 'paragraph', text: p.body }, { type: 'image', fileId: fileIds.get(p.image)!, alt: p.category + '原创概念配图' }]
        const stamp = new Date(now + i * 200)
        await tx.communityPost.create({ data: {
          id: p.id, authorId: p.authorId, title: p.title, body: p.body, plainText: p.body, postType: p.postType,
          status: 'published', visibility: 'public', contentBlocks: contentBlocks as Prisma.InputJsonValue,
          contentHash: digest(p.body.replace(/\s+/g, '').toLowerCase()), labels: [p.category],
          sourceType: 'managed_community_content', sourceId: content.batch, createdAt: stamp, publishedAt: stamp, commentCount: 2,
          ...(p.postType === 'question' ? { question: { create: { status: 'open' } } } : {}),
          revisions: { create: { revisionNo: 1, editorId: admin.id, editorType: 'import', titleSnapshot: p.title, contentBlocksSnapshot: contentBlocks as Prisma.InputJsonValue, bindingsSnapshot: [], topicIdsSnapshot: [], visibilitySnapshot: 'public', statusSnapshot: 'published', reason: '初始化原创社区资源 ' + starterPackId } },
        } })
        for (const [j, r] of p.replies.entries()) await tx.communityComment.create({ data: {
          id: r.id, postId: p.id, authorId: r.authorId, body: r.body, contentBlocks: [{ type: 'paragraph', text: r.body }],
          ...(j ? { parentId: p.replies[0]!.id, rootId: p.replies[0]!.id } : {}),
          createdAt: new Date(stamp.getTime() + (j + 1) * 50),
        } })
      }
      if (!await tx.systemSetting.findUnique({ where: { key: 'community_feed_policy' } })) {
        const policy = structuredClone(learningFeedPolicy)
        const scale = .45 / (1 - policy.weights.freshness!)
        for (const key of Object.keys(policy.weights)) policy.weights[key] = key === 'freshness' ? .55 : policy.weights[key]! * scale
        policy.candidateLimits.exploration = 60
        policy.version = 'community-fresh-' + starterPackId
        await tx.systemSetting.create({ data: { key: 'community_feed_policy', value: policy as unknown as Prisma.InputJsonValue } })
      }
      return mark('created')
    }, { timeout: 180000, maxWait: 15000 })
  } catch (error) {
    for (const id of newFiles) await releaseUnboundMediaFile(prisma, storage, id).catch(() => undefined)
    throw error
  }
}

export async function communityStarterMain() {
  if (process.argv.includes('--check')) { await readStarterBundle(); console.log(JSON.stringify({ pack: starterPackId, resources: 'verified' })); return }
  const prisma = new PrismaClient()
  try { console.log(JSON.stringify(await importCommunityStarter(prisma))) } finally { await prisma.$disconnect() }
}
if (require.main === module) communityStarterMain().catch(() => { console.error('社区初始化失败，请检查资源、数据库、存储和私有凭据目录；现有账号与内容不会被覆盖'); process.exitCode = 1 })
