import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

function keyFrom(value: string | undefined) {
  if (!value || !/^[a-f0-9]{64}$/i.test(value)) throw new Error('MFA_DATA_KEY 必须是64位十六进制随机密钥')
  return Buffer.from(value, 'hex')
}
export function encryptMfa(secret: string, key: string | undefined, userId: string) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', keyFrom(key), iv)
  cipher.setAAD(Buffer.from('mfa:v1:' + userId))
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.')
}
export function decryptMfa(value: string, key: string | undefined, userId: string) {
  const [version, iv, tag, encrypted] = value.split('.')
  if (version !== 'v1' || !iv || !tag || !encrypted) throw new Error('MFA 密文无效')
  const cipher = createDecipheriv('aes-256-gcm', keyFrom(key), Buffer.from(iv, 'base64url'))
  cipher.setAAD(Buffer.from('mfa:v1:' + userId)); cipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([cipher.update(Buffer.from(encrypted, 'base64url')), cipher.final()]).toString('utf8')
}
