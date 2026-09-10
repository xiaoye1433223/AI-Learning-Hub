<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { PASSWORD_POLICY_MESSAGE, passwordProblem, type AccountSecurityDto, type DeviceSessionDto } from '@ai-learning-hub/contracts'
import { api } from '../services/api'
import { useSessionStore } from '../stores/session'
const session = useSessionStore(), router = useRouter()
const security = ref<AccountSecurityDto | null>(null), devices = ref<DeviceSessionDto[]>([]), recoveryCodes = ref<string[]>([]), error = ref(''), message = ref(''), busy = ref(false)
const form = reactive({ currentPassword: '', mfaCode: '', password: '', confirmation: '', email: '' })
const load = async () => { [security.value, devices.value] = await Promise.all([api<AccountSecurityDto>('/me/security'), api<DeviceSessionDto[]>('/me/sessions')]) }
const run = async (action: () => Promise<void>) => {
  busy.value = true; error.value = ''; message.value = ''
  try { await action() } catch (cause) { error.value = cause instanceof Error ? cause.message : '操作失败' }
  finally { busy.value = false; form.currentPassword = ''; form.mfaCode = ''; form.password = ''; form.confirmation = '' }
}
const exit = async () => { session.user = null; sessionStorage.removeItem('admin-access-token'); sessionStorage.removeItem('admin-user'); await router.replace('/login') }
const change = (kind: 'password' | 'email' | 'mfa/recovery-codes') => run(async () => {
  if (kind === 'password') {
    if (form.password !== form.confirmation) throw new Error('两次密码不一致')
    const problem = passwordProblem(form.password, [session.user?.username || '', session.user?.email || ''], security.value?.passwordMinLength)
    if (problem) throw new Error(problem)
  }
  const result = await api<{ message?: string; recoveryCodes?: string[] }>('/me/' + kind, { method: 'POST', body: JSON.stringify({ currentPassword: form.currentPassword, mfaCode: form.mfaCode, ...(kind === 'password' ? { password: form.password } : kind === 'email' ? { email: form.email } : {}) }) }, false)
  message.value = result.message || '恢复码已更新，旧恢复码全部失效。'
  recoveryCodes.value = result.recoveryCodes || []
  if (kind === 'password') await exit()
  else await load()
})
const revoke = (id: string) => run(async () => {
  const current = id === 'all' || devices.value.some((item) => item.id === id && item.current)
  await api('/me/sessions/' + encodeURIComponent(id), { method: 'DELETE' }, false)
  if (current) await exit()
  else await load()
})
onMounted(() => run(load))
</script>
<template>
  <div class="page-header"><div><h1>账号安全</h1><p>管理员使用密码和 MFA 登录；敏感操作需重新确认身份。</p></div></div>
  <p v-if="error" class="form-error" role="alert">{{ error }}</p><p v-if="message" role="status">{{ message }}</p>
  <template v-if="security">
    <section class="panel"><h2>确认身份</h2><div class="admin-form">
      <label>当前密码<input v-model="form.currentPassword" type="password" autocomplete="current-password" /></label>
      <label>动态验证码或一次性恢复码<input v-model="form.mfaCode" autocomplete="one-time-code" maxlength="64" /></label>
      <p>每次敏感操作都需重新填写；同一组动态验证码只能使用一次。</p>
    </div></section>
    <section class="panel"><h2>修改密码</h2><p>{{ PASSWORD_POLICY_MESSAGE }}</p>
      <form class="admin-form" @submit.prevent="change('password')"><label>新密码<input v-model="form.password" type="password" required :minlength="security.passwordMinLength" autocomplete="new-password" /></label><label>确认新密码<input v-model="form.confirmation" type="password" required autocomplete="new-password" /></label><button class="admin-primary" :disabled="busy || !form.currentPassword || !form.mfaCode">修改密码并退出所有设备</button></form>
    </section>
    <section class="panel"><h2>修改邮箱</h2><p>当前邮箱：{{ session.user?.email }}。确认新地址后全部设备退出；关联校园认证需重新核验。</p>
      <p v-if="!security.mailAvailable">邮件通道尚未配置，暂不能修改邮箱。</p>
      <form class="admin-form" @submit.prevent="change('email')"><label>新邮箱<input v-model="form.email" type="email" required autocomplete="email" /></label><button class="admin-primary" :disabled="busy || !security.mailAvailable || !form.currentPassword || !form.mfaCode">发送确认邮件</button></form>
    </section>
    <section class="panel"><h2>MFA 与恢复码</h2><p>{{ security.mfaEnabled ? '已启用 TOTP' : '尚未启用' }} · 剩余 {{ security.recoveryCodesRemaining }} 个恢复码。</p>
      <button class="admin-primary" :disabled="busy || !form.currentPassword || !form.mfaCode" @click="change('mfa/recovery-codes')">重新生成恢复码</button>
      <div v-if="recoveryCodes.length" role="status"><p>请离线保存以下恢复码，每码仅可使用一次，关闭后不再显示。</p><ul><li v-for="item in recoveryCodes" :key="item"><code>{{ item }}</code></li></ul><button type="button" @click="recoveryCodes = []">已保存，关闭显示</button></div>
    </section>
    <section class="panel"><h2>设备会话</h2><p>撤销立即使对应设备的访问和刷新凭据失效。</p>
      <ul class="security-devices"><li v-for="item in devices" :key="item.id"><strong>{{ item.device }} · {{ item.client === 'admin' ? '管理后台' : '学生端' }}{{ item.current ? '（当前）' : '' }}</strong><span>{{ new Date(item.lastUsedAt).toLocaleString() }}</span><button type="button" :disabled="busy" @click="revoke(item.id)">撤销此设备</button></li></ul>
      <button :disabled="busy" @click="revoke('all')">退出所有设备</button>
    </section>
  </template>
</template>
<style scoped>.panel{margin-bottom:20px}.security-devices{list-style:none;padding:0}.security-devices li{display:flex;flex-wrap:wrap;align-items:center;gap:16px;padding:12px 0}.security-devices span{font-size:13px}</style>
