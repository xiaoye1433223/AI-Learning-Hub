import type { ApiEnvelope } from '@ai-learning-hub/contracts'
import { SESSION_REPLACED, SESSION_REPLACED_MESSAGE } from '@ai-learning-hub/contracts'
import { browserSession, serializedRefresh } from '../../../packages/contracts/browser/session'
export const adminSession = browserSession('admin')

const baseUrl = import.meta.env.VITE_API_BASE_URL || '/api/v1'

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message)
  }
}

let refreshPromise: Promise<boolean> | null = null

const refresh = async () => {
  if (adminSession.ended) return false
  const previous = adminSession.token(), generation = adminSession.generation
  const { status, body } = await serializedRefresh(baseUrl + '/admin-auth/refresh', previous, 'admin').catch(() => { throw new ApiError('连接暂时异常，请重新连接', 0) })
  if (generation !== adminSession.generation) return false
  if (status === 401) {
    adminSession.end(body?.errorCode, previous)
    if (body?.errorCode === SESSION_REPLACED) throw new ApiError(SESSION_REPLACED_MESSAGE, 401, SESSION_REPLACED)
    return false
  }
  if (status < 200 || status >= 300) throw new ApiError('服务暂时不可用，请重新连接', status)
  if (!body || body.code !== 0 || !body.data?.accessToken) throw new ApiError('会话响应异常，请重新连接', 502)
  adminSession.rotate(body.data.accessToken)
  return true
}

async function responseFor(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const token = adminSession.token(), generation = adminSession.generation
  const authentication = path.startsWith('/admin-auth/')
  if (adminSession.ended && !authentication && !['GET', 'HEAD'].includes(init.method || 'GET')) throw new ApiError('请重新登录后手动提交，未同步内容已保留', 401)
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    signal: init.signal ? AbortSignal.any([init.signal, adminSession.signal]) : adminSession.signal,
    credentials: 'include',
    headers: {
      ...(init.body instanceof FormData ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  }).catch(() => { throw new ApiError('连接暂时异常，请重新连接', 0) })
  if (generation !== adminSession.generation) throw new ApiError('会话已变化，请重新操作', 401)
  if (response.status === 401 && (await response.clone().json().catch(() => null))?.errorCode === SESSION_REPLACED) {
    adminSession.end(SESSION_REPLACED, token)
    throw new ApiError(SESSION_REPLACED_MESSAGE, 401, SESSION_REPLACED)
  }
  if (response.status === 401 && retry && !authentication) {
    refreshPromise ||= refresh().finally(() => { refreshPromise = null })
    if (await refreshPromise) return responseFor(path, init, false)
  }
  return response
}

export async function api<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const generation = adminSession.generation
  const response = await responseFor(path, init, retry)
  const body = await response.json().catch(() => null) as ApiEnvelope<T> | null
  if (generation !== adminSession.generation) throw new ApiError('会话已变化，请重新操作', 401)
  if (!response.ok || !body || body.code !== 0) throw new ApiError(body?.message || `请求失败（${response.status}）`, response.status)
  return body.data
}

export async function apiBlob(path: string, signal?: AbortSignal): Promise<Blob> {
  const generation = adminSession.generation
  const response = await responseFor(path, { signal })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as ApiEnvelope<unknown> | null
    throw new ApiError(body?.message || `图片读取失败（${response.status}）`, response.status)
  }
  const blob = await response.blob()
  if (generation !== adminSession.generation) throw new ApiError('会话已变化，请重新读取图片', 401)
  return blob
}
