<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import leopardUrl from '../assets/snow-leopard.png'
import { assistantApi, type AssistantMessage } from '../services/api/assistant'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const messages = ref<AssistantMessage[]>([
  { role: 'assistant', content: '嗨嗨～我是雪豹助手 🐆 学习答疑、定计划、找资料都可以问我！' },
])
const draft = ref(''), sending = ref(false)
const listEl = ref<HTMLElement | null>(null)
const quickQuestions = ['怎么制定学习计划？', '学时和积分怎么算？', '实验环境怎么用？', '社区里怎么提问？']

const scrollToBottom = async () => { await nextTick(); if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight }
watch(() => messages.value.length, () => { void scrollToBottom() })
watch(() => props.open, (open) => { if (open) void scrollToBottom() })

const send = async (raw: string) => {
  const text = raw.trim()
  if (!text || sending.value) return
  draft.value = ''
  const history = messages.value.slice(-8)
  messages.value.push({ role: 'user', content: text })
  sending.value = true
  try {
    const reply = await assistantApi.send(text, history)
    messages.value.push({ role: 'assistant', content: reply })
  } catch {
    messages.value.push({ role: 'assistant', content: '雪豹打了个盹，请再试一次 🐾' })
  } finally {
    sending.value = false
    void scrollToBottom()
  }
}

const submit = () => { void send(draft.value) }
const onKeydown = (event: KeyboardEvent) => { if (event.key === 'Escape' && props.open) emit('close') }
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Transition name="assistant-pop">
    <section v-if="open" class="assistant-chat" role="dialog" aria-label="雪豹助手对话">
      <header class="assistant-header">
        <img class="assistant-avatar" :src="leopardUrl" alt="" draggable="false" />
        <div class="assistant-title"><strong>雪豹助手</strong><small>AI 学习伙伴 · 随时提问</small></div>
        <button type="button" class="assistant-close" aria-label="关闭助手" @click="emit('close')"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg></button>
      </header>
      <div ref="listEl" class="assistant-messages">
        <div v-for="(message, index) in messages" :key="index" class="assistant-row" :class="message.role">
          <div class="assistant-bubble">{{ message.content }}</div>
        </div>
        <div v-if="sending" class="assistant-row assistant" aria-label="助手正在输入"><div class="assistant-bubble assistant-typing"><span /><span /><span /></div></div>
      </div>
      <div class="assistant-quick" role="list" aria-label="快捷提问">
        <button v-for="question in quickQuestions" :key="question" type="button" role="listitem" :disabled="sending" @click="send(question)">{{ question }}</button>
      </div>
      <form class="assistant-input" @submit.prevent="submit">
        <input v-model="draft" type="text" maxlength="500" placeholder="问问雪豹…" aria-label="输入你的问题" :disabled="sending" />
        <button type="submit" :disabled="sending || !draft.trim()" aria-label="发送"><svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3.4 20.4l17.4-7.5a1 1 0 0 0 0-1.8L3.4 3.6a.9.9 0 0 0-1.3 1L4 11l10 1-10 1-1.9 6.4a.9.9 0 0 0 1.3 1z" /></svg></button>
      </form>
    </section>
  </Transition>
</template>

<style scoped>
.assistant-chat {
  position: fixed;
  right: clamp(14px, 2.5vw, 26px);
  bottom: calc(clamp(100px, 11vw, 130px) + clamp(18px, 3vh, 30px) + 10px);
  z-index: 89;
  display: flex;
  flex-direction: column;
  width: min(392px, calc(100vw - 28px));
  height: min(540px, calc(100dvh - 220px));
  min-height: 320px;
  border-radius: 20px;
  border: 1px solid rgba(255, 138, 61, .3);
  background: rgba(255, 252, 246, .92);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  box-shadow: 0 20px 48px rgba(64, 40, 16, .2);
  overflow: hidden;
  transform-origin: bottom right;
}
.assistant-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: linear-gradient(135deg, rgba(255, 154, 77, .18), rgba(255, 122, 46, .07));
  border-bottom: 1px solid rgba(255, 138, 61, .22);
}
.assistant-avatar { width: 40px; height: 40px; object-fit: contain; }
.assistant-title { flex: 1; min-width: 0; display: flex; flex-direction: column; line-height: 1.3; }
.assistant-title strong { font-size: 14.5px; color: #33291e; }
.assistant-title small { font-size: 11.5px; color: #9a7a58; }
.assistant-close { width: 32px; height: 32px; flex: 0 0 auto; display: grid; place-items: center; border: 0; border-radius: 10px; background: transparent; color: #8a6f52; cursor: pointer; transition: background .2s ease, color .2s ease; }
.assistant-close:hover { background: rgba(255, 138, 61, .14); color: #b35a1f; }
.assistant-messages { flex: 1; min-height: 0; overflow-y: auto; padding: 14px 14px 6px; display: flex; flex-direction: column; gap: 10px; scrollbar-width: thin; }
.assistant-row { display: flex; }
.assistant-row.user { justify-content: flex-end; }
.assistant-bubble {
  max-width: 84%;
  padding: 9px 12px;
  border-radius: 16px;
  font-size: 13.5px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  color: #33291e;
  background: #fff;
  border: 1px solid rgba(64, 40, 16, .08);
  box-shadow: 0 2px 8px rgba(64, 40, 16, .05);
}
.assistant-row.user .assistant-bubble {
  color: #fff;
  background: linear-gradient(135deg, #ff9d5c, #ff7a3d);
  border: 0;
  border-bottom-right-radius: 5px;
  box-shadow: 0 4px 12px rgba(255, 122, 61, .28);
}
.assistant-row.assistant .assistant-bubble { border-bottom-left-radius: 5px; }
.assistant-typing { display: inline-flex; align-items: center; gap: 4px; padding: 12px 14px; }
.assistant-typing span { width: 6px; height: 6px; border-radius: 50%; background: #ff9d5c; animation: assistant-blink 1s ease-in-out infinite; }
.assistant-typing span:nth-child(2) { animation-delay: .18s; }
.assistant-typing span:nth-child(3) { animation-delay: .36s; }
@keyframes assistant-blink { 0%, 100% { opacity: .25; transform: translateY(0); } 50% { opacity: 1; transform: translateY(-3px); } }
.assistant-quick { display: flex; flex-wrap: wrap; gap: 7px; padding: 8px 14px; }
.assistant-quick button { padding: 5px 11px; font-size: 12px; color: #b35a1f; background: rgba(255, 138, 61, .09); border: 1px solid rgba(255, 138, 61, .32); border-radius: 999px; cursor: pointer; transition: background .2s ease, transform .2s ease; }
.assistant-quick button:hover { background: rgba(255, 138, 61, .18); transform: translateY(-1px); }
.assistant-quick button:disabled { opacity: .5; cursor: not-allowed; }
.assistant-input { display: flex; align-items: center; gap: 9px; padding: 10px 12px calc(10px + env(safe-area-inset-bottom, 0px)); border-top: 1px solid rgba(255, 138, 61, .2); }
.assistant-input input { flex: 1; min-width: 0; height: 38px; padding: 0 13px; font-size: 13.5px; color: #33291e; background: #fff; border: 1px solid rgba(64, 40, 16, .14); border-radius: 12px; outline: none; transition: border-color .2s ease, box-shadow .2s ease; }
.assistant-input input:focus { border-color: #ff8a3d; box-shadow: 0 0 0 3px rgba(255, 138, 61, .16); }
.assistant-input button { width: 38px; height: 38px; flex: 0 0 auto; display: grid; place-items: center; border: 0; border-radius: 12px; color: #fff; background: linear-gradient(135deg, #ff9d5c, #ff7a3d); box-shadow: 0 4px 12px rgba(255, 122, 61, .32); cursor: pointer; transition: transform .2s ease, opacity .2s ease; }
.assistant-input button:hover { transform: translateY(-1px); }
.assistant-input button:disabled { opacity: .45; cursor: not-allowed; transform: none; box-shadow: none; }
.assistant-pop-enter-active { transition: opacity .26s ease, transform .26s cubic-bezier(.2, .9, .3, 1.18); }
.assistant-pop-leave-active { transition: opacity .18s ease, transform .18s ease; }
.assistant-pop-enter-from, .assistant-pop-leave-to { opacity: 0; transform: translateY(18px) scale(.94); }
@media (max-width: 700px) {
  .assistant-chat {
    right: 10px;
    left: 10px;
    width: auto;
    height: min(62dvh, 520px);
    bottom: calc(196px + env(safe-area-inset-bottom, 0px));
    border-radius: 18px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .assistant-pop-enter-active, .assistant-pop-leave-active { transition: opacity .18s ease; }
  .assistant-pop-enter-from, .assistant-pop-leave-to { transform: none; }
  .assistant-typing span { animation: none; }
}
</style>
