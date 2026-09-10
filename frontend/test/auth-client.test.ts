import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, AUTH_SESSION_CLEARED_EVENT, request, restoreRefresh, studentSession } from '../src/services/api/client'
import { authApi } from '../src/services/api/auth'
import { assessmentApi } from '../src/services/api/assessments'
import { resourceHubApi } from '../src/services/api/resourceHub'
import { api as adminApi, adminSession } from '../../admin-web/src/services/api'
const stored = new Map<string, string>()
beforeEach(() => {
  stored.clear(); stored.set('student-access-token', 'local-test-token')
  vi.stubGlobal('sessionStorage', { getItem: (key: string) => stored.get(key) || null, setItem: (key: string, value: string) => stored.set(key, value), removeItem: (key: string) => stored.delete(key) })
  vi.stubGlobal('window', new EventTarget())
  vi.stubGlobal('navigator', { locks: { request: (_name: string, callback: () => unknown) => callback() } })
})
afterEach(() => vi.unstubAllGlobals())
describe('真实HTTP客户端会话边界', () => {
  it('账号封禁立即显示服务端原因，停止会话且不刷新重放写请求', async () => {
    const cleared = vi.fn()
    window.addEventListener(AUTH_SESSION_CLEARED_EVENT, cleared)
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 401, errorCode: 'ACCOUNT_BANNED', message: '账号已被封禁：重复发布垃圾广告。' }), { status: 401 }))
    vi.stubGlobal('fetch', fetcher)
    await expect(request('/community/posts', { method: 'POST', body: '{}' })).rejects.toMatchObject({ code: 'ACCOUNT_BANNED', status: 401 })
    expect(fetcher).toHaveBeenCalledOnce(); expect(cleared).toHaveBeenCalledOnce()
    expect(cleared.mock.calls[0][0].detail.message).toContain('重复发布垃圾广告')
    expect(studentSession.token()).toBeNull()
  })
  it('替代通知立即中止进行中的视频与附件上传，重新登录不会自动续传', async () => {
    const stopped = vi.fn(), sent = vi.fn()
    vi.stubGlobal('XMLHttpRequest', class {
      upload = {}; onabort?: () => void
      open() {} setRequestHeader() {} send() { sent() }
      abort() { stopped(); this.onabort?.() }
    })
    const file = new File(['隔离上传数据'], 'pending.txt', { type: 'text/plain' })
    const video = resourceHubApi.uploadVideo(file, () => {})
    const attachment = resourceHubApi.uploadDocument(file, () => {})
    const pending = Promise.allSettled([video.promise, attachment.promise])
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ errorCode: 'SESSION_REPLACED' }), { status: 401 })))
    await expect(request('/me')).rejects.toMatchObject({ code: 'SESSION_REPLACED' })
    expect((await pending).every(row => row.status === 'rejected')).toBe(true)
    expect(stopped).toHaveBeenCalledTimes(2)
    studentSession.accept('new-login-token')
    expect(sent).toHaveBeenCalledTimes(2); expect(fetch).toHaveBeenCalledOnce()
  })
  it.each(['student', 'admin'])('%s 替代错误只通知一次，不刷新、不重放写请求且先保稿后清空', async client => {
    const state = client === 'student' ? studentSession : adminSession
    state.accept(client + '-replaced-token')
    const submit = client === 'student' ? request : adminApi
    const saved = vi.fn(() => expect(state.token()).toBe(client + '-replaced-token'))
    const ended = vi.fn(() => expect(state.token()).toBeNull())
    window.addEventListener(client + '-auth-before-clear', saved)
    window.addEventListener(client + '-auth-session-cleared', ended)
    const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ code: 40101, errorCode: 'SESSION_REPLACED', message: '你的账号已在其他设备登录，当前设备已退出。' }), { status: 401 }))
    vi.stubGlobal('fetch', fetcher)
    const results = await Promise.allSettled([submit('/comments', { method: 'POST', body: '{}' }), submit('/me')])
    expect(results.every(row => row.status === 'rejected')).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('refresh'))).toBe(false)
    expect(saved).toHaveBeenCalledOnce(); expect(ended).toHaveBeenCalledOnce()
    await expect(submit('/comments', { method: 'POST', body: '{}' })).rejects.toMatchObject({ status: 401 })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('刷新接口明确返回替代原因时保留错误码，不重放原请求', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ errorCode: 'SESSION_REPLACED' }), { status: 401 })))
    await expect(request('/comment', { method: 'POST' })).rejects.toMatchObject({ code: 'SESSION_REPLACED', status: 401 })
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('迟到的旧请求不能清掉随后登录的新账号', async () => {
    let complete!: (value: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { complete = resolve })))
    const pending = request('/me')
    studentSession.accept('new-account-session')
    complete(new Response(JSON.stringify({ errorCode: 'SESSION_REPLACED' }), { status: 401 }))
    await expect(pending).rejects.toMatchObject({ status: 401 })
    expect(studentSession.token()).toBe('new-account-session'); expect(studentSession.ended).toBeNull()
  })
  it.each(['student', 'admin'])('%s 旧响应体延迟完成时不能带入新账号', async client => {
    const state = client === 'student' ? studentSession : adminSession
    state.accept(client + '-old-account')
    let finish!: (value: unknown) => void
    let started!: () => void
    const reading = new Promise<void>(resolve => { started = resolve })
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: () => new Promise(resolve => { finish = resolve; started() }) })))
    const pending = (client === 'student' ? request : adminApi)('/me')
    await reading
    state.accept(client + '-new-account')
    finish({ code: 0, data: { id: 'old-account' } })
    await expect(pending).rejects.toMatchObject({ status: 401 })
    expect(state.token()).toBe(client + '-new-account'); expect(state.ended).toBeNull()
  })
  it.each(['student', 'admin'])('%s 刷新携带旧设备身份，账号已变化时不重试原写请求', async client => {
    stored.set('admin-access-token', 'admin-test-token')
    const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ code: 40101, message: '账号已变化', data: null }), { status: 401 }))
    vi.stubGlobal('fetch', fetcher)
    const submit = client === 'student' ? request : adminApi
    await expect(submit('/me', { method: 'PATCH', body: '{}' })).rejects.toMatchObject({ status: 401 })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(String(fetcher.mock.calls[1][0])).toMatch(client === 'student' ? /\/auth\/refresh$/ : /\/admin-auth\/refresh$/)
    expect(fetcher.mock.calls[1][1].headers.authorization).toBe('Bearer ' + (client === 'student' ? 'local-test-token' : 'admin-test-token'))
  })

  it('资格错误保留结构化字段并在人机提示中带出解除时间', () => {
    const error = new ApiError('发布过于频繁', 429, 'COMMUNITY_RATE_LIMITED', '2026-09-06T12:00:00.000Z')
    expect(error).toMatchObject({ status: 429, code: 'COMMUNITY_RATE_LIMITED', availableAt: '2026-09-06T12:00:00.000Z' })
    expect(error.message).toContain('可重试')
  })
  it.each(['注册', '测评'] as const)('普通HTTP%s可发送请求，丢失响应后同键重试，成功后新操作换键', async (kind) => {
    const source = globalThis.crypto
    vi.stubGlobal('crypto', { getRandomValues: source.getRandomValues.bind(source) })
    expect(crypto.randomUUID).toBeUndefined()
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError('response lost')).mockImplementation(async () => new Response(JSON.stringify({ code: 0, data: { user: { id: 'http-registered' }, accessToken: 'isolated-test-token', score: 100 } })))
    vi.stubGlobal('fetch', fetcher)
    const input = { username: 'http_test_user', displayName: 'HTTP测试用户', email: 'http-registration@example.test', password: 'IsolatedTestOnly123!', agreementVersion: 'v1' }
    const submit = kind === '注册' ? () => authApi.register(input) : () => assessmentApi.submit('http-quiz', [{ questionId: 'q1', answer: 'a' }])
    await expect(submit()).rejects.toMatchObject({ status: 0 })
    expect(fetcher).toHaveBeenCalledOnce()
    await expect(submit()).resolves.toMatchObject(kind === '注册' ? { id: 'http-registered' } : { score: 100 })
    await submit()
    const keys = fetcher.mock.calls.map(([, init]) => (init?.headers as Record<string, string>)['idempotency-key'])
    expect(keys[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(keys[1]).toBe(keys[0]); expect(keys[2]).not.toBe(keys[0])
    expect(fetcher.mock.calls.every(([url, init]) => String(url).endsWith(kind === '注册' ? '/auth/register' : '/challenges/http-quiz/submit') && init?.method === 'POST')).toBe(true)
    expect(fetcher.mock.calls[1][1]?.body).toBe(fetcher.mock.calls[0][1]?.body)
  })
  it('刷新503不清空会话，网络错误不回退演示数据', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })))
    await expect(restoreRefresh()).rejects.toMatchObject({ status: 503 })
    expect(stored.has('student-access-token')).toBe(true)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
    await expect(request('/me')).rejects.toBeInstanceOf(ApiError)
    expect(stored.has('student-access-token')).toBe(true)
  })
  it('刷新401清空旧凭据且广播重新登录门禁', async () => {
    const listener = vi.fn(); window.addEventListener(AUTH_SESSION_CLEARED_EVENT, listener)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })))
    expect(await restoreRefresh()).toBe(false)
    expect(stored.has('student-access-token')).toBe(false); expect(listener).toHaveBeenCalledOnce()
  })
  it('并发刷新仅一条请求，完成后下一次能够重新刷新', async () => {
    const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ code: 0, data: { accessToken: 'renewed-test-token' } })))
    vi.stubGlobal('fetch', fetcher)
    await Promise.all([restoreRefresh(), restoreRefresh(), restoreRefresh()])
    expect(fetcher).toHaveBeenCalledOnce()
    await restoreRefresh()
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
