<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import leopardUrl from '../assets/snow-leopard.png'
import AppIcon from './base/AppIcon.vue'
import { assistantApi, type AssistantPostDigest } from '../services/api/assistant'

const open = ref(false)
const postId = ref('')
const postTitle = ref('')
const digest = ref<AssistantPostDigest | null>(null)
const loading = ref(false)
const error = ref('')
const configKeywords = ref<string[]>([])
let controller: AbortController | undefined

const keywords = computed(() => digest.value?.keywords?.length ? digest.value.keywords : configKeywords.value)

const load = async () => {
  const target = postId.value
  if (!target) return
  controller?.abort()
  controller = new AbortController()
  const signal = controller.signal
  loading.value = true
  error.value = ''
  digest.value = null
  try {
    const config = await assistantApi.configCached().catch(() => null)
    if (signal.aborted) return
    if (config?.digest) {
      configKeywords.value = config.digest.keywords || []
      if (config.digest.enabled === false) { error.value = '简讯功能未开启'; return }
    }
    const result = await assistantApi.postDigest(target, signal)
    if (signal.aborted || postId.value !== target) return
    if (result?.postId !== target) { error.value = '简讯返回与当前帖子不匹配'; return }
    digest.value = result
  } catch (cause) {
    if (signal.aborted || postId.value !== target) return
    const message = cause instanceof Error && cause.message ? cause.message : '简讯暂未接通'
    error.value = message
  } finally {
    if (!signal.aborted && postId.value === target) loading.value = false
  }
}

const onRequest = (event: Event) => {
  const detail = (event as CustomEvent<{ postId?: string; title?: string }>).detail
  if (!detail?.postId) return
  postId.value = detail.postId
  postTitle.value = detail.title || ''
  open.value = true
  void load()
}
const close = () => { open.value = false; controller?.abort() }

onMounted(() => window.addEventListener('assistant-post-digest', onRequest))
onBeforeUnmount(() => { window.removeEventListener('assistant-post-digest', onRequest); controller?.abort() })
</script>

<template>
  <Transition name="digest-pop">
    <section v-if="open" class="digest-dialog" role="dialog" aria-label="小雪简讯">
      <header class="digest-header">
        <img class="digest-avatar" :src="leopardUrl" alt="" draggable="false" />
        <div class="digest-title"><strong>小雪简讯</strong><small>{{ postTitle || '当前帖子' }}</small></div>
        <button type="button" class="digest-icon-button" aria-label="关闭简讯" @click="close"><AppIcon name="close" :size="16" /></button>
      </header>
      <div class="digest-body">
        <p class="digest-post-title">{{ postTitle || '当前帖子' }}</p>
        <p v-if="loading" class="digest-loading" role="status">小雪正在整理中…</p>
        <template v-else-if="digest">
          <p class="digest-summary">{{ digest.summary }}</p>
          <div v-if="keywords.length" class="digest-keywords" aria-label="关键词">
            <span v-for="keyword in keywords" :key="keyword">#{{ keyword }}</span>
          </div>
          <RouterLink class="digest-link" :to="`/community/post/${digest.postId}`">查看原帖<AppIcon name="arrow-up-right" :size="14" /></RouterLink>
        </template>
        <div v-else-if="error" class="digest-failed" role="alert">
          <span>{{ error }}</span>
          <button type="button" class="digest-retry" @click="load"><AppIcon name="refresh" :size="14" />重试</button>
        </div>
      </div>
    </section>
  </Transition>
</template>

<style scoped>
.digest-dialog {
  position: fixed;
  right: clamp(14px, 2.5vw, 26px);
  bottom: calc(clamp(100px, 11vw, 130px) + clamp(18px, 3vh, 30px) + 10px);
  z-index: 89;
  display: flex;
  flex-direction: column;
  width: min(392px, calc(100vw - 28px));
  max-height: min(480px, calc(100dvh - 240px));
  border-radius: var(--amc-radius-large);
  border: 1px solid var(--amc-border);
  background: var(--amc-surface-warm);
  box-shadow: var(--amc-shadow-float);
  overflow: hidden;
  transform-origin: bottom right;
}
.digest-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: var(--amc-orange-soft);
  border-bottom: 1px solid var(--amc-orange-border);
}
.digest-avatar { width: 40px; height: 40px; object-fit: contain; }
.digest-title { flex: 1; min-width: 0; display: flex; flex-direction: column; line-height: 1.3; }
.digest-title strong { font-size: 14.5px; color: var(--amc-text-primary); }
.digest-title small { font-size: 11.5px; color: var(--amc-text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.digest-icon-button { width: 32px; height: 32px; flex: 0 0 auto; display: grid; place-items: center; border: 0; border-radius: var(--amc-radius-xs); background: transparent; color: var(--amc-text-secondary); cursor: pointer; transition: background .2s ease, color .2s ease; }
.digest-icon-button:hover { background: var(--amc-orange-soft); color: var(--amc-orange); }
.digest-body { flex: 1; min-height: 120px; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 10px; scrollbar-width: thin; }
.digest-post-title { margin: 0; font-size: 13px; font-weight: 600; color: var(--amc-text-secondary); overflow-wrap: anywhere; }
.digest-loading { margin: 0; padding: 10px 12px; border: 1px dashed var(--amc-border); border-radius: var(--amc-radius-xs); font-size: 13px; color: var(--amc-text-secondary); }
.digest-summary { margin: 0; padding: 10px 13px; border: 1px solid var(--amc-border); border-radius: var(--amc-radius-control); background: var(--amc-surface); font-size: 13.5px; line-height: 1.7; color: var(--amc-text-body); white-space: pre-wrap; overflow-wrap: anywhere; }
.digest-keywords { display: flex; flex-wrap: wrap; gap: 6px; }
.digest-keywords span { padding: 3px 9px; font-size: 12px; color: var(--amc-orange); background: var(--amc-orange-soft); border: 1px solid var(--amc-orange-border); border-radius: var(--amc-radius-pill); }
.digest-link { display: inline-flex; align-items: center; gap: 4px; align-self: flex-start; font-size: 13px; font-weight: 600; color: var(--amc-orange); text-decoration: none; }
.digest-link:hover { color: var(--amc-orange-hover); }
.digest-failed { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 12px; border: 1px dashed var(--amc-orange-border); border-radius: var(--amc-radius-xs); background: var(--amc-orange-soft); color: var(--amc-text-secondary); font-size: 12.5px; }
.digest-retry { display: inline-flex; align-items: center; gap: 4px; border: 0; background: transparent; color: var(--amc-orange); font-size: 12.5px; font-weight: 600; cursor: pointer; }
.digest-pop-enter-active { transition: opacity .26s ease, transform .26s cubic-bezier(.2, .9, .3, 1.18); }
.digest-pop-leave-active { transition: opacity .18s ease, transform .18s ease; }
.digest-pop-enter-from, .digest-pop-leave-to { opacity: 0; transform: translateY(18px) scale(.94); }
@media (max-width: 700px) {
  .digest-dialog {
    right: 10px;
    left: 10px;
    width: auto;
    bottom: calc(196px + env(safe-area-inset-bottom, 0px));
    max-height: 56dvh;
    border-radius: var(--amc-radius-card);
  }
}
@media (prefers-reduced-motion: reduce) {
  .digest-pop-enter-active, .digest-pop-leave-active { transition: opacity .18s ease; }
  .digest-pop-enter-from, .digest-pop-leave-to { transform: none; }
}
</style>
