// 仅供飞牛专属隔离库运行；不会清空数据库，不允许连接现行业务库。
const assert = require('node:assert/strict')
const { createHash, randomBytes } = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')
const { PrismaClient } = require('@prisma/client')
const { ConfigService } = require('@nestjs/config')
const { hash, compare } = require('bcryptjs')
const { bootstrapApplication } = require('../dist/modules/persistence/bootstrap')
const { importCommunityStarter, readStarterBundle, starterSettingKey } = require('../dist/modules/community/import-starter')
const { createStorageAdapter } = require('../dist/modules/storage/storage.module')
const url = new URL(process.env.DATABASE_URL || 'file:///missing')
assert.match(url.pathname, /^\/community_starter_(fresh|legacy)$/)
assert.equal(process.env.COMMUNITY_STARTER_ISOLATED_TEST, 'true')
const db = new PrismaClient(), config = new ConfigService()
const mode = process.argv[2] || 'fresh', checks = []
const mark = message => { checks.push(message); console.log('PASS ' + message) }
const checksum = value => createHash('sha256').update(value).digest('hex')
const out = process.env.COMMUNITY_STARTER_TEST_OUTPUT
async function snapshot() {
  const tables = await db.$queryRawUnsafe("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")
  const result = {}
  for (const { tablename: table } of tables) {
    assert.match(table, /^[a-z0-9_]+$/)
    result[table] = (await db.$queryRawUnsafe('SELECT md5(to_jsonb(t)::text) AS hash FROM "' + table + '" t')).map(r => r.hash).sort()
  }
  return result
}
function preserved(before, after) {
  for (const [table, hashes] of Object.entries(before)) {
    const remaining = new Map()
    for (const h of after[table]) remaining.set(h, (remaining.get(h) || 0) + 1)
    for (const h of hashes) { assert.ok(remaining.get(h) > 0, '旧行发生变化：' + table); remaining.set(h, remaining.get(h) - 1) }
  }
}
async function filesValid() {
  const rows = await db.fileRecord.findMany({ where: { originalName: { startsWith: 'ai-posts-01a08549-' } } })
  assert.equal(rows.length, 20)
  for (const f of rows) assert.equal(checksum(await fs.readFile(path.join(process.env.STORAGE_LOCAL_PATH, f.objectKey))), f.checksum)
}
async function httpCheck(credentials) {
  const { NestFactory, Reflector } = require('@nestjs/core')
  const { AppModule } = require('../dist/app.module')
  const { ApiExceptionFilter } = require('../dist/common/api-exception.filter')
  const { ApiResponseInterceptor } = require('../dist/common/api-response.interceptor')
  const { appValidationPipe } = require('../dist/common/validation.pipe')
  const cookieParser = require('cookie-parser')
  const roles = await db.role.findMany({ where: { code: { in: ['student', 'teacher'] } } })
  const password = randomBytes(24).toString('base64url') + '!a9'
  const reader = await db.user.create({ data: { username: 'isolated_starter_reader', email: 'isolated-starter-reader@example.invalid', displayName: '隔离验收教师', passwordHash: await hash(password, 4), userRoles: { create: roles.map(r => ({ roleId: r.id })) }, communityProfile: { create: { bio: '隔离验收账号', verifiedType: 'teacher' } } } })
  const app = await NestFactory.create(AppModule, { logger: false })
  try {
    app.setGlobalPrefix('api/v1'); app.use(cookieParser()); app.useGlobalPipes(appValidationPipe); app.useGlobalFilters(new ApiExceptionFilter()); app.useGlobalInterceptors(new ApiResponseInterceptor(app.get(Reflector)))
    await app.listen(0, '127.0.0.1')
    const base = await app.getUrl()
    async function request(route, token, payload) {
      const response = await fetch(base + '/api/v1/' + route, { method: payload ? 'POST' : 'GET', headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), 'content-type': 'application/json', origin: base }, ...(payload ? { body: JSON.stringify(payload) } : {}) })
      return { status: response.status, body: await response.json() }
    }
    const login = await request('auth/login', null, { identifier: credentials[0].username, password: credentials[0].password })
    assert.equal(login.status, 201); const ordinary = login.body.data.accessToken
    assert.equal((await request('community/eligibility', ordinary)).body.data.canPost, false)
    const readerLogin = await request('auth/login', null, { identifier: reader.username, password })
    assert.equal(readerLogin.status, 201); const token = readerLogin.body.data.accessToken
    const feed = await request('community/feed?mode=for_you&type=all', ordinary)
    assert.equal(feed.status, 200)
    assert.equal(feed.body.data.items.filter(p => p.type === 'post').slice(0, 10).filter(p => p.id.startsWith('aix01-post-')).length, 10)
    const post = await request('community/posts/aix01-post-001', token)
    assert.equal(post.status, 200); assert.equal(post.body.data.bindings.length, 0)
    const fileId = post.body.data.contentBlocks.find(b => b.type === 'image').fileId
    assert.equal((await fetch(base + '/api/v1/files/' + fileId + '/download', { headers: { authorization: 'Bearer ' + ordinary } })).status, 403)
    const image = await fetch(base + '/api/v1/files/' + fileId + '/download', { headers: { authorization: 'Bearer ' + token } })
    assert.equal(image.status, 200)
    const file = await db.fileRecord.findUniqueOrThrow({ where: { id: fileId } })
    assert.equal(checksum(Buffer.from(await image.arrayBuffer())), file.checksum)
    const roots = await request('community/posts/aix01-post-001/comments', token)
    assert.equal(roots.body.data.items[0].replyCount, 1)
    const children = await request('community/posts/aix01-post-001/comments?parentId=aix01-comment-1-1', token)
    assert.equal(children.body.data.items[0].parentId, 'aix01-comment-1-1')
    mark('真实HTTP登录、推荐前10、图文下载、双层回复及未实名权限边界')
  } finally { await app.close() }
}
async function fresh() {
  assert.equal(await db.user.count(), 0, '空库验收拒绝覆盖已有用户')
  process.env.COMMUNITY_STARTER_PACK = 'none'
  await bootstrapApplication(db)
  assert.equal(await db.communityPost.count(), 0)
  const admin = await db.user.findFirstOrThrow()
  mark('关闭内容包只初始化基础元数据')
  const collision = await db.user.create({ data: { username: 'aix_01', displayName: '保留人工账号', email: 'collision@example.invalid' } })
  await assert.rejects(importCommunityStarter(db, config), /标识已占用/)
  assert.equal(await db.communityPost.count(), 0); assert.equal(await db.fileRecord.count(), 0)
  await db.user.delete({ where: { id: collision.id } })
  mark('人工账号碰撞先拒绝且不写图片和帖子')
  const storage = createStorageAdapter(db, config)
  let uploaded = 0
  const failing = Object.create(storage)
  failing.upload = async (...args) => { if (++uploaded === 2) throw new Error('隔离注入上传失败'); return storage.upload(...args) }
  failing.delete = storage.delete.bind(storage)
  await assert.rejects(importCommunityStarter(db, config, { storage: failing }), /隔离注入/)
  assert.equal(await db.communityPost.count(), 0); assert.equal(await db.user.count(), 1); assert.equal(await db.fileRecord.count(), 0)
  assert.equal(await db.systemSetting.count({ where: { key: starterSettingKey } }), 0)
  mark('中途上传失败回滚账号与内容并回收新增图片')
  const credentialFile = process.env.COMMUNITY_STARTER_CREDENTIALS_FILE
  const credentialBytes = await fs.readFile(credentialFile)
  const results = await Promise.all([importCommunityStarter(db, config), importCommunityStarter(db, config)])
  assert.deepEqual(results.map(r => r.status).sort(), ['created', 'skipped'])
  assert.deepEqual(await fs.readFile(credentialFile), credentialBytes)
  assert.equal((await fs.stat(credentialFile)).mode & 0o777, 0o600)
  assert.equal(await db.communityPost.count(), 100); assert.equal(await db.communityComment.count(), 200); assert.equal(await db.communityPostBinding.count(), 0)
  const credentials = JSON.parse(credentialBytes).accounts
  assert.equal(new Set(credentials.map(c => c.password)).size, 30)
  const users = await db.user.findMany({ where: { registrationSource: 'ai-posts-01a08549' }, include: { userRoles: { include: { role: true } }, communityProfile: true, identityVerification: true } })
  assert.equal(users.length, 30)
  for (const u of users) {
    assert.equal(await compare(credentials.find(c => c.username === u.username).password, u.passwordHash), true)
    assert.deepEqual(u.userRoles.map(r => r.role.code), ['student']); assert.equal(u.identityVerification, null)
    assert.ok(u.communityProfile.bio.startsWith('社区演示账号｜'))
  }
  await filesValid()
  mark('并发仅导入一次，30个随机独立密码、100帖、200回复和20图持久一致')
  await httpCheck(credentials)
  await db.communityPost.update({ where: { id: 'aix01-post-001' }, data: { body: '人工编辑保留', status: 'removed', deletedAt: new Date() } })
  await db.user.update({ where: { id: 'aix01-user-01' }, data: { displayName: '人工昵称保留' } })
  await db.systemSetting.update({ where: { key: 'community_feed_policy' }, data: { value: { manual: true } } })
  const before = await snapshot()
  await fs.rename(credentialFile, credentialFile + '.saved')
  process.env.COMMUNITY_STARTER_PACK = 'ai-discussions-v1'
  await bootstrapApplication(db); await bootstrapApplication(db)
  assert.deepEqual(await snapshot(), before)
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: admin.id } })).passwordHash, admin.passwordHash)
  await fs.rename(credentialFile + '.saved', credentialFile)
  mark('重复初始化零写，保留密码、人工编辑、下架状态和推荐配置')
}
async function legacy() {
  assert.equal(await db.auditLog.count({ where: { action: 'community.managed_content.import', targetId: 'ai-posts-01a08549' } }), 1)
  const before = await snapshot()
  const result = await importCommunityStarter(db, config)
  assert.equal(result.status, 'adopted')
  preserved(before, await snapshot())
  const stable = await snapshot()
  assert.equal((await importCommunityStarter(db, config)).status, 'skipped')
  assert.deepEqual(await snapshot(), stable)
  await filesValid()
  mark('旧批次接管只新增版本标记与审计，所有原行保留且第二次零写')
}
async function run() {
  await fs.mkdir(out, { recursive: true })
  await readStarterBundle()
  if (mode === 'fresh') await fresh()
  else if (mode === 'legacy') await legacy()
  else if (mode === 'verify') {
    await filesValid(); assert.equal(await db.communityPost.count({ where: { sourceId: 'ai-posts-01a08549' } }), 100)
    assert.equal((await importCommunityStarter(db, config)).status, 'skipped')
    mark('数据库重启后批次和20图保持，初始化仍跳过')
  } else throw new Error('未知验收模式')
  await fs.writeFile(path.join(out, mode + '.json'), JSON.stringify({ mode, checks, passed: true }, null, 2), { mode: 0o600 })
}
run().catch(error => { console.error(error.message); process.exitCode = 1 }).finally(() => db.$disconnect())
