<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSessionStore } from './stores/session'
import { preserveVisibleText, recoveryTexts } from '../../packages/contracts/browser/recovery'
import { watchVisibleSession } from '../../packages/contracts/browser/session'
import { adminSession } from './services/api'
import { SESSION_REPLACED, SESSION_REPLACED_MESSAGE } from '@ai-learning-hub/contracts'
const session = useSessionStore(), router = useRouter(), route = useRoute()
const recoveryWarning = ref('')
const recovery = computed(() => session.user ? recoveryTexts('admin', session.user.id) : [])
const preserve = () => { if (session.user) { try { preserveVisibleText('admin', session.user.id) } catch { recoveryWarning.value = '浏览器无法保存恢复副本，文字暂存于当前页面，请勿关闭此标签页' } } }
const cleared = (event: Event) => {
  session.clearSession((event as CustomEvent<{ message: string }>).detail.message)
  void router.replace({ path: '/login', query: { redirect: route.fullPath } })
}
let stop: (() => void) | undefined
onMounted(() => { if (adminSession.ended === SESSION_REPLACED) session.sessionNotice = SESSION_REPLACED_MESSAGE; window.addEventListener('admin-auth-before-clear', preserve); window.addEventListener('admin-auth-session-cleared', cleared); stop = watchVisibleSession(() => session.checkSession()) })
onBeforeUnmount(() => { window.removeEventListener('admin-auth-before-clear', preserve); window.removeEventListener('admin-auth-session-cleared', cleared); stop?.() })
</script>
<template>
  <aside v-if="session.sessionNotice && !session.user" role="alert">{{ session.sessionNotice }} <RouterLink to="/login">重新登录</RouterLink></aside>
  <aside v-if="session.connectionError" role="status">{{ session.connectionError }} <button @click="session.user ? session.checkSession() : session.restore()">重新连接</button></aside>
  <p v-if="recoveryWarning" role="status">{{ recoveryWarning }}</p>
  <details v-if="recovery.length" data-session-recovery><summary>本账号恢复草稿 · 尚未同步（{{ recovery.length }}）</summary><article v-for="row in recovery" :key="row.id"><p>{{ row.route }} · {{ row.status }} · {{ row.savedAt }}</p><textarea readonly :value="row.text" rows="5" aria-label="未同步恢复文字" /></article><p>复制文字后手动继续编辑，不会自动提交。</p></details>
  <RouterView :key="session.user?.id || 'anonymous'" />
</template>
