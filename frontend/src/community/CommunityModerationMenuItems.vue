<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { moderatorActionLabels, type ModeratorAction, type ModeratorDecisionInput, type ModeratorScope, type ModeratorTargetDto } from '@ai-learning-hub/contracts'
import { useAuthStore } from '../stores/auth'
import { useCommunityStore } from '../stores/community'
import { communityApi } from '../services/api/community'
import AppDialog from '../components/base/AppDialog.vue'
import { moderatorActionsFor } from './moderation'

const props = defineProps<{ targetType: 'post' | 'resource' | 'comment'; targetId: string; scope: ModeratorScope; authorId: string }>()
const emit = defineEmits<{ decided: [action: ModeratorAction] }>()
const auth = useAuthStore(), actions = computed(() => moderatorActionsFor(auth.user, props.scope, props.authorId))
const opened = ref(false), target = ref<ModeratorTargetDto | null>(null), action = ref<ModeratorAction>('takedown')
const reason = ref(''), duration = ref('24'), customHours = ref(24), error = ref(''), pending = ref(false)
let attempt: ModeratorDecisionInput | undefined
watch([reason, duration, customHours], () => { attempt = undefined })
const open = async (selected: ModeratorAction) => {
  opened.value = true; target.value = null; action.value = selected; reason.value = ''; duration.value = selected === 'mute' ? '1' : '24'; error.value = ''; attempt = undefined
  try {
    const current = await communityApi.moderationTarget(props.targetType, props.targetId)
    if (!current.actions.includes(selected)) throw new Error('当前管理权限已变化，请重新打开菜单')
    target.value = current
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '无法读取管理对象' }
}
const submit = async () => {
  if (!target.value || pending.value) return
  pending.value = true; error.value = ''
  try {
    const hours = duration.value === 'custom' ? customHours.value : Number(duration.value)
    if (action.value !== 'takedown' && (!Number.isFinite(hours) || hours < .25 || hours > 8760)) throw new Error('期限需要在15分钟至一年之间')
    attempt ||= { expectedRevision: target.value.revision, action: action.value, reason: reason.value.trim(), ...(action.value !== 'takedown' ? { expiresAt: new Date(Date.now() + hours * 3600000).toISOString() } : {}) }
    await communityApi.moderate(target.value.type, target.value.id, attempt)
    if (action.value !== 'mute') useCommunityStore().removePost(target.value.type === 'comment' ? '' : target.value.id, action.value === 'ban' ? target.value.author.id : undefined)
    opened.value = false; emit('decided', action.value)
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '操作失败，请核对后重试' }
  finally { pending.value = false }
}
</script>
<template>
  <template v-if="actions.length">
    <span class="moderation-menu-heading" role="presentation">管理操作</span>
    <button v-for="item in actions" :key="item" type="button" role="menuitem" @click="open(item)">{{ moderatorActionLabels[item] }}</button>
  </template>
  <AppDialog v-model="opened" title="管理操作">
    <form class="dialog-form" @submit.prevent="submit">
      <template v-if="target">
        <p><strong>{{ target.title }}</strong><br />作者：{{ target.author.displayName }}</p>
        <p>操作：{{ moderatorActionLabels[action] }}</p>
        <p v-if="action === 'takedown'">内容将下架，保留处理记录和文件；作者可在处理记录中申诉。</p>
        <p v-else-if="action === 'mute'">这是账号级禁言：同时限制社区发帖、评论和教程发布，保留阅读、学习和申诉。</p>
        <p v-else>这是账号级封禁：期限内禁止登录，立即撤销该账号现有会话，保留账号恢复与申诉入口。</p>
        <label>处置理由<textarea v-model="reason" rows="3" minlength="4" maxlength="500" required :disabled="pending" /></label>
        <template v-if="action !== 'takedown'">
          <label>处罚期限<select v-model="duration" :disabled="pending"><option v-if="action === 'mute'" value="1">1小时</option><option value="24">1天</option><option value="168">7天</option><option v-if="action === 'ban'" value="720">30天</option><option value="custom">自定义</option></select></label>
          <label v-if="duration === 'custom'">时长（小时）<input v-model.number="customHours" type="number" min="0.25" max="8760" step="0.25" required :disabled="pending" /></label>
        </template>
      </template>
      <p v-else-if="!error" role="status">正在核对对象和当前授权…</p>
      <p v-if="error" class="community-error" role="alert">{{ error }}</p>
      <div class="moderation-dialog-actions"><button type="button" class="button secondary" :disabled="pending" @click="opened = false">取消</button><button class="button primary" :disabled="pending || !target">确认处置</button></div>
    </form>
  </AppDialog>
</template>
<style scoped>
.moderation-menu-heading { display:block; padding:10px 12px 4px; border-top:1px solid var(--amc-border); font-size:12px; color:var(--amc-text-secondary) }
.moderation-dialog-actions { display:flex; justify-content:flex-end; gap:10px }
</style>
