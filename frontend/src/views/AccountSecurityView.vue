<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { PASSWORD_POLICY_MESSAGE, passwordProblem, type AccountSecurityDto, type DeviceSessionDto } from '@ai-learning-hub/contracts'
import { request, dataMode } from '../services/api/client'
import { useAuthStore } from '../stores/auth'
const auth = useAuthStore(), router = useRouter()
const security = ref<AccountSecurityDto | null>(null), sessions = ref<DeviceSessionDto[]>([]), error = ref(''), message = ref(''), busy = ref(false)
const form = reactive({ currentPassword: '', password: '', confirmation: '', email: '', mfaCode: '' })
const load = async () => {
  if (dataMode === 'mock') {
    security.value = { mfaEnabled: false, mfaRequired: false, recoveryCodesRemaining: 0, mailAvailable: false, passwordMinLength: 12 }
    sessions.value = [{ id: 'demo-current', client: 'student', device: '演示设备', createdAt: new Date().toISOString(), lastUsedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString(), current: true }]
    return
  }
  ;[security.value, sessions.value] = await Promise.all([request<AccountSecurityDto>('/me/security'), request<DeviceSessionDto[]>('/me/sessions')])
}
const run = async (action: () => Promise<void>) => {
  busy.value = true; error.value = ''; message.value = ''
  try { await action() } catch (cause) { error.value = cause instanceof Error ? cause.message : '操作失败，请重试' }
  finally { busy.value = false; form.currentPassword = ''; form.password = ''; form.confirmation = ''; form.mfaCode = '' }
}
const change = (kind: 'password' | 'email') => run(async () => {
  if (kind === 'password') {
    if (form.password !== form.confirmation) throw new Error('两次密码不一致')
    const problem = passwordProblem(form.password, [auth.user?.username || '', auth.user?.email || ''], security.value?.passwordMinLength)
    if (problem) throw new Error(problem)
  }
  if (dataMode === 'mock') { message.value = '演示校验通过，未修改真实账号或发送邮件。'; return }
  const result = await request<{ message: string }>('/me/' + kind, { method: 'POST', body: JSON.stringify({ currentPassword: form.currentPassword, ...(security.value?.mfaEnabled ? { mfaCode: form.mfaCode } : {}), ...(kind === 'password' ? { password: form.password } : { email: form.email }) }) }, false)
  message.value = result.message
  if (kind === 'password') { auth.clearSession(); await router.replace('/community') }
})
const revoke = (id: string) => run(async () => {
  const current = id === 'all' || sessions.value.some((item) => item.id === id && item.current)
  if (dataMode === 'mock') { sessions.value = id === 'all' ? [] : sessions.value.filter((item) => item.id !== id); message.value = '演示会话已撤销。'; return }
  await request('/me/sessions/' + encodeURIComponent(id), { method: 'DELETE' }, false)
  if (current) { auth.clearSession(); await router.replace('/community') } else await load()
})
onMounted(() => run(load))
</script>
<template>
  <section class="account-security">
    <h1>账号安全</h1><p>修改敏感资料需要确认当前密码。密码修改与邮箱确认后，所有设备都需重新登录。</p>
    <p v-if="dataMode === 'mock'" class="community-notice">当前为演示模式，不修改真实账号。</p>
    <p v-if="error" role="alert" class="community-error">{{ error }}</p><p v-if="message" role="status">{{ message }}</p>
    <template v-if="security">
      <form class="dialog-form" @submit.prevent="change('password')">
        <h2>修改密码</h2><p>{{ PASSWORD_POLICY_MESSAGE }}</p>
        <label>当前密码<input v-model="form.currentPassword" type="password" required autocomplete="current-password" /></label>
        <label v-if="security.mfaEnabled">动态验证码或恢复码<input v-model="form.mfaCode" required autocomplete="one-time-code" /></label>
        <label>新密码<input v-model="form.password" type="password" required :minlength="security.passwordMinLength" autocomplete="new-password" /></label>
        <label>确认新密码<input v-model="form.confirmation" type="password" required autocomplete="new-password" /></label>
        <button class="button primary" :disabled="busy">修改密码并退出所有设备</button>
      </form>
      <form class="dialog-form" @submit.prevent="change('email')">
        <h2>修改邮箱</h2><p>当前邮箱：{{ auth.user?.email }}</p><p>新地址确认前不会替换原邮箱；确认后需重新核验校园认证。</p>
        <p v-if="!security.mailAvailable" class="community-notice">邮件通道尚未配置，暂不能修改邮箱。</p>
        <label>当前密码<input v-model="form.currentPassword" type="password" required autocomplete="current-password" /></label>
        <label v-if="security.mfaEnabled">动态验证码或恢复码<input v-model="form.mfaCode" required autocomplete="one-time-code" /></label>
        <label>新邮箱<input v-model="form.email" type="email" required autocomplete="email" /></label>
        <button class="button primary" :disabled="busy || !security.mailAvailable">发送确认邮件</button>
      </form>
      <section><h2>设备会话</h2><p>撤销后，该设备的访问和刷新凭据立即失效。前后台会话分别显示。</p>
        <ul><li v-for="item in sessions" :key="item.id"><strong>{{ item.device }} · {{ item.client === 'admin' ? '管理后台' : '学生端' }}{{ item.current ? '（当前）' : '' }}</strong><span>最近使用：{{ new Date(item.lastUsedAt).toLocaleString() }}</span><button class="button secondary small" :disabled="busy" @click="revoke(item.id)">撤销此设备</button></li></ul>
        <button class="button secondary" :disabled="busy || !sessions.length" @click="revoke('all')">退出所有设备</button>
      </section>
    </template>
  </section>
</template>
<style scoped>
.account-security{max-width:760px;margin:0 auto;padding:24px}.account-security form,.account-security section{margin:24px 0;padding:20px;border:1px solid var(--amc-border);border-radius:17px;background:var(--amc-surface)}.account-security li{display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:12px 0}.account-security ul{list-style:none;padding:0}.account-security li span{font-size:13px}
</style>
