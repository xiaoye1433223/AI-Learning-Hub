<script setup lang="ts">
// 「小雪助手设置」单页：左侧设置，右侧实时外观预览；模型地址/名称/密钥状态只读，密钥不在此页展示。
import { ElMessage } from 'element-plus'
import { onMounted, reactive, ref } from 'vue'
import AdminPageHeader from '../components/AdminPageHeader.vue'
import { api } from '../services/api'
import { usePermissionAction } from '../composables/usePermissionAction'

interface AssistantModelStatus { provider: string; baseUrl: string; model: string; configured: boolean }
interface AssistantConfig {
  enabled: boolean; name: string; welcome: string; description: string; entryPosition: 'left' | 'right'; avatarUrl: string
  model: AssistantModelStatus; revision: number
}
interface AssistantTestResult { ok: boolean; message: string; sample?: string }

const canWrite = usePermissionAction('settings.write')
const error = ref('')
const busy = ref(false)
const testing = ref(false)
const testResult = ref<AssistantTestResult | null>(null)
const revision = ref(0)
const config = reactive({ enabled: true, name: '小雪助手', welcome: '', description: '', entryPosition: 'right' as 'left' | 'right', avatarUrl: '' })
const model = ref<AssistantModelStatus>({ provider: '', baseUrl: '', model: '', configured: false })
const positionOptions: Array<{ value: 'left' | 'right'; label: string }> = [
  { value: 'left', label: '左侧悬浮' },
  { value: 'right', label: '右侧悬浮' },
]

const apply = (data: AssistantConfig) => {
  config.enabled = data.enabled
  config.name = data.name
  config.welcome = data.welcome
  config.description = data.description || ''
  config.entryPosition = data.entryPosition === 'left' ? 'left' : 'right'
  config.avatarUrl = data.avatarUrl || ''
  model.value = data.model || { provider: '', baseUrl: '', model: '', configured: false }
  revision.value = data.revision || 0
}
const load = async () => {
  error.value = ''
  try { apply(await api<AssistantConfig>('/admin/assistant-config')) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '小雪助手配置读取失败' }
}
onMounted(load)

const save = async () => {
  if (!canWrite.value) { error.value = '当前账号仅有查看权限，无法保存设置'; return }
  if (busy.value) return
  busy.value = true; error.value = ''
  try {
    const saved = await api<AssistantConfig>('/admin/assistant-config', {
      method: 'PUT',
      body: JSON.stringify({
        enabled: config.enabled, name: config.name, welcome: config.welcome, description: config.description,
        entryPosition: config.entryPosition, avatarUrl: config.avatarUrl, expectedRevision: revision.value || undefined,
      }),
    })
    apply(saved)
    ElMessage.success('小雪助手设置已保存')
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '小雪助手设置保存失败' } finally { busy.value = false }
}

const test = async () => {
  if (testing.value) return
  testing.value = true; testResult.value = null
  try {
    testResult.value = await api<AssistantTestResult>('/admin/assistant-config/test', { method: 'POST' })
  } catch (cause) { testResult.value = { ok: false, message: cause instanceof Error ? cause.message : '测试连接失败' } } finally { testing.value = false }
}
</script>

<template>
  <AdminPageHeader title="小雪助手设置" description="配置小雪助手的展示信息与模型连接；模型地址、名称和密钥由服务端受限配置提供，本页只读。">
    <template #actions>
      <button class="admin-primary" type="button" :disabled="busy || !canWrite" @click="save">{{ busy ? '保存中…' : '保存所有设置' }}</button>
    </template>
  </AdminPageHeader>

  <p v-if="error" class="error-banner" role="alert">{{ error }}</p>

  <div class="assistant-grid">
    <div class="assistant-main">
      <section class="panel assistant-panel">
        <h2>基础设置</h2>
        <p class="assistant-note">保存到现有系统配置，刷新后仍保留。</p>
        <form class="assistant-form-grid" @submit.prevent="save">
          <div class="assistant-field assistant-span2 assistant-toggle">
            <span>启用小雪助手</span>
            <el-switch v-model="config.enabled" :disabled="!canWrite" />
          </div>
          <label class="assistant-field assistant-span2"><span>助手名称</span><input v-model="config.name" maxlength="20" required /></label>
          <label class="assistant-field assistant-span2"><span>欢迎语</span><textarea v-model="config.welcome" maxlength="200" rows="3" required /></label>
          <div class="assistant-field assistant-span2">
            <span>入口位置</span>
            <div class="assistant-position">
              <label v-for="option in positionOptions" :key="option.value">
                <input v-model="config.entryPosition" type="radio" :value="option.value" :disabled="!canWrite" />{{ option.label }}
              </label>
            </div>
          </div>
        </form>
      </section>

      <section class="panel assistant-panel">
        <h2>模型状态（只读）</h2>
        <p class="assistant-note">地址、名称与密钥来自服务端受限配置，本页不展示密钥。</p>
        <dl class="assistant-model">
          <div><dt>提供商</dt><dd>{{ model.provider || '—' }}</dd></div>
          <div><dt>模型名称</dt><dd>{{ model.model || '—' }}</dd></div>
          <div><dt>接口地址</dt><dd>{{ model.baseUrl || '—' }}</dd></div>
          <div><dt>密钥状态</dt><dd><span class="assistant-badge" :class="model.configured ? 'ok' : 'off'">{{ model.configured ? '已配置' : '未配置' }}</span></dd></div>
        </dl>
        <p v-if="testResult" class="assistant-test-result" :class="testResult.ok ? 'ok' : 'fail'" role="status">
          测试连接：{{ testResult.message }}<span v-if="testResult.sample">（示例：{{ testResult.sample }}）</span>
        </p>
        <button class="admin-primary" type="button" :disabled="testing || !canWrite" @click="test">{{ testing ? '测试中…' : '测试连接' }}</button>
      </section>

      <section class="panel assistant-panel">
        <h2>帖子简讯</h2>
        <p class="assistant-note">本轮保持待开启；后续接入后再提供简讯开关、关键词与长度。</p>
        <span class="assistant-badge off">待开启</span>
      </section>
    </div>

    <aside class="assistant-side">
      <section class="panel assistant-panel">
        <h2>外观预览</h2>
        <p class="assistant-note">实时预览，保存后学生端按此展示。</p>
        <div class="assistant-preview-chat">
          <header class="assistant-chat-head">
            <span class="assistant-avatar-mini">雪</span>
            <div class="assistant-chat-title"><strong>{{ config.name || '小雪助手' }}</strong><small><i class="assistant-dot"></i>在线 · 你的 AI 学习伙伴</small></div>
            <span class="assistant-chat-actions">— ×</span>
          </header>
          <div class="assistant-chat-body">
            <div class="assistant-chat-bubble">{{ config.welcome || '（未填写欢迎语）' }}</div>
            <div class="assistant-chat-chips"><span>推荐一些 AI 学习资源</span><span>如何开始学习大模型？</span><span>帮我总结一下学习方法</span></div>
          </div>
        </div>
        <p class="assistant-entry-preview">悬浮入口位置：<b>{{ config.entryPosition === 'left' ? '左侧' : '右侧' }}</b></p>
      </section>
    </aside>
  </div>
</template>
