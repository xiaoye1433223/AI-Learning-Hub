export const PASSWORD_POLICY_MESSAGE = '密码至少12位，须含字母和数字，不能使用常见弱口令或账号信息；最多72个UTF-8字节（汉字通常占3字节）'
export function passwordProblem(password: string, identifiers: string[] = [], minimum = 12): string | null {
  if (new TextEncoder().encode(password).length > 72) return '密码不能超过72个UTF-8字节（汉字通常占3字节）'
  if (password.length < Math.max(12, minimum)) return '密码至少' + Math.max(12, minimum) + '位'
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return '密码须同时包含字母和数字'
  const normalized = password.toLowerCase().replace(/[^a-z0-9]/g, '')
  const common = ['password', 'passw0rd', 'qwerty', '123456', 'abcdef', 'letmein', 'welcome', 'iloveyou', 'admin123', 'changeme']
  if (common.some((word) => normalized.includes(word)) || /(.{1,4})\1{2,}/.test(normalized) || identifiers.some((value) => {
    const name = value.split('@')[0].toLowerCase()
    return name.length >= 4 && normalized.includes(name)
  })) return '密码过于常见或包含账号信息，请使用更难猜测的密码'
  return null
}

export type SessionClient = 'student' | 'admin'
export interface MfaChallengeDto {
  mfaRequired: true
  challenge: string
  enrollment: boolean
  secret?: string
  uri?: string
  experienceHint?: boolean
}
export interface MfaHintDto { code: string | null; expiresAt: number }
export interface MfaVerifyInput { challenge: string; code: string; remember?: boolean }
export interface ReauthenticateInput { currentPassword: string; mfaCode?: string }
export interface ChangePasswordInput extends ReauthenticateInput { password: string }
export interface ChangeEmailInput extends ReauthenticateInput { email: string }
export interface DeviceSessionDto {
  id: string
  client: SessionClient
  device: string
  createdAt: string
  lastUsedAt: string
  expiresAt: string
  current: boolean
}
export interface AccountSecurityDto {
  mfaEnabled: boolean
  mfaRequired: boolean
  recoveryCodesRemaining: number
  mailAvailable: boolean
  passwordMinLength: number
}
