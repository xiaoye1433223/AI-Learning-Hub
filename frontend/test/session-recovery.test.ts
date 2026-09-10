// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { preserveVisibleText, recoveryTexts } from '../../packages/contracts/browser/recovery'
import { watchVisibleSession } from '../../packages/contracts/browser/session'

beforeEach(() => {
  localStorage.clear(); document.body.innerHTML = ''
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList)
})
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })
describe('失效恢复与闲置检查', () => {
  it('最近文字在旧账号下恢复，排除密码与MFA，重复失效不重复备份', () => {
    document.body.innerHTML = '<textarea>未同步评论</textarea><label>标题<input value="新标题"></label><input type="password" value="not-to-save"><input autocomplete="one-time-code" value="123456"><textarea disabled>上传中仍需保留的文字</textarea>'
    preserveVisibleText('student', 'recover-a'); preserveVisibleText('student', 'recover-a')
    const rows = recoveryTexts('student', 'recover-a')
    expect(rows).toHaveLength(1); expect(rows[0].status).toBe('尚未同步')
    expect(rows[0].text).toContain('未同步评论'); expect(rows[0].text).toContain('新标题'); expect(rows[0].text).toContain('上传中仍需保留的文字')
    expect(rows[0].text).not.toMatch(/not-to-save|123456/)
    expect(recoveryTexts('student', 'recover-b')).toEqual([])
    expect(recoveryTexts('admin', 'recover-a')).toEqual([])
  })
  it('25秒可见检查、重新聚焦立即检查，后台及同时焦点事件不重复检查', async () => {
    vi.useFakeTimers()
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    const check = vi.fn(async () => {})
    const stop = watchVisibleSession(check)
    await vi.advanceTimersByTimeAsync(25000); expect(check).toHaveBeenCalledOnce()
    window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('focus'))
    await Promise.resolve(); expect(check).toHaveBeenCalledTimes(2)
    visibility.mockReturnValue('hidden'); await vi.advanceTimersByTimeAsync(50000)
    expect(check).toHaveBeenCalledTimes(2)
    visibility.mockReturnValue('visible'); document.dispatchEvent(new Event('visibilitychange'))
    await Promise.resolve(); expect(check).toHaveBeenCalledTimes(3)
    stop(); await vi.advanceTimersByTimeAsync(50000); expect(check).toHaveBeenCalledTimes(3)
  })
})
