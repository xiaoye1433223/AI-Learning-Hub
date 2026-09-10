<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { OperationsStatusDto, PersistenceStatusDto } from '@ai-learning-hub/contracts'
import { api } from '../services/api'
import { usePermissionAction } from '../composables/usePermissionAction'
const status = ref<PersistenceStatusDto | null>(null), error = ref(''), busy = ref(false), reason = ref('')
const canMaintain = usePermissionAction('platform.manage')
const operations = ref<OperationsStatusDto | null>(null), operationsError = ref('')
const labels: Record<keyof OperationsStatusDto['checks'], string> = { database: '数据库', storage: '文件容量', videoQueue: '视频队列', ffmpeg: '视频处理工具', mail: '邮件', backup: '独立备份', maintenance: '定时清理' }
const fileCursor = ref<string | null>(null)
const load = async () => {
  error.value = ''; operationsError.value = ''
  try { status.value = await api('/admin/persistence') } catch (cause) { error.value = cause instanceof Error ? cause.message : '状态读取失败' }
  if (canMaintain.value) try { operations.value = await api('/admin/persistence/operations') } catch (cause) { operationsError.value = cause instanceof Error ? cause.message : '运行状态读取失败' }
}
const maintain = async (action: string) => {
  if (reason.value.trim().length < 4) { error.value = '请填写至少4字的维护原因'; return }
  busy.value = true
  try { const result = await api<{ nextCursor?: string | null }>(`/admin/persistence/${action}`, { method: 'POST', body: JSON.stringify({ reason: reason.value, ...(action === 'unused-files' && fileCursor.value ? { cursor: fileCursor.value } : {}) }) }); if (action === 'unused-files') fileCursor.value = result.nextCursor || null; reason.value = ''; await load() }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '维护失败' }
  finally { busy.value = false }
}
onMounted(load)
</script>
<template>
  <section class="panel persistence-panel"><div class="panel-heading"><h2>数据与存储状态</h2><button class="admin-secondary" :disabled="busy" @click="load">刷新状态</button></div>
    <p v-if="error" class="error-banner" role="alert">{{ error }}</p>
    <div v-if="canMaintain">
      <p v-if="operationsError" class="error-banner" role="alert">{{ operationsError }}</p>
      <template v-if="operations">
        <h3>运行与恢复状态</h3>
        <dl><template v-for="(check, key) in operations.checks" :key="key"><dt>{{ labels[key] }}</dt><dd :class="{ 'error-banner': check.status === 'failed' }">{{ check.message }}</dd></template></dl>
        <p>近5分钟请求 {{ operations.http.requests }} 次，服务端错误 {{ operations.http.errors5xx }} 次。</p>
        <p>最近可恢复快照：{{ operations.backup.snapshotAt ? new Date(operations.backup.snapshotAt).toLocaleString('zh-CN') : '尚未验证' }}。RPO≤1小时、RTO≤4小时为待演练目标。</p>
      </template>
    </div>
    <template v-if="status"><p>{{ status.database.type }} · {{ status.database.connected ? '已连接' : '不可用' }} · 迁移{{ status.database.ready ? '完整' : '待处理' }} · {{ status.storage.driver }} 存储{{ status.storage.writable ? '可写' : '不可写' }}</p><dl><dt>用户</dt><dd>{{ status.counts.users }}</dd><dt>正式动态 / 草稿</dt><dd>{{ status.counts.posts }} / {{ status.counts.drafts }}</dd><dt>评论 / 文件</dt><dd>{{ status.counts.comments }} / {{ status.counts.files }}</dd><dt>待处理举报</dt><dd>{{ status.counts.pendingReports }}</dd><dt>最近业务写入</dt><dd>{{ status.lastWriteAt ? new Date(status.lastWriteAt).toLocaleString('zh-CN') : '暂无记录' }}</dd></dl><details><summary>查看数据库迁移</summary><p v-for="migration in status.database.migrations" :key="migration.name">{{ migration.name }} · {{ migration.finishedAt ? '已完成' : '待执行' }}</p></details></template>
    <div v-if="canMaintain" class="persistence-actions"><label>维护原因<input v-model="reason" maxlength="500" placeholder="填写本次维护原因" /></label><button class="admin-secondary" :disabled="busy" @click="maintain('recount')">校准社区计数</button><button class="admin-secondary" :disabled="busy" @click="maintain('expire-idempotency')">清理过期幂等记录</button><button class="admin-secondary" :disabled="busy" @click="maintain('unused-files')">清理7天以上未使用文件</button><small>保留所有业务与历史版本引用的文件；单次最多检查50个。{{ fileCursor ? '下次点击继续检查后续文件。' : '' }}</small></div>
  </section>
</template>
<style scoped>
.persistence-panel { padding:24px; margin-top:22px }.persistence-panel dl { display:grid; grid-template-columns:160px 1fr; gap:10px }.persistence-panel dd { margin:0 }.persistence-actions { display:flex; flex-wrap:wrap; gap:10px; align-items:end; margin-top:20px }.persistence-actions label { display:grid; gap:6px }.persistence-actions small { flex-basis:100% }
</style>
