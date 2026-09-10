import { onBeforeUnmount, ref } from 'vue'

export interface LeopardAction {
  id: string
  className: string
  duration: number
  sparks: number
}

export const LEOPARD_ACTIONS: LeopardAction[] = [
  { id: 'wave', className: 'leopard-wave', duration: 900, sparks: 3 },
  { id: 'jump', className: 'leopard-jump', duration: 760, sparks: 5 },
  { id: 'sway', className: 'leopard-sway', duration: 840, sparks: 0 },
  { id: 'cute', className: 'leopard-cute', duration: 1000, sparks: 4 },
]

export function useLeopardActions() {
  const activeAction = ref<LeopardAction | null>(null)
  let lastId = '', timer: number | undefined

  const play = (): LeopardAction => {
    const pool = LEOPARD_ACTIONS.filter((item) => item.id !== lastId)
    const pick = pool[Math.floor(Math.random() * pool.length)]
    lastId = pick.id
    window.clearTimeout(timer)
    activeAction.value = pick
    timer = window.setTimeout(() => { activeAction.value = null }, pick.duration)
    return pick
  }

  onBeforeUnmount(() => window.clearTimeout(timer))
  return { activeAction, play }
}
