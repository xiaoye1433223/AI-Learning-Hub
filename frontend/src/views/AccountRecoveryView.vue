<script setup lang="ts">
import { ref } from 'vue'
import { useRoute } from 'vue-router'
import { authApi } from '../services/api/auth'
import { useAuthUiStore } from '../stores/authUi'
import { useAuthStore } from '../stores/auth'
import { passwordProblem, PASSWORD_POLICY_MESSAGE } from '@ai-learning-hub/contracts'
const route = useRoute(), auth = useAuthStore(), ui = useAuthUiStore(), password = ref(''), confirmation = ref(''), message = ref(''), error = ref(''), done = ref(false), busy = ref(false)
const token = new URLSearchParams(location.hash.slice(1)).get('token') || ''
history.replaceState(history.state, '', location.pathname + location.search)
const submit = async () => {
  busy.value = true; error.value = ''
  try {
    if (auth.dataMode === 'mock') throw new Error('演示模式不验证真实邮件或修改真实密码')
    if (route.path === '/verify-email') {
      const result = await authApi.verifyEmail(token)
      if (result.emailChanged) auth.clearSession()
      else await auth.restore(true)
      message.value = result.message || '邮箱已验证，可以继续首次引导。'
    } else {
      if (password.value !== confirmation.value) throw new Error('两次密码不一致')
      const problem = passwordProblem(password.value)
      if (problem) throw new Error(problem)
      await authApi.resetPassword(token, password.value); message.value = '密码已重置，请重新登录。'; auth.clearSession()
    }
    done.value = true; password.value = ''; confirmation.value = ''
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '链接已失效' }
  finally { busy.value = false }
}
</script>
<template><section class="account-recovery"><h1>{{ route.meta.title }}</h1><form v-if="!done" class="dialog-form" @submit.prevent="submit"><template v-if="route.path === '/reset-password'"><p>{{ PASSWORD_POLICY_MESSAGE }}</p><label>新密码<input v-model="password" type="password" required minlength="12" autocomplete="new-password" /></label><label>确认密码<input v-model="confirmation" type="password" required minlength="12" autocomplete="new-password" /></label></template><p v-else>确认使用邮件中的一次性链接验证账号邮箱。</p><p v-if="error" role="alert" class="community-error">{{ error }}</p><button class="button primary" :disabled="busy || !token">{{ busy ? '处理中…' : '确认' }}</button><p v-if="!token">链接缺少有效令牌，请重新申请邮件。</p></form><p v-else role="status">{{ message }} <RouterLink v-if="auth.user" to="/community/onboarding">继续引导</RouterLink><button v-else class="button primary" @click="ui.open()">登录</button></p></section></template>
<style scoped>.account-recovery{max-width:520px;margin:64px auto;padding:24px}</style>
