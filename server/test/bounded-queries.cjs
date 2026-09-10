// 在 NAS 独立 PostgreSQL 容器运行；同一份合成数据分别交给基线和候选镜像。
const assert = require('node:assert/strict')
const { randomBytes } = require('node:crypto')
const { mkdtemp, readFile, rm, writeFile } = require('node:fs/promises')
const { cpus, totalmem, tmpdir } = require('node:os')
const { join } = require('node:path')
const { performance } = require('node:perf_hooks')
const database = new URL(process.env.DATABASE_URL || 'file:///missing')
assert(process.platform === 'linux' && process.env.QUERY_ISOLATED === 'true' && database.hostname === '127.0.0.1' && database.port === '55441' && database.pathname === '/community_queries_acceptance', '仅允许 NAS 专属 community_queries_acceptance 隔离数据库')
assert(process.env.QUERY_PASSWORD?.length >= 24, '由隔离验收环境提供合成账号密码，禁止使用真实账号')
require('reflect-metadata')
const { PrismaClient, Prisma } = require('@prisma/client')
const { hash } = require('bcryptjs')
const db = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] })
let measurement = null
db.$on('query', event => {
  if (!measurement) return
  measurement.queries++
  measurement.databaseMs += event.duration
})
const instrumented = db.$extends({ query: { $allOperations: async ({ operation, args, query }) => {
  const result = await query(args)
  if (measurement && /^(find|groupBy|aggregate|count|\$queryRaw)/.test(operation)) {
    const rows = Array.isArray(result) ? result.length : result == null ? 0 : 1
    measurement.resultRows += rows
    measurement.maxResultRows = Math.max(measurement.maxResultRows, rows)
  }
  return result
} } })
const id = (kind, index) => `query-${kind}-${String(index).padStart(5, '0')}`
const origin = 'http://127.0.0.1:8088', adminOrigin = 'http://127.0.0.1:8089'
const variant = process.env.QUERY_VARIANT || 'candidate'
assert(['baseline', 'candidate'].includes(variant), '必须明确基线或候选镜像')
let app, base, storage, studentToken, adminToken
const cookies = { student: '', admin: '' }
const chunks = async (model, rows) => {
  for (let offset = 0; offset < rows.length; offset += 500) await db[model].createMany({ data: rows.slice(offset, offset + 500) })
}

async function seed() {
  const count = Number(process.env.QUERY_POSTS || 2000)
  assert(Number.isInteger(count) && count >= 1000 && count <= 20000, '代表数据限定为1000至20000条投稿')
  assert.equal(await db.user.count(), 0, '合成数据只能写入空的专属隔离库，不覆盖已有数据')
  const { bootstrapDatabase } = require('../dist/modules/persistence/bootstrap.js')
  await bootstrapDatabase(db)
  const roles = await db.role.findMany({ where: { code: { in: ['student', 'teacher', 'super_admin'] } } })
  const passwordHash = await hash(process.env.QUERY_PASSWORD, 4), anchor = new Date()
  await chunks('school', [0, 1].map(index => ({ id: id('school', index), code: id('school', index), name: `隔离合成学校${index}` })))
  await chunks('user', Array.from({ length: 41 }, (_, index) => ({ id: id('user', index), username: id('user', index), displayName: `隔离合成用户${index}`, email: `${id('user', index)}@example.invalid`, passwordHash, emailVerifiedAt: anchor, onboardingCompletedAt: anchor, schoolId: id('school', index % 2) })))
  await chunks('userRole', Array.from({ length: 41 }, (_, index) => ({ userId: id('user', index), roleId: roles.find(role => role.code === (index === 40 ? 'super_admin' : index === 2 ? 'teacher' : 'student')).id })))
  await chunks('communityProfile', Array.from({ length: 41 }, (_, index) => ({ userId: id('user', index), verifiedType: index === 2 ? 'teacher' : 'none' })))
  await chunks('resourceCategory', Array.from({ length: 4 }, (_, index) => ({ id: id('category', index), code: id('category', index), name: `合成分类${index}`, icon: 'resource', sortOrder: index })))
  const date = days => new Date(anchor.getTime() - days * 86400000)
  const posts = Array.from({ length: count }, (_, index) => ({
    id: id('post', index), authorId: id('user', index % 4 === 0 ? 0 : index % 40), postType: 'note',
    status: index > 3 && index % 19 === 0 ? 'draft' : index > 3 && index % 23 === 0 ? 'pending_review' : 'published', visibility: index > 3 && index % 17 === 0 ? 'school' : 'public', schoolId: id('school', index % 2),
    title: `合成查询教程 ${index}`, body: '用于独立测试库的代表性长文本。'.repeat(100), plainText: '用于独立测试库的代表性长文本。'.repeat(100),
    contentBlocks: [{ type: 'paragraph', text: '用于独立测试库的代表性长文本。'.repeat(100) }], contentHash: id('hash', index),
    publishedAt: index > 3 && (index % 19 === 0 || index % 23 === 0) ? null : date(index <= 3 ? 45 : index % 50 + 1), createdAt: date(60), updatedAt: date(1), impressionCount: 5000 + index,
  }))
  await chunks('communityPost', posts)
  const videos = posts.filter((_, index) => index % 3 === 0)
  await chunks('fileRecord', videos.map(post => ({ id: post.id + '-source', objectKey: post.id + '.mp4', storageDriver: 'local', originalName: '合成媒体元数据.mp4', extension: '.mp4', mimeType: 'video/mp4', size: 1000000, checksum: '0'.repeat(64), uploadedBy: post.authorId })))
  await chunks('videoAsset', videos.map(post => ({ id: post.id + '-video', uploaderId: post.authorId, sourceFileId: post.id + '-source', playableFileId: post.id + '-source', status: 'ready', durationSeconds: 120, width: 1280, height: 720, videoCodec: 'h264', audioCodec: 'aac', originalName: '合成媒体元数据.mp4', originalMimeType: 'video/mp4', updatedAt: anchor })))
  await chunks('resourceContribution', posts.map((post, index) => ({ postId: post.id, kind: ['video', 'article', 'document'][index % 3], categoryId: id('category', index % 4), videoAssetId: index % 3 === 0 ? post.id + '-video' : null, tags: ['合成标签', `标签${index % 8}`], featured: index < 3, updatedAt: anchor })))
  await chunks('contentReview', posts.filter(post => post.status !== 'draft').map(post => ({ targetType: 'post', targetId: post.id, postId: post.id, contentRevision: 1, ruleVersion: 1, authorId: post.authorId, submittedById: post.authorId, action: post.status === 'pending_review' ? 'review' : 'allow', status: post.status === 'pending_review' ? 'pending' : 'approved', findings: [] })))
  await chunks('communityFeedback', [
    { userId: id('user', 0), targetId: id('user', 38), feedbackType: 'block' },
    { userId: id('user', 0), targetId: id('user', 37), feedbackType: 'mute_author' },
    { userId: id('user', 36), targetId: id('user', 0), feedbackType: 'block' },
    { userId: id('user', 0), targetId: id('post', 10), feedbackType: 'hide' },
    { userId: id('user', 4), targetId: id('post', 8), feedbackType: 'not_interested', postType: 'note' },
  ])
  await chunks('communityModerationAction', [
    { subjectId: id('user', 35), targetType: 'profile', targetId: id('user', 35), action: 'ban' },
    { subjectId: id('user', 34), targetType: 'profile', targetId: id('user', 34), action: 'takedown' },
    { subjectId: id('user', 33), targetType: 'profile', targetId: id('user', 33), action: 'ban', expiresAt: date(1) },
    { subjectId: id('user', 32), targetType: 'profile', targetId: id('user', 32), action: 'ban', revokedAt: date(1) },
    { subjectId: id('user', 15), targetType: 'post', targetId: id('post', 15), postId: id('post', 15), action: 'takedown' },
  ].map(action => ({ ...action, actorId: id('user', 40), reason: '合成可见性边界' })))
  await db.user.update({ where: { id: id('user', 31) }, data: { status: 'disabled' } })
  await db.communityPost.update({ where: { id: id('post', 14) }, data: { deletedAt: anchor } })
  await db.videoAsset.updateMany({ where: { id: { in: videos.filter(post => { const index = Number(post.id.slice(-5)); return index > 3 && (index % 31 === 0 || index % 60 === 0) }).map(post => post.id + '-video') } }, data: { status: 'failed', attempts: 1, lastError: '合成处理异常' } })
  await chunks('communityReport', posts.filter(post => post.status !== 'draft').map(post => ({ reporterId: id('user', 40), postId: post.id, targetKey: `post:${post.id}`, reason: 'other', description: '合成举报，非真实用户操作', createdAt: anchor })))
  const legacy = Array.from({ length: Math.floor(count / 4) }, (_, index) => ({ id: id('legacy', index), slug: index === 0 ? id('post', 1) : id('legacy-slug', index), title: `合成旧资源 ${index}`, summary: '已发布快照', category: 'document', format: 'pdf', status: 'published', publishedAt: date(2), viewCount: 10, payload: {} }))
  await chunks('resource', legacy)
  await chunks('resourceVersion', legacy.map(row => ({ id: row.id + '-version', resourceId: row.id, versionNo: 1, createdAt: date(2), snapshot: { title: row.title, summary: row.summary, data: { tags: ['合成标签'] } } })))
  await db.$executeRaw`UPDATE resources SET published_version_id = id || '-version' WHERE id LIKE 'query-legacy-%'`
  const events = posts.slice(4).flatMap((post, offset) => Array.from({ length: 20 }, (_, index) => ({ eventType: (offset + 4) % 3 === 0 ? 'resource_valid_watch' : 'community_post_click', targetType: 'post', targetId: post.id, userId: id('user', index), createdAt: date([1, 10, 40][index % 3]), occurredAt: date([1, 10, 40][index % 3]) })))
  for (const [index, views, days] of [[1, 100, 1], [2, 300, 10], [3, 1000, 40]]) events.push(...Array.from({ length: views }, () => ({ eventType: index === 3 ? 'resource_valid_watch' : 'community_post_click', targetType: 'post', targetId: id('post', index), userId: id('user', 0), createdAt: date(days), occurredAt: date(days) })))
  await chunks('activityEvent', events)
  await chunks('resourceView', legacy.flatMap(row => Array.from({ length: 10 }, () => ({ resourceId: row.id, userId: id('user', 0), createdAt: date(10) }))))
  const comment = (kind, index, parentId = null) => ({ id: id(kind, index), postId: id('post', 1), authorId: id('user', 2), parentId, rootId: parentId, body: '合成评论', contentBlocks: [{ type: 'paragraph', text: '合成评论' }], createdAt: date(1), updatedAt: date(1) })
  await chunks('communityComment', Array.from({ length: 520 }, (_, index) => comment('root', index)))
  await chunks('communityComment', Array.from({ length: 521 }, (_, index) => comment('reply', index, id('root', 0))))
  await chunks('learningCollection', Array.from({ length: 60 }, (_, index) => ({ id: id('collection', index), ownerId: id('user', 0), name: `合成合集${index}`, visibility: index === 0 || index % 2 ? 'private' : 'community', systemKind: index === 0 ? 'watch_later' : null, updatedAt: date(1) })))
  await chunks('learningCollectionItem', posts.slice(4).map((post, index) => ({ id: id('collection-item', index), collectionId: id('collection', 59), contributionPostId: post.id, sortOrder: index })))
  await db.systemSetting.upsert({ where: { key: 'resource_hub_config' }, create: { key: 'resource_hub_config', value: { bannerPostIds: [], sectionCategoryCodes: [0, 1, 2, 3].map(index => id('category', index)) } }, update: { value: { bannerPostIds: [], sectionCategoryCodes: [0, 1, 2, 3].map(index => id('category', index)) } } })
  const counts = Object.fromEntries(await Promise.all(['communityPost', 'resource', 'activityEvent', 'communityComment', 'user', 'videoAsset', 'fileRecord', 'learningCollection', 'contentReview', 'communityReport'].map(async model => [model, await db[model].count()])))
  await db.systemSetting.create({ data: { key: 'query_acceptance_fixture', value: { version: 1, count, anchor: anchor.toISOString(), counts } } })
  return counts
}

async function request(path, token = studentToken, input, method = input ? 'POST' : 'GET') {
  const client = path.startsWith('/admin') ? 'admin' : 'student'
  const response = await fetch(base + path, { method, headers: { origin: client === 'admin' ? adminOrigin : origin, 'content-type': 'application/json', ...(path.endsWith('/refresh') ? { cookie: cookies[client] } : {}), ...(token ? { authorization: 'Bearer ' + token } : {}) }, ...(input ? { body: JSON.stringify(input) } : {}) })
  for (const header of response.headers.getSetCookie()) if (header.startsWith(client + '_refresh=')) cookies[client] = header.split(';')[0]
  const payload = await response.json()
  assert(response.ok, `${path.split('?')[0]} 返回 ${response.status}：${payload.message || '请求失败'}`)
  return payload.data
}

async function start() {
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: id('user', 40) }, select: { mfaEnabledAt: true } })).mfaEnabledAt, null, '每个验收或测量进程必须从同一份全新合成快照恢复')
  const { Test } = require('@nestjs/testing')
  const { Reflector } = require('@nestjs/core')
  const { ConfigService } = require('@nestjs/config')
  const { AppModule } = require('../dist/app.module.js')
  const { PrismaService } = require('../dist/prisma/prisma.service.js')
  const { browserBoundary } = require('../dist/common/deployment-security.js')
  const { appValidationPipe } = require('../dist/common/validation.pipe.js')
  const { ApiExceptionFilter } = require('../dist/common/api-exception.filter.js')
  const { ApiResponseInterceptor } = require('../dist/common/api-response.interceptor.js')
  const { OperationLogInterceptor } = require('../dist/common/operation-log.interceptor.js')
  const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(instrumented).compile()
  app = module.createNestApplication({ logger: false })
  app.use(require('cookie-parser')()); app.use(browserBoundary(app.get(ConfigService)))
  app.setGlobalPrefix('api/v1'); app.useGlobalPipes(appValidationPipe); app.useGlobalFilters(new ApiExceptionFilter())
  app.useGlobalInterceptors(app.get(OperationLogInterceptor), new ApiResponseInterceptor(app.get(Reflector)))
  await app.listen(0, '127.0.0.1'); base = await app.getUrl() + '/api/v1'
  studentToken = (await request('/auth/login', null, { identifier: id('user', 0), password: process.env.QUERY_PASSWORD })).accessToken
  const challenge = await request('/admin-auth/login', null, { identifier: id('user', 40), password: process.env.QUERY_PASSWORD })
  assert(challenge.mfaRequired && challenge.secret, '使用隔离库全新管理员完成真实MFA，不跳过守卫')
  const { generate } = require('otplib')
  adminToken = (await request('/admin-auth/mfa', null, { challenge: challenge.challenge, code: await generate({ secret: challenge.secret }) })).accessToken
}

async function verify() {
  const { CommunityVisibilityPolicyService } = require('../dist/modules/community/visibility.service.js')
  const visibility = app.get(CommunityVisibilityPolicyService)
  const checks = []
  for (const viewer of [id('user', 0), id('user', 1), id('user', 4)]) {
    const oldScope = await db.communityPost.findMany({ where: await visibility.where(viewer), select: { id: true } })
    const sqlScope = await db.$queryRaw(Prisma.sql`SELECT p.id FROM community_posts p WHERE ${await visibility.publicPostsSql(viewer)}`)
    assert.deepEqual(sqlScope.map(row => row.id).sort(), oldScope.map(row => row.id).sort())
  }
  checks.push('两所学校、双向屏蔽、静音、隐藏、封禁及过期撤销处罚的SQL与原策略等价')
  const pageIds = [], cursors = new Set()
  let cursor = ''
  do {
    const page = await request('/resource-hub/items?' + new URLSearchParams({ limit: '48', cursor }))
    assert(page.items.length <= 48)
    pageIds.push(...page.items.map(row => `${row.sourceType}:${row.id}`))
    cursor = page.nextCursor
    if (cursor) { assert(!cursors.has(cursor), '游标必须前进'); cursors.add(cursor) }
  } while (cursor)
  const expectedPosts = await db.communityPost.findMany({ where: { AND: [await visibility.where(id('user', 0)), { contribution: { is: { OR: [{ kind: { not: 'video' } }, { videoAsset: { status: 'ready' } }] } } }] }, select: { id: true } })
  const expectedLegacy = await db.resource.findMany({ where: { status: 'published', deletedAt: null }, select: { slug: true } })
  assert.deepEqual(pageIds.slice().sort(), [...expectedPosts.map(row => `contribution:${row.id}`), ...expectedLegacy.map(row => `legacy_resource:${row.slug}`)].sort())
  assert.equal(new Set(pageIds).size, pageIds.length)
  checks.push('混合来源全部翻页无重复与遗漏，同名投稿和旧资源均保留')
  for (const [path, expected] of [
    ['/admin/resource-hub/processing-failures', await db.videoAsset.count({ where: { status: 'failed' } })],
    ['/admin/resource-hub/collections', await db.learningCollection.count({ where: { visibility: 'community' } })],
    ['/admin/resource-hub/reports', await db.communityReport.count()],
    ['/admin/resource-hub/items', await db.communityPost.count({ where: { AND: [await visibility.adminWhere(), { contribution: { isNot: null } }] } })],
  ]) {
    const ids = [], visited = new Set(); let next = ''
    do {
      const page = await request(path + '?' + new URLSearchParams({ limit: '48', cursor: next }), adminToken)
      assert(page.items.length <= 48); ids.push(...page.items.map(row => row.id)); next = page.nextCursor
      if (next) { assert(!visited.has(next)); visited.add(next) }
    } while (next)
    assert.equal(ids.length, expected); assert.equal(new Set(ids).size, expected)
  }
  let collectionsCursor = ''; const collectionIds = []
  do {
    const page = await request(`/resource-hub/creators/${id('user', 0)}?` + new URLSearchParams({ collectionsCursor }))
    assert(page.collections.length <= 18); collectionIds.push(...page.collections.map(row => row.id)); collectionsCursor = page.collectionsNextCursor
  } while (collectionsCursor)
  assert.equal(collectionIds.length, 60); assert.equal(new Set(collectionIds).size, 60)
  checks.push('后台资源、处理异常、举报、公开合集及作者合集都可连续翻页')
  let ownCursor = ''; const ownCollections = []
  do {
    const page = await request('/resource-hub/collections?' + new URLSearchParams({ cursor: ownCursor }))
    assert(page.items.length <= 18); ownCollections.push(...page.items.map(row => row.id)); ownCursor = page.nextCursor
    assert.equal(new Set(ownCollections).size, ownCollections.length, '个人合集游标必须前进且不能重复')
  } while (ownCursor)
  const expectedCollections = await db.learningCollection.findMany({ where: { ownerId: id('user', 0) }, orderBy: [{ systemKind: 'desc' }, { updatedAt: 'desc' }, { id: 'desc' }], select: { id: true } })
  assert.deepEqual(ownCollections, expectedCollections.map(row => row.id))
  const studio = await request('/resource-hub/studio')
  for (const [section, condition] of [
    ['items', { status: 'published' }], ['drafts', { status: 'draft' }], ['pendingReview', { status: 'pending_review' }],
    ['processing', { contribution: { is: { videoAsset: { status: { in: ['uploaded', 'processing', 'failed'] } } } } }],
  ]) {
    const expected = await db.communityPost.findMany({ where: { AND: [{ authorId: id('user', 0), deletedAt: null, contribution: { isNot: null } }, condition] }, select: { id: true }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }] })
    assert.equal(studio.counts[section], expected.length)
    assert(studio[section].length <= 18)
    const ids = studio[section].map(row => row.id); let next = studio.nextCursors[section]
    while (next) {
      const page = await request('/resource-hub/studio?' + new URLSearchParams({ section, cursor: next }))
      assert(page[section].length <= 18); assert.equal(page.counts[section], expected.length)
      ids.push(...page[section].map(row => row.id)); next = page.nextCursors[section]
      assert.equal(new Set(ids).size, ids.length, '工作室游标必须前进且不能重复')
    }
    assert.deepEqual(ids, expected.map(row => row.id))
  }
  checks.push('个人合集保持系统分类排序，工作室四组均有界翻页且计数为完整数量')
  const collectionId = id('collection', 59), collectionPath = `/resource-hub/collections/${collectionId}`
  const members = await db.learningCollectionItem.findMany({ where: { collectionId, contribution: { post: await visibility.where(id('user', 0)) } }, select: { id: true, contributionPostId: true, sortOrder: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] })
  assert(members.length > 521, '大合集应含超过500项可见内容')
  const memberIds = []; let memberCursor = ''
  do {
    const page = await request(collectionPath + '?' + new URLSearchParams({ cursor: memberCursor }))
    assert(page.items.length <= 18); assert.equal(page.itemCount, members.length)
    memberIds.push(...page.items.map(row => row.id)); memberCursor = page.nextCursor
    assert.equal(new Set(memberIds).size, memberIds.length, '合集成员游标必须前进且不能重复')
  } while (memberCursor)
  assert.deepEqual(memberIds, members.map(row => row.id))
  const focused = (await request(`/resource-hub/contributions/${members[520].contributionPostId}`)).collection
  assert.equal(focused.id, collectionId); assert.equal(focused.items[0].id, members[520].id); assert.equal(focused.items[1].id, members[521].id)
  const previous = await request(collectionPath + '?' + new URLSearchParams({ cursor: focused.previousCursor, direction: 'before', limit: '2' }))
  assert.deepEqual(previous.items.map(row => row.id), members.slice(518, 520).map(row => row.id))
  const stored = await db.learningCollectionItem.findMany({ where: { collectionId }, select: { id: true, sortOrder: true }, orderBy: { id: 'asc' } })
  const selected = [members[10], members[520]]
  let reordered = false
  try {
    const changed = await request(collectionPath + '/order', studentToken, { expectedRevision: focused.revision, itemIds: selected.map(row => row.id).reverse() }, 'PUT')
    reordered = true
    assert.equal(changed.revision, focused.revision + 1)
    const actual = await db.learningCollectionItem.findMany({ where: { collectionId }, select: { id: true, sortOrder: true }, orderBy: { id: 'asc' } })
    assert.deepEqual(actual, stored.map(row => ({ ...row, sortOrder: row.id === selected[0].id ? selected[1].sortOrder : row.id === selected[1].id ? selected[0].sortOrder : row.sortOrder })))
  } finally {
    if (reordered) {
      const current = await db.learningCollection.findUniqueOrThrow({ where: { id: collectionId }, select: { revision: true } })
      await request(collectionPath + '/order', studentToken, { expectedRevision: current.revision, itemIds: selected.map(row => row.id) }, 'PUT')
      assert.deepEqual(await db.learningCollectionItem.findMany({ where: { collectionId }, select: { id: true, sortOrder: true }, orderBy: { id: 'asc' } }), stored)
    }
  }
  checks.push('大合集完整分页，后续资源聚焦和上一页正确，局部排序保留其他全部成员')
  for (const [parentId, count] of [['', 520], [id('root', 0), 521]]) {
    const comments = []; let next = ''
    do {
      const page = await request(`/community/posts/${id('post', 1)}/comments?` + new URLSearchParams({ limit: '50', ...(parentId ? { parentId } : {}), ...(next ? { cursor: next } : {}) }))
      assert(page.items.length <= 50); comments.push(...page.items); next = page.nextCursor
    } while (next)
    assert.equal(comments.length, count); assert.equal(new Set(comments.map(row => row.id)).size, count)
    assert(comments.every(row => row.parentId === (parentId || null)))
  }
  checks.push('520条一级评论和521条回复均可读取，父子关联保持')
  try {
    await db.communityComment.update({ where: { id: id('root', 0) }, data: { deletedAt: new Date(), status: 'deleted' } })
    const page = await request(`/community/posts/${id('post', 1)}/comments?limit=1`)
    assert.equal(page.items[0].id, id('root', 0)); assert.equal(page.items[0].deleted, true)
    const target = await request(`/community/posts/${id('post', 1)}/comments/${id('reply', 520)}`)
    assert.equal(target.parentId, id('root', 0))
  } finally { await db.communityComment.update({ where: { id: id('root', 0) }, data: { deletedAt: null, status: 'published' } }) }
  checks.push('删除父项保留占位，后续回复可定向读取')
  const home = await request('/resource-hub/home')
  assert(home.collections.length <= 4)
  assert.deepEqual(home.collections.map(row => row.id), ownCollections.slice(0, 4))
  for (const [period, index, views] of [['week', 1, 100], ['month', 2, 300], ['all', 3, 1000]]) {
    assert.equal(home.rankings[period][0].id, id('post', index)); assert.equal(home.rankings[period][0].rankingViews, views)
  }
  const detail = await request(`/resource-hub/contributions/${id('post', 3)}`)
  assert.equal(detail.stats.plays, 1000); assert.equal(detail.stats.impressions, 5003)
  const hiddenName = await request('/resource-hub/items?' + new URLSearchParams({ keyword: '隔离合成用户34' }))
  assert.equal(hiddenName.items.length, 0, '不能利用搜索读取已下架资料中的作者名称')
  checks.push('周期榜按事件时间而非发布时间，播放与曝光分开')
  return checks
}

async function benchmark(path, concurrency, samples) {
  if (path.startsWith('/admin/')) adminToken = (await request('/admin-auth/refresh', adminToken, {})).accessToken
  else studentToken = (await request('/auth/refresh', studentToken, {})).accessToken
  const token = path.startsWith('/admin/') ? adminToken : studentToken
  for (let warmup = 0; warmup < 3; warmup++) await request(path, token)
  global.gc?.()
  const before = process.memoryUsage(), start = performance.now(), latencies = []
  let next = 0, peakRss = before.rss, peakHeap = before.heapUsed
  measurement = { queries: 0, databaseMs: 0, resultRows: 0, maxResultRows: 0 }
  const timer = setInterval(() => { const memory = process.memoryUsage(); peakRss = Math.max(peakRss, memory.rss); peakHeap = Math.max(peakHeap, memory.heapUsed) }, 10)
  try {
    const workers = await Promise.allSettled(Array.from({ length: concurrency }, async () => {
      while (next++ < samples) { const at = performance.now(); await request(path, token); latencies.push(performance.now() - at) }
    }))
    const failure = workers.find(result => result.status === 'rejected')
    if (failure) throw failure.reason
    const after = process.memoryUsage(); peakRss = Math.max(peakRss, after.rss); peakHeap = Math.max(peakHeap, after.heapUsed)
    latencies.sort((a, b) => a - b)
    return { path, concurrency, samples, elapsedMs: performance.now() - start, p50Ms: latencies[Math.ceil(samples * .5) - 1], p95Ms: latencies[Math.ceil(samples * .95) - 1], ...measurement, queriesPerRequest: measurement.queries / samples, resultRowsPerRequest: measurement.resultRows / samples, beforeRssBytes: before.rss, peakRssBytes: peakRss, peakHeapBytes: peakHeap, processPeakRssBytes: process.resourceUsage().maxRSS * 1024 }
  } finally { clearInterval(timer); measurement = null }
}

async function plans() {
  const { ResourceHubService } = require('../dist/modules/resources/resource-hub.service.js')
  const { ResourceHubQueryDto } = require('../dist/modules/resources/resource-hub.dto.js')
  const { CommunityVisibilityPolicyService } = require('../dist/modules/community/visibility.service.js')
  const viewer = id('user', 0), asOf = new Date(), scope = await app.get(CommunityVisibilityPolicyService).publicPostsSql(viewer)
  const results = []
  // 复用候选实现生成参数化 SQL，保留 Date/数组参数类型；不手写一份近似查询。
  for (const [name, query, options] of [
    ['latest', {}, {}], ['popular', { sort: 'popular' }, {}],
    ['week', { sort: 'popular' }, { since: new Date(asOf.getTime() - 7 * 86400000) }],
    ['category', { category: id('category', 1) }, {}],
    ['related', { limit: 6 }, { related: { postId: id('post', 1), categoryId: id('category', 1), tags: ['合成标签'] } }],
  ]) {
    const sql = await ResourceHubService.prototype.selectItems.call({ prisma: { $queryRaw: async statement => statement } }, viewer, { ...new ResourceHubQueryDto(), ...query }, options, scope, asOf)
    results.push({ name, plan: await db.$queryRaw(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`) })
  }
  return results
}

async function main() {
  storage = await mkdtemp(join(tmpdir(), 'query-acceptance-'))
  Object.assign(process.env, {
    DEPLOYMENT_PROFILE: 'experience', LOAD_DEMO_DATA: 'false', VITE_DATA_MODE: 'api', COOKIE_SECURE: 'false', NODE_ENV: 'test',
    FRONTEND_URL: origin, ADMIN_WEB_URL: adminOrigin, CORS_ORIGINS: origin + ',' + adminOrigin,
    ADMIN_NETWORK_CIDRS: '127.0.0.1/32,::1/128', TRUSTED_PROXY_CIDRS: '', VIDEO_PROCESSING_ENABLED: 'false',
    JWT_SECRET: randomBytes(48).toString('base64url'), MFA_DATA_KEY: randomBytes(32).toString('hex'), IDENTITY_DATA_KEY: randomBytes(32).toString('hex'), VIDEO_PLAYBACK_SECRET: randomBytes(48).toString('base64url'),
    STORAGE_DRIVER: 'local', STORAGE_LOCAL_PATH: storage, SEED_ADMIN_EMAIL: 'query-bootstrap@example.invalid', SEED_ADMIN_PASSWORD: process.env.QUERY_PASSWORD,
  })
  if (process.argv.includes('--seed')) { console.log(JSON.stringify({ seeded: await seed() })); return }
  const fixture = await db.systemSetting.findUniqueOrThrow({ where: { key: 'query_acceptance_fixture' } })
  assert.equal(fixture.value.version, 1)
  await start()
  const indexes = await db.$queryRaw`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename IN ('community_comments', 'content_reviews', 'activity_events', 'resource_views') ORDER BY indexname`
  const report = { variant, sourceArchiveSha256: process.env.QUERY_SOURCE_SHA || null, indexes, fixture: fixture.value, hardware: { architecture: process.arch, logicalCpus: cpus().length, memoryBytes: totalmem(), cpuQuota: await readFile('/sys/fs/cgroup/cpu.max', 'utf8').catch(() => 'unavailable'), memoryLimit: await readFile('/sys/fs/cgroup/memory.max', 'utf8').catch(() => 'unavailable') }, checks: [], benchmarks: [], plans: [] }
  if (process.argv.includes('--verify')) {
    assert.equal(variant, 'candidate'); report.checks = await verify()
  } else {
    const samples = Number(process.env.QUERY_SAMPLES || 40)
    assert(Number.isInteger(samples) && samples >= 20 && samples <= 200)
    for (const path of ['/resource-hub/items?limit=18', '/resource-hub/items?limit=18&sort=popular', '/resource-hub/home', `/resource-hub/contributions/${id('post', 1)}`, `/resource-hub/contributions/${id('post', 100)}`, `/resource-hub/creators/${id('user', 0)}`, '/resource-hub/studio', '/resource-hub/collections', `/resource-hub/collections/${id('collection', 59)}`, `/community/posts/${id('post', 1)}/comments?limit=25`, '/admin/resource-hub/items?limit=18']) {
      for (const concurrency of [1, 4]) { const result = await benchmark(path, concurrency, samples); report.benchmarks.push(result); console.log(JSON.stringify(result)) }
    }
    if (variant === 'candidate') report.plans = await plans()
  }
  assert(process.env.QUERY_OUTPUT, '指定本次验收报告路径')
  await writeFile(process.env.QUERY_OUTPUT, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 })
  console.log(JSON.stringify({ variant, checks: report.checks, benchmarks: report.benchmarks.length, complete: true }))
}
main().catch(error => { console.error(error); process.exitCode = 1 }).finally(async () => {
  await app?.close(); await db.$disconnect()
  if (storage) await rm(storage, { recursive: true, force: true })
})
