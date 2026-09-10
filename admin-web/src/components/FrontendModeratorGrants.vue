<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import type { AdminUserDetailDto, ModeratorScope } from '@ai-learning-hub/contracts'
import { usersApi } from '../services/users'

const props = defineProps<{ detail: AdminUserDetailDto }>()
const emit = defineEmits<{ saved: [] }>()
const form = reactive({ enabled: false, scopes: [] as ModeratorScope[], canDelete: false, canMute: false, canBan: false, reason: '' })
const pending = ref(false), error = ref('')
let requestKey = '', previousInput = ''
watch(() => props.detail, (detail) => {
  const active = detail.moderatorGrants?.filter((grant) => grant.enabled) || []
  Object.assign(form, { enabled: active.length > 0, scopes: active.map((grant) => grant.scope), canDelete: active.some((grant) => grant.actions.includes('takedown')), canMute: active.some((grant) => grant.actions.includes('mute')), canBan: active.some((grant) => grant.actions.includes('ban')), reason: '' })
}, { immediate: true })
const save = async (revoke = false) => {
  if (pending.value) return
  if (form.reason.trim().length < 4) { error.value = '请填写至少4字的授权或撤销原因'; return }
  pending.value = true; error.value = ''
  try {
    const input = { ...form, enabled: !revoke && form.enabled, expectedRevision: props.detail.user.revision }
    const signature = JSON.stringify([props.detail.user.id, input])
    if (signature !== previousInput) { previousInput = signature; requestKey = Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('') }
    await usersApi.moderatorGrants(props.detail.user.id, input, requestKey); emit('saved')
  }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '保存授权失败' }
  finally { pending.value = false }
}
</script>
<template>
  <section class="frontend-moderator-grants">
    <h3>前台管理权限</h3>
    <p>版主使用学生端管理内容；授权不代替校园实名认证，也不授予后台访问权限。</p>
    <form class="admin-form" @submit.prevent="save()">
      <fieldset :disabled="pending">
        <label><input v-model="form.enabled" type="checkbox" />设为前台版主</label>
        <template v-if="form.enabled">
          <fieldset><legend>管理范围</legend><label><input v-model="form.scopes" type="checkbox" value="community" />社区</label><label><input v-model="form.scopes" type="checkbox" value="tutorials" />教程中心</label></fieldset>
          <fieldset><legend>允许动作</legend><label><input v-model="form.canDelete" type="checkbox" />删除内容</label><label><input v-model="form.canMute" type="checkbox" />禁言用户</label><label><input v-model="form.canBan" type="checkbox" />封禁账号</label></fieldset>
          <p>禁言与封禁影响整个账号；前台只能执行有明确期限的处罚。</p>
        </template>
        <label>操作原因<textarea v-model="form.reason" required minlength="4" maxlength="500" rows="2" /></label>
        <p v-if="error" role="alert">{{ error }}</p>
        <div class="grant-actions"><button class="admin-primary">保存前台管理权限</button><button v-if="detail.moderatorGrants?.some(grant => grant.enabled)" class="admin-secondary" type="button" @click="save(true)">停用 / 撤销授权</button></div>
      </fieldset>
    </form>
  </section>
</template>
<style scoped>
.frontend-moderator-grants { margin-top:24px; padding-top:16px; border-top:1px solid var(--amc-border, #ece5de) }
fieldset { border:0; padding:0; margin:12px 0; display:grid; gap:10px }
input[type="checkbox"] { width:auto; margin-right:8px }
.grant-actions { display:flex; flex-wrap:wrap; gap:10px }
</style>
