// 同源标签页共用此队列；HTTP 体验入口也能串行轮换 HttpOnly Cookie。
let queue = Promise.resolve()
self.onconnect = ({ ports: [port] }) => {
  port.onmessage = ({ data: { id, url, token } }) => {
    queue = queue.catch(() => undefined).then(async () => {
      try {
        const response = await fetch(url, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, signal: AbortSignal.timeout(15000) })
        port.postMessage({ id, status: response.status, body: await response.json().catch(() => null) })
      } catch { port.postMessage({ id, status: 0, body: null }) }
    })
  }
}
