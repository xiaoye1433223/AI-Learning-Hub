import { ref } from 'vue'
import { assistantApi, type AssistantConfig } from '../../services/api/assistant'

const FALLBACK: AssistantConfig = {
  enabled: true,
  name: '小雪',
  welcome: '嗨嗨～我是小雪 🐆 学习答疑、定计划、找资料都可以问我！',
  digest: { enabled: true, keywords: [] },
}

const config = ref<AssistantConfig>({ ...FALLBACK })
let started = false

/**
 * 共享助手配置：页面加载时拉取一次（刷新后重新拉取即生效）。
 * 读取失败时保留默认展示配置，不阻塞聊天。
 * 包含简讯开关与关键词设置（与助手开关/名称/欢迎语同一套配置，不另做一套）。
 */
export function useAssistantConfig() {
  const load = async () => {
    try {
      const remote = await assistantApi.config()
      if (remote && typeof remote === 'object') {
        config.value = {
          enabled: remote.enabled !== false,
          name: typeof remote.name === 'string' && remote.name.trim() ? remote.name.trim() : FALLBACK.name,
          welcome: typeof remote.welcome === 'string' && remote.welcome.trim() ? remote.welcome.trim() : FALLBACK.welcome,
          digest: {
            enabled: remote.digest?.enabled !== false,
            keywords: Array.isArray(remote.digest?.keywords) ? remote.digest.keywords : [],
          },
        }
      }
    } catch { /* 配置读取失败：沿用默认展示配置 */ }
  }
  if (!started) { started = true; void load() }
  return { config, reload: load }
}