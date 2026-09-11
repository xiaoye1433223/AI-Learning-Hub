import 'reflect-metadata'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BadRequestException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AssistantChatService } from '../src/modules/settings/assistant-chat.service'
import { AssistantConfigService } from '../src/modules/settings/assistant-config.service'
import type { PrismaService } from '../src/prisma/prisma.service'

const baseEnv = {
  ASSISTANT_MODEL_PROVIDER: 'openai',
  ASSISTANT_MODEL_BASE_URL: 'https://api.deepseek.com',
  ASSISTANT_MODEL_NAME: 'DeepSeek-V4.1-Flash',
  ASSISTANT_MODEL_API_KEY: 'sk-secret-1',
}

const buildService = (configRow: { key: string; value: unknown; sensitive?: boolean; revision?: number } | null, env: Record<string, string> = baseEnv) => {
  const prisma = { systemSetting: { findUnique: vi.fn().mockResolvedValue(configRow) } }
  const config = new AssistantConfigService(prisma as unknown as PrismaService, new ConfigService(env))
  return new AssistantChatService(config)
}

afterEach(() => vi.unstubAllGlobals())

const enabledRow = { key: 'xiaoxue_assistant', value: { enabled: true, name: '小雪助手', welcome: 'w', description: 'd', entryPosition: 'right', avatarUrl: '' } }

describe('AssistantChatService', () => {
  it('未启用时拒绝对话', async () => {
    const service = buildService({ key: 'xiaoxue_assistant', value: { enabled: false, name: '小雪助手', welcome: 'w', description: 'd', entryPosition: 'right', avatarUrl: '' } })
    await expect(service.chat({ message: '你好' })).rejects.toThrow('小雪助手已停用')
  })

  it('服务端未配置模型密钥时诚实降级，不伪造回答', async () => {
    const service = buildService(enabledRow, { ...baseEnv, ASSISTANT_MODEL_API_KEY: '' })
    await expect(service.chat({ message: '你好' })).rejects.toThrow('未配置模型密钥')
  })

  it('正常对话：拼接系统提示与历史，携带服务端密钥请求默认地址，返回回复', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '  你好，我是小雪！ ' } }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const service = buildService(enabledRow)
    const result = await service.chat({ message: '什么是AI Agent', history: [{ role: 'user', content: '嗨' }, { role: 'assistant', content: '你好呀' }] })
    expect(result).toEqual({ reply: '你好，我是小雪！' })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.deepseek.com/chat/completions')
    const body = JSON.parse(String(init.body))
    expect(body.model).toBe('DeepSeek-V4.1-Flash')
    expect(body.messages[0].role).toBe('system')
    expect(body.messages[0].content).toContain('小雪助手')
    expect(body.messages.slice(-2)).toEqual([{ role: 'assistant', content: '你好呀' }, { role: 'user', content: '什么是AI Agent' }])
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-secret-1')
  })

  it('大模型返回异常时给出可理解的降级提示', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":{}}', { status: 500 })))
    const service = buildService(enabledRow)
    await expect(service.chat({ message: '你好' })).rejects.toThrow(BadRequestException)
  })

  it('测试连接成功时返回 ok=true 与样例', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '连接正常' } }] }), { status: 200 })))
    const service = buildService(enabledRow)
    const result = await service.testConnection()
    expect(result.ok).toBe(true)
    expect(result.sample).toBe('连接正常')
  })

  it('测试连接失败时如实返回 ok=false 与原因', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":{}}', { status: 401 })))
    const service = buildService(enabledRow)
    const result = await service.testConnection()
    expect(result.ok).toBe(false)
    expect(result.message).toContain('认证失败')
  })
})
