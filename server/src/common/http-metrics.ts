// 只保留分钟汇总，不保存 URL、账号、IP 或令牌；进程重启在 startedAt 中明确显示。
const minutes = new Map<number, { requests: number; errors5xx: number }>()
export const metricsStartedAt = new Date().toISOString()
export function recordHttpStatus(status: number, now = Date.now()) {
  const minute = Math.floor(now / 60_000)
  const bucket = minutes.get(minute) || { requests: 0, errors5xx: 0 }
  bucket.requests++
  if (status >= 500) bucket.errors5xx++
  minutes.set(minute, bucket)
  for (const key of minutes.keys()) if (key < minute - 5) minutes.delete(key)
}
export function httpMetrics(now = Date.now()) {
  const minute = Math.floor(now / 60_000)
  return [...minutes].filter(([key]) => key >= minute - 4 && key <= minute).reduce((total, [, bucket]) => ({ requests: total.requests + bucket.requests, errors5xx: total.errors5xx + bucket.errors5xx, windowSeconds: 300 }), { requests: 0, errors5xx: 0, windowSeconds: 300 })
}
