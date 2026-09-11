import { BadRequestException, Injectable } from '@nestjs/common'
import { AssistantConfigService } from './assistant-config.service'
import type { AssistantChatDto } from './assistant-chat.dto'

const REQUEST_TIMEOUT_MS = 30_000
const HISTORY_LIMIT = 10
/** 各提供商的默认 OpenAI 兼容地址；服务端受限配置里的 Base URL 优先。 */
const DEFAULT_BASE_URL: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4',
}

@Injectable()
export class AssistantChatService {
  constructor(private readonly config: AssistantConfigService) {}

  /** 服务端代理对话：密钥只存在于服务端受限配置，浏览器永远接触不到模型凭据。 */
  async chat(input: AssistantChatDto) {
    const access = await this.config.resolveModelAccess()
    if (!access.enabled) throw new BadRequestException('小雪助手已停用，请联系管理员开启')
    if (!access.model.apiKey) throw new BadRequestException('小雪助手还没接入大模型（服务端未配置模型密钥）')
    if (!access.model.model) throw new BadRequestException('小雪助手还没配置模型名称，请联系管理员')
    if (access.model.provider === 'custom' && !access.model.baseUrl) throw new BadRequestException('自定义模型必须在服务端配置 Base URL')
    const base = (access.model.baseUrl || DEFAULT_BASE_URL[access.model.provider] || DEFAULT_BASE_URL.openai).replace(/\/+$/, '')
    const system = `你是${access.name}。${access.description} 请用简体中文回答：准确、简洁、鼓励学习；不编造内容，不确定时明确说明；涉及作业时引导思考而不是直接给出完整答案。`
    const history = (input.history || []).slice(-HISTORY_LIMIT).map((item) => ({ role: item.role, content: item.content }))
    let response: Response
    try {
      response = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${access.model.apiKey}` },
        body: JSON.stringify({ model: access.model.model, stream: false, temperature: 0.7, messages: [{ role: 'system', content: system }, ...history, { role: 'user', content: input.message }] }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch {
      throw new BadRequestException('大模型服务连接超时或不可达，请稍后再试')
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new BadRequestException('模型服务认证失败，请管理员检查服务端模型密钥与提供商是否匹配')
      throw new BadRequestException('大模型服务暂不可用，请稍后再试')
    }
    const payload = await response.json().catch(() => null) as { choices?: Array<{ message?: { content?: string } }> } | null
    const reply = payload?.choices?.[0]?.message?.content?.trim()
    if (!reply) throw new BadRequestException('大模型返回内容为空，请稍后再试')
    return { reply }
  }

  /** 管理端「测试连接」：用同一套服务端配置真实请求一次模型，如实返回成功或失败原因。 */
  async testConnection() {
    try {
      const { reply } = await this.chat({ message: '你好，请回复：连接正常' })
      return { ok: true, message: '连接成功，模型已返回内容', sample: reply.slice(0, 60) }
    } catch (error) {
      return { ok: false, message: error instanceof BadRequestException ? error.message : '测试连接失败，请检查服务端模型配置' }
    }
  }
}
