import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// 只生成新文件，绝不覆盖既有数据库密码、实名或 MFA 加密密钥。
const [profile, destination] = process.argv.slice(2)
if (!['production', 'experience'].includes(profile) || !destination) {
  console.error('用法：node deploy/compose/init-env.mjs production|experience 新环境文件路径')
  process.exit(1)
}
const file = fileURLToPath(new URL('.env.' + profile + '.example', import.meta.url))
let content = readFileSync(file, 'utf8')
const password = randomBytes(24).toString('hex')
const values = {
  POSTGRES_PASSWORD: password,
  DATABASE_URL: 'postgresql://ai_hub:' + password + '@postgres:5432/ai_learning_hub',
  JWT_SECRET: randomBytes(48).toString('base64url'),
  MFA_DATA_KEY: randomBytes(32).toString('hex'),
  IDENTITY_DATA_KEY: randomBytes(32).toString('hex'),
  VIDEO_PLAYBACK_SECRET: randomBytes(48).toString('base64url'),
}
for (const [name, value] of Object.entries(values)) content = content.replace(new RegExp('^' + name + '=.*$', 'm'), name + '=' + value)
try {
  writeFileSync(resolve(destination), content, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  console.log('已创建受保护配置。请填写实际地址、管理网段和首次管理员；密钥未输出。')
} catch {
  console.error('未写入配置：目标已存在或不可写。既有密钥必须保留，升级只增补缺失配置。')
  process.exitCode = 1
}
