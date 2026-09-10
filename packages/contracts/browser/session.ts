import { ACCOUNT_BANNED, SESSION_REPLACED, SESSION_REPLACED_MESSAGE } from '../src/auth'

type RefreshResult = { status: number; body: { code?: number; errorCode?: string; message?: string; data?: { accessToken: string } } | null }
let worker: SharedWorker | undefined, sequence = 0
const waiting = new Map<number, (value: RefreshResult) => void>()

export async function serializedRefresh(url: string, token: string | null, client: string): Promise<RefreshResult> {
  const send = async () => {
    const response = await fetch(url, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) } })
    return { status: response.status, body: await response.json().catch(() => null) }
  }
  // HTTPS 使用原生锁；普通 HTTP 使用同源共享 Worker，不存储令牌到 localStorage。
  if (typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request(client + '-refresh', send)
  if (typeof SharedWorker === 'undefined') throw new Error('当前浏览器无法协调多标签会话，请使用支持共享 Worker 的浏览器或 HTTPS 入口')
  if (!worker) {
    worker = new SharedWorker(new URL('./refresh-worker.js', import.meta.url), { name: 'aihub-session-refresh' })
    worker.port.onmessage = ({ data }: MessageEvent<RefreshResult & { id: number }>) => { waiting.get(data.id)?.(data); waiting.delete(data.id) }
    worker.port.start()
  }
  const id = ++sequence
  return new Promise(resolve => {
    const timer = setTimeout(() => { waiting.delete(id); resolve({ status: 0, body: null }) }, 20000)
    waiting.set(id, value => { clearTimeout(timer); resolve(value) })
    worker!.port.postMessage({ id, url: new URL(url, location.href).href, token })
  })
}

const identity = (token: string | null) => {
  try { const claims = JSON.parse(atob(token!.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))); return `${claims.id}:${claims.sessionId}` }
  catch { return token }
}
export function browserSession(client: 'student' | 'admin') {
  const key = client + '-access-token', endedKey = client + '-session-ended'
  let generation = 0, controller = new AbortController()
  return {
    get generation() { return generation },
    get signal() { return controller.signal },
    get ended() { return sessionStorage.getItem(endedKey) },
    token: () => sessionStorage.getItem(key),
    accept(token: string) { generation++; controller.abort(); controller = new AbortController(); sessionStorage.removeItem(endedKey); sessionStorage.setItem(key, token) },
    rotate(token: string) { sessionStorage.setItem(key, token) },
    end(code?: string, expectedToken?: string | null, message?: string) {
      if (expectedToken && identity(expectedToken) !== identity(sessionStorage.getItem(key))) return
      if (sessionStorage.getItem(endedKey)) return
      generation++
      const detail = { code, hadToken: !!sessionStorage.getItem(key), message: code === SESSION_REPLACED ? SESSION_REPLACED_MESSAGE : code === ACCOUNT_BANNED ? message || '账号已被封禁，请通过账号恢复与申诉入口查看处理决定。' : '登录状态已失效，请重新登录' }
      // 同步通知编辑器落盘，随后取消请求、清空账号状态；不调用服务端退出接口。
      window.dispatchEvent(new CustomEvent(client + '-auth-before-clear', { detail }))
      sessionStorage.setItem(endedKey, code || 'SESSION_EXPIRED')
      controller.abort(); controller = new AbortController()
      sessionStorage.removeItem(key); sessionStorage.removeItem(client + '-user')
      window.dispatchEvent(new CustomEvent(client + '-auth-session-cleared', { detail }))
    },
  }
}

export function watchVisibleSession(check: () => Promise<void>) {
  let checking = false
  const run = () => {
    if (document.visibilityState !== 'visible' || checking) return
    checking = true
    void check().finally(() => { checking = false })
  }
  const timer = setInterval(run, 25000)
  window.addEventListener('focus', run); document.addEventListener('visibilitychange', run)
  return () => { clearInterval(timer); window.removeEventListener('focus', run); document.removeEventListener('visibilitychange', run) }
}
