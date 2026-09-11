import { request } from './client'

export interface AssistantMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AssistantDigestConfig {
  enabled: boolean
  keywords: string[]
}

export interface AssistantConfig {
  enabled: boolean
  name: string
  welcome: string
  digest: AssistantDigestConfig
}

export interface AssistantPostDigest {
  postId: string
  title: string
  summary: string
  keywords: string[]
}

let configPromise: Promise<AssistantConfig> | null = null

export const assistantApi = {
  /**
   * 助手配置（名称 / 欢迎语 / 启用开关 / 简讯开关与关键词）。刷新页面会重新读取，部署侧改配置后即生效。
   */
  config(): Promise<AssistantConfig> {
    return request<AssistantConfig>('/assistant/config')
  },

  /** 配置缓存（同一次页面生命周期只取一次），供入口按钮等高频读取处复用。 */
  configCached(): Promise<AssistantConfig> {
    return configPromise ||= assistantApi.config().catch((error) => { configPromise = null; throw error })
  },

  /**
   * 真实问答：沿用项目客户端 request()（自动拼接 API 基址、注入当前登录态）。
   * 服务端持有模型密钥，前端不保存任何密钥；失败时抛出后端返回的真实提示，由面板原样展示。
   */
  async send(question: string, history: AssistantMessage[] = []): Promise<string> {
    const result = await request<{ reply?: string }>('/assistant/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, history }),
    })
    const reply = result?.reply
    if (typeof reply === 'string' && reply.trim()) return reply.trim()
    throw new Error('问答暂未接通：服务端未返回有效内容')
  },

  /**
   * 帖子简讯：POST /api/v1/assistant/post-digest，请求 { postId }，
   * 业务返回 { postId, title, summary, keywords }（外层沿用项目响应格式，由 request 解包）。
   */
  postDigest(postId: string, signal?: AbortSignal): Promise<AssistantPostDigest> {
    return request<AssistantPostDigest>('/assistant/post-digest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postId }),
      signal,
    })
  },
}
