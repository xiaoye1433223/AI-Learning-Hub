<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import leopardUrl from '../assets/snow-leopard.png'
import { postLabels, relativeTime } from '../community/labels'
import type { CommunityPostSummaryDto } from '@ai-learning-hub/contracts'

const open = ref(false), post = ref<CommunityPostSummaryDto | null>(null)
const shown = ref(''), typing = ref(false)
const listEl = ref<HTMLElement | null>(null)
let timer: number | undefined

const bodyText = (target: CommunityPostSummaryDto): string => target.contentBlocks
  .map((block) => block.type === 'paragraph' ? block.text : block.type === 'quote' ? block.text : block.type === 'code' ? `[代码：${block.language || 'text'}]` : block.type === 'image' ? '[图片]' : '').filter(Boolean)
  .join(' ')

const buildBriefing = (target: CommunityPostSummaryDto): string => {
  const lines = [
    `📋 ${postLabels[target.type] || '学习内容'} · 简报`,
    `标题：${target.title || '（无标题讨论）'}`,
    `作者：${target.author.displayName}（${target.author.school || '学习社区'}） · ${relativeTime(target.publishedAt)}`,
  ]
  const summary = bodyText(target).replace(/\s+/g, ' ').trim()
  lines.push(`内容概要：${summary ? summary.slice(0, 180) + (summary.length > 180 ? '…' : '') : '这篇帖子以图片/附件为主，无正文文字。'}`)
  if (target.topics.length) lines.push(`话题：${target.topics.map((topic) => `#${topic.name}`).join(' ')}`)
  lines.push(`热度：评论 ${target.stats.comments} · 点赞 ${target.stats.likes} · 有帮助 ${target.stats.useful} · 收藏 ${target.stats.bookmarks}`)
  lines.push(target.question ? `问答状态：${target.question.status === 'solved' ? '已解决 ✅' : '等待回答中 ⏳'}` : `小雪速读：值得点开细看，评论区可能有同学补充实战经验～ 🐾`)
  return lines.join('\n')
}

const startStream = (text: string) => {
  window.clearInterval(timer)
  let i = 0
  shown.value = ''
  typing.value = true
  timer = window.setInterval(() => {
    i += 2 + Math.floor(Math.random() * 3)
    shown.value = text.slice(0, i)
    void nextTick(() => { if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight })
    if (i >= text.length) { typing.value = false; window.clearInterval(timer) }
  }, 42)
}

const onBriefing = (event: Event) => {
  const target = (event as CustomEvent<{ post: CommunityPostSummaryDto }>).detail?.post
  if (!target) return
  post.value = target
  open.value = true
  startStream(buildBriefing(target))
}
const close = () => { open.value = false; window.clearInterval(timer); typing.value = false }

onMounted(() => window.addEventListener('community-briefing', onBriefing))
onBeforeUnmount(() => { window.removeEventListener('community-briefing', onBriefing); window.clearInterval(timer) })
</script>

<template>
  <Transition name="assistant-pop">
    <section v-if="open" class="briefing-dialog" role="dialog" aria-label="小雪帖子简报">
      <header class="briefing-header">
        <img class="briefing-avatar" :src="leopardUrl" alt="" draggable="false" />
        <div class="briefing-title"><strong>小雪 · 帖子简报</strong><small>{{ post ? (post.title || '无标题讨论') : '' }}</small></div>
        <button type="button" class="briefing-close" aria-label="关闭简报" @click="close"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg></button>
      </header>
      <div ref="listEl" class="briefing-messages">
        <div v-if="post" class="briefing-row">
          <div class="briefing-bubble">{{ shown }}<span v-if="typing" class="briefing-cursor" /></div>
        </div>
        <p class="briefing-status" role="status">{{ typing ? '小雪正在整理简报…' : '简报完成 🐾' }}</p>
      </div>
    </section>
  </Transition>
</template>

<style scoped>
.briefing-dialog {
  position: fixed;
  right: clamp(14px, 2.5vw, 26px);
  bottom: calc(clamp(100px, 11vw, 130px) + clamp(18px, 3vh, 30px) + 10px);
  z-index: 89;
  display: flex;
  flex-direction: column;
  width: min(392px, calc(100vw - 28px));
  max-height: min(480px, calc(100dvh - 240px));
  border-radius: 20px;
  border: 1px solid rgba(255, 138, 61, .3);
  background: rgba(255, 252, 246, .92);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  box-shadow: 0 20px 48px rgba(64, 40, 16, .2);
  overflow: hidden;
  transform-origin: bottom right;
}
.briefing-header { display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: linear-gradient(135deg, rgba(255, 154, 77, .18), rgba(255, 122, 46, .07)); border-bottom: 1px solid rgba(255, 138, 61, .22); }
.briefing-avatar { width: 40px; height: 40px; object-fit: contain; }
.briefing-title { flex: 1; min-width: 0; display: flex; flex-direction: column; line-height: 1.3; }
.briefing-title strong { font-size: 14.5px; color: #33291e; }
.briefing-title small { font-size: 11.5px; color: #9a7a58; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.briefing-close { width: 32px; height: 32px; flex: 0 0 auto; display: grid; place-items: center; border: 0; border-radius: 10px; background: transparent; color: #8a6f52; cursor: pointer; transition: background .2s ease, color .2s ease; }
.briefing-close:hover { background: rgba(255, 138, 61, .14); color: #b35a1f; }
.briefing-messages { flex: 1; min-height: 120px; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 10px; scrollbar-width: thin; }
.briefing-row { display: flex; }
.briefing-bubble {
  max-width: 100%;
  padding: 10px 13px;
  border-radius: 16px 16px 16px 5px;
  font-size: 13.5px;
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
  color: #33291e;
  background: #fff;
  border: 1px solid rgba(64, 40, 16, .08);
  box-shadow: 0 2px 8px rgba(64, 40, 16, .05);
  min-width: 60px;
}
.briefing-cursor { display: inline-block; width: 7px; height: 14px; margin-left: 2px; vertical-align: -2px; background: #ff8a3d; border-radius: 2px; animation: briefing-blink 1s steps(2) infinite; }
@keyframes briefing-blink { 50% { opacity: 0; } }
.briefing-status { margin: 0; font-size: 11.5px; color: #b08a5f; text-align: center; }
.assistant-pop-enter-active { transition: opacity .26s ease, transform .26s cubic-bezier(.2, .9, .3, 1.18); }
.assistant-pop-leave-active { transition: opacity .18s ease, transform .18s ease; }
.assistant-pop-enter-from, .assistant-pop-leave-to { opacity: 0; transform: translateY(18px) scale(.94); }
@media (max-width: 700px) {
  .briefing-dialog { right: 10px; left: 10px; width: auto; bottom: 24px; max-height: 56dvh; }
}
@media (prefers-reduced-motion: reduce) {
  .assistant-pop-enter-active, .assistant-pop-leave-active { transition: opacity .18s ease; }
  .assistant-pop-enter-from, .assistant-pop-leave-to { transform: none; }
  .briefing-cursor { animation: none; }
}
</style>
