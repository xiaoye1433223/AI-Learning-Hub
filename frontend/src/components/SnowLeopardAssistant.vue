<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import leopardUrl from '../assets/snow-leopard.png'
import AssistantChatPanel from './AssistantChatPanel.vue'
import { useLeopardActions } from './assistant/leopard-actions'

const { activeAction, play } = useLeopardActions()

const open = ref(false)
const sparks = ref<Array<{ id: number; dx: number; glyph: string }>>([])
const SPARK_GLYPHS = ['✦', '·', '🐾', '✧']
let sparkId = 0, sparkTimer: number | undefined

const spawnSparks = (count: number) => {
  if (!count) return
  for (let i = 0; i < count; i++) sparks.value.push({ id: ++sparkId, dx: Math.round(-34 + Math.random() * 68), glyph: SPARK_GLYPHS[Math.floor(Math.random() * SPARK_GLYPHS.length)] })
  window.clearTimeout(sparkTimer)
  sparkTimer = window.setTimeout(() => { sparks.value = [] }, 740)
}
const toggle = () => {
  const action = play()
  spawnSparks(action.sparks)
  open.value = !open.value
}
onBeforeUnmount(() => window.clearTimeout(sparkTimer))
</script>

<template>
  <button type="button" class="snow-leopard-assistant" title="雪豹助手" aria-label="雪豹助手" :aria-expanded="open" :class="{ acting: activeAction }" @click="toggle">
    <img :src="leopardUrl" alt="" draggable="false" :class="activeAction?.className" />
    <span v-for="spark in sparks" :key="spark.id" class="leopard-spark" :style="{ '--dx': `${spark.dx}px` }" aria-hidden="true">{{ spark.glyph }}</span>
  </button>
  <AssistantChatPanel :open="open" @close="open = false" />
</template>

<style scoped>
.snow-leopard-assistant {
  position: fixed;
  right: clamp(14px, 2.5vw, 26px);
  bottom: clamp(18px, 3vh, 30px);
  z-index: 90;
  width: clamp(100px, 11vw, 130px);
  padding: 0;
  border: 0;
  background: transparent;
  box-shadow: none;
  line-height: 0;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: transform .28s cubic-bezier(.22, .9, .36, 1.2), filter .28s ease;
  filter: drop-shadow(0 8px 16px rgba(31, 26, 18, .22));
}
.snow-leopard-assistant img {
  display: block;
  width: 100%;
  height: auto;
  user-select: none;
  transform-origin: 50% 92%;
  animation: leopard-breathe 3.8s ease-in-out infinite;
}
.snow-leopard-assistant:hover {
  transform: translateY(-6px) scale(1.07);
  filter: drop-shadow(0 14px 24px rgba(31, 26, 18, .3));
}
.snow-leopard-assistant:active {
  transform: translateY(-2px) scale(1.01);
}
.snow-leopard-assistant.acting {
  filter: drop-shadow(0 16px 26px rgba(214, 116, 42, .34));
}
.snow-leopard-assistant:focus-visible {
  outline: 2px solid #6d5bd0;
  outline-offset: 4px;
  border-radius: 12px;
}
.leopard-spark {
  position: absolute;
  left: 50%;
  bottom: 62%;
  font-size: 13px;
  line-height: 1;
  color: #ff9d5c;
  pointer-events: none;
  animation: leopard-spark-rise .72s ease-out forwards;
}
@keyframes leopard-spark-rise {
  0% { opacity: 0; transform: translate(-50%, 6px) scale(.5); }
  25% { opacity: 1; }
  100% { opacity: 0; transform: translate(calc(-50% + var(--dx, 0px)), -34px) scale(1.15); }
}
@keyframes leopard-breathe {
  0%, 100% { transform: translateY(0) scale(1); }
  50% { transform: translateY(-4px) scale(1.03); }
}
.leopard-wave { animation: leopard-wave .9s ease-in-out; }
@keyframes leopard-wave {
  0%, 100% { transform: rotate(0) translateY(0); }
  18% { transform: rotate(-10deg) translateY(-4px); }
  36% { transform: rotate(12deg) translateY(-6px); }
  54% { transform: rotate(-12deg) translateY(-5px); }
  72% { transform: rotate(9deg) translateY(-3px); }
  88% { transform: rotate(-3deg) translateY(0); }
}
.leopard-jump { animation: leopard-jump .76s cubic-bezier(.3, 1.4, .5, 1); }
@keyframes leopard-jump {
  0%, 100% { transform: translateY(0) scale(1, 1); }
  22% { transform: translateY(3px) scale(1.06, .93); }
  48% { transform: translateY(-20px) scale(.96, 1.05); }
  72% { transform: translateY(0) scale(1.04, .95); }
  88% { transform: translateY(-5px) scale(.99, 1.01); }
}
.leopard-sway { animation: leopard-sway .84s ease-in-out; }
@keyframes leopard-sway {
  0%, 100% { transform: rotate(0); }
  25% { transform: rotate(-8deg); }
  50% { transform: rotate(8deg); }
  75% { transform: rotate(-5deg); }
}
.leopard-cute { animation: leopard-cute 1s ease-in-out; }
@keyframes leopard-cute {
  0%, 100% { transform: scale(1, 1); }
  15% { transform: scale(1.03, .9); }
  28% { transform: scale(1, 1); }
  42% { transform: scale(1.03, .88); }
  56% { transform: scale(1, 1); }
  78% { transform: scale(1.08, 1.05); }
}
@media (prefers-reduced-motion: reduce) {
  .snow-leopard-assistant img { animation: none; }
  .snow-leopard-assistant:hover { transform: none; }
  .leopard-wave, .leopard-jump, .leopard-sway, .leopard-cute { animation: none; }
  .leopard-spark { animation: none; opacity: 0; }
}
@media (max-width: 700px) {
  .snow-leopard-assistant {
    width: clamp(88px, 22vw, 110px);
    bottom: calc(84px + env(safe-area-inset-bottom, 0px));
  }
}
</style>
