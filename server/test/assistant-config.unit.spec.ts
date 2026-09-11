import 'reflect-metadata'
import { describe, expect, it, vi } from 'vitest'
import { BadRequestException, ConflictException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AssistantConfigService } from '../src/modules/settings/assistant-config.service'
import type { PrismaService } from '../src/prisma/prisma.service'
import type { SaveAssistantConfigDto } from '../src/modules/settings/assistant-config.dto'

const modelEnv = {
  ASSISTANT_MODEL_PROVIDER: 'openai',
  ASSISTANT_MODEL_BASE_URL: 'https://api.deepseek.com',
  ASSISTANT_MODEL_NAME: 'DeepSeek-V4.1-Flash',
  ASSISTANT_MODEL_API_KEY: 'sk-test-1234567890',
}

const buildService = (rows: Array<{ key: string; value: unknown; revision?: number; sensitive?: boolean }>, env: Record<string, string> = modelEnv) => {
  const upsert = vi.fn(async (args: { where: { key: string }; create: { key: string; value: unknown; sensitive?: boolean }; update: { value: unknown; revision?: { increment: number } } }) => {
    const existing = rows.find((row) => row.key === args.where.key)
    const revision = (existing?.revision || 0) + (args.update.revision?.increment || 0)
    const row = { key: args.where.key, value: args.update.value ?? args.create.value, sensitive: args.create.sensitive || false, revision }
    if (existing) Object.assign(existing, row)
    else rows.push(row)
    return row
  })
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    systemSetting: {
      findUnique: vi.fn(async (args: { where: { key: string } }) => rows.find((row) => row.key === args.where.key) || null),
      upsert,
    },
  }
  const prisma = {
    $transaction: (work: (value: typeof tx) => unknown) => work(tx),
    systemSetting: {
      findUnique: vi.fn(async (args: { where: { key: string } }) => rows.find((row) => row.key === args.where.key) || null),
    },
  }
  return { service: new AssistantConfigService(prisma as unknown as PrismaService, new ConfigService(env)), upsert, tx }
}

const buildInput = (overrides: Partial<SaveAssistantConfigDto> = {}): SaveAssistantConfigDto => ({
  enabled: true, name: '小雪助手', welcome: '你好！我是小雪助手', description: '你的 AI 学习伙伴',
  entryPosition: 'right', avatarUrl: '',
  ...overrides,
}) as SaveAssistantConfigDto

describe('AssistantConfigService', () => {
  it('未配置时读取返回默认展示内容，模型状态来自服务端受限配置且不含密钥', async () => {
    const { service } = buildService([])
    const result = await service.get()
    expect(result.name).toBe('小雪助手')
    expect(result.entryPosition).toBe('right')
    expect(result.model.model).toBe('DeepSeek-V4.1-Flash')
    expect(result.model.baseUrl).toBe('https://api.deepseek.com')
    expect(result.model.configured).toBe(true)
    expect(JSON.stringify(result)).not.toContain('sk-test-1234567890')
    expect(result.revision).toBe(0)
  })

  it('服务端未配置模型密钥时 configured=false', async () => {
    const { service } = buildService([], { ...modelEnv, ASSISTANT_MODEL_API_KEY: '' })
    const result = await service.get()
    expect(result.model.configured).toBe(false)
  })

  it('保存写入展示字段，配置值不包含任何密钥', async () => {
    const { service, upsert } = buildService([])
    await service.save(buildInput({ name: '学习小雪', welcome: '欢迎使用', entryPosition: 'left' }))
    const configCall = upsert.mock.calls.find((call) => call[0].where.key === 'xiaoxue_assistant')!
    expect(JSON.stringify(configCall[0].create.value)).not.toContain('apiKey')
    expect(JSON.stringify(configCall[0].create.value)).not.toContain('sk-')
    const result = await service.get()
    expect(result.name).toBe('学习小雪')
    expect(result.entryPosition).toBe('left')
  })

  it('旧版位置值读取时归一化为 right', async () => {
    const rows = [{ key: 'xiaoxue_assistant', value: { enabled: true, name: '小雪', welcome: 'w', entryPosition: 'right-bottom-floating' }, revision: 1 }]
    const { service } = buildService(rows)
    const result = await service.get()
    expect(result.entryPosition).toBe('right')
  })

  it('expectedRevision 与当前版本不一致时抛冲突异常', async () => {
    const rows = [{ key: 'xiaoxue_assistant', value: { enabled: true, name: '旧名字', welcome: 'w' }, revision: 3 }]
    const { service } = buildService(rows)
    await expect(service.save(buildInput({ expectedRevision: 2 }))).rejects.toThrow(ConflictException)
  })

  it('非法头像地址被拒绝', async () => {
    const { service } = buildService([])
    await expect(service.save(buildInput({ avatarUrl: 'javascript:alert(1)' }))).rejects.toThrow(BadRequestException)
    await expect(service.save(buildInput({ avatarUrl: '/api/v1/public/media/abc-123' }))).resolves.toBeTruthy()
  })

  it('公开接口关闭时只返回 enabled=false，开启时不含模型与密钥字段', async () => {
    const rows: Array<{ key: string; value: unknown; revision?: number; sensitive?: boolean }> = [{ key: 'xiaoxue_assistant', value: { enabled: true, name: '小雪', welcome: '你好', description: 'd', entryPosition: 'right', avatarUrl: '' }, revision: 1 }]
    const { service } = buildService(rows)
    const on = await service.publicConfig()
    expect(on.enabled).toBe(true)
    expect(JSON.stringify(on)).not.toContain('provider')
    expect(JSON.stringify(on)).not.toContain('sk-')
    rows[0].value = { ...rows[0].value as object, enabled: false }
    const off = await service.publicConfig() as { enabled?: unknown }
    expect(off).toEqual({ enabled: false })
  })
})
