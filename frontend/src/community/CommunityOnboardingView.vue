<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useCommunityStore } from '../stores/community'
import { useThemesStore } from '../stores/content/themes'
import { communityApi } from '../services/api/community'
import { safeLoginRedirect } from './redirect'
import { useAuthUiStore } from '../stores/authUi'
const auth = useAuthStore(), store = useCommunityStore(), themes = useThemesStore(), router = useRouter()
const step = ref(1), saving = ref(false), error = ref(''), schools = ref<Awaited<ReturnType<typeof communityApi.schools>>>([])
const form = reactive({ schoolId: '', departmentId: '', major: '', grade: '', headline: '', themeIds: [] as string[] })
const ready = ref(false)
const reload = async () => { ready.value = false; error.value = ''; try { await Promise.all([themes.load({ page: 1, pageSize: 30 }), auth.loadRegistrationConfig()]); schools.value = await communityApi.schools() } catch (cause) { error.value = cause instanceof Error ? cause.message : '引导资料暂不可用' } finally { ready.value = true } }
onMounted(reload)
const finish = async () => { saving.value = true; error.value = ''; try { auth.user = await communityApi.onboarding({ ...form, expectedRevision: auth.user?.revision, expectedProfileRevision: auth.user?.profileRevision }); if (auth.dataMode === 'mock') localStorage.setItem('community-demo-user', JSON.stringify(auth.user)); await store.loadContext(); const target = safeLoginRedirect(sessionStorage.getItem('student-after-onboarding') || '/community'); sessionStorage.removeItem('student-after-onboarding'); await router.replace(target === '/community/onboarding' ? '/community' : target); const ui = useAuthUiStore(), action = ui.afterOnboardingAction; ui.afterOnboardingAction = null; await action?.() } catch (cause) { error.value = cause instanceof Error ? cause.message : '保存失败' } finally { saving.value = false } }
</script>
<template><section class="onboarding-panel"><span class="eyebrow">WELCOME TO CAMPUS · {{ step }}/3</span><h1>{{ step === 1 ? '先认识一下你' : step === 2 ? '你想探索哪些方向？' : '开始你的学习社区' }}</h1><p>让学习内容和同行者更适合你。</p><p v-if="auth.user?.emailVerificationRequired" class="community-notice">请先打开注册邮箱中的验证链接，再完成引导。<button class="text-link" @click="auth.restore(true)">已验证，重新连接</button></p><form class="dialog-form" @submit.prevent="step < 3 ? step++ : finish()"><template v-if="step === 1"><label>学校<select v-model="form.schoolId" @change="form.departmentId=''" :required="auth.registrationConfig?.schoolRequired"><option value="">暂不填写</option><option v-for="school in schools" :key="school.id" :value="school.id">{{ school.name }}</option></select></label><label>院系<select v-model="form.departmentId"><option value="">暂不填写</option><option v-for="dept in schools.find(s => s.id === form.schoolId)?.departments || []" :key="dept.id" :value="dept.id">{{ dept.name }}</option></select></label><label>专业<input v-model="form.major" maxlength="100" /></label><label>年级<input v-model="form.grade" maxlength="40" /></label><label>一句话介绍<input v-model="form.headline" maxlength="120" /></label></template><template v-else-if="step === 2"><p>请选择 3 个学习方向（{{ form.themeIds.length }}/3）</p><p v-if="ready && themes.items.length < 3" class="community-notice">学习方向尚未配置完成，请联系管理员在后台发布至少三个学习方向。<button type="button" class="text-link" @click="reload">重新读取</button></p><div class="onboarding-themes"><label v-for="theme in themes.items" :key="theme.id"><input v-model="form.themeIds" type="checkbox" :value="theme.id" :disabled="form.themeIds.length === 3 && !form.themeIds.includes(theme.id)" />{{ theme.title }}</label></div></template><template v-else><p>我们将关注这 3 个方向对应的社区话题，并为你准备学习推荐。你的私人笔记和学习成绩不会自动公开。</p><div class="community-topic-list"><span v-for="theme in themes.items.filter((item) => form.themeIds.includes(item.id))" :key="theme.id" class="community-chip">{{ theme.title }}</span></div></template><p v-if="error" class="community-error" role="alert">{{ error }}</p><div class="composer-actions"><button v-if="step > 1" class="button secondary" type="button" @click="step--">上一步</button><button class="button primary" :disabled="saving || (step === 2 && form.themeIds.length !== 3)">{{ saving ? '正在保存…' : step < 3 ? '下一步' : '进入学习社区' }}</button></div></form></section></template>
<style scoped>
.onboarding-panel { width: min(calc(100% - 32px), 680px); margin: 48px auto; padding: 32px; background: var(--amc-surface); border: 1px solid var(--amc-border); border-radius: var(--amc-radius-large); box-shadow: var(--amc-shadow-card); }
.onboarding-panel h1 { margin-bottom: 16px; font-size: var(--amc-font-page-title); line-height: 1.3; }
.dialog-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px 16px; }
.dialog-form > label { display: grid; gap: 8px; min-width: 0; color: var(--amc-text-secondary); font-size: var(--amc-font-body); font-weight: 600; }
.dialog-form > label :is(input, select) { width: 100%; min-width: 0; color: var(--amc-text-primary); font-weight: 400; }
.dialog-form > :not(label) { grid-column: 1 / -1; }
.dialog-form > p { margin: 0; }
.onboarding-themes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.onboarding-themes label { padding: 16px; border: 1px solid var(--amc-border); border-radius: var(--amc-radius-control); }
@media (max-width: 767px) {
  .onboarding-panel { margin-block: 24px; padding: 24px; }
  .dialog-form, .onboarding-themes { grid-template-columns: minmax(0, 1fr); }
}
</style>
