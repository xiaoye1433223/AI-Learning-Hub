import { beforeEach, describe, expect, it, vi } from 'vitest'
import ResourceManagementView from '../../admin-web/src/views/management/ResourceManagementView.vue'
import { api } from '../../admin-web/src/services/api'
import { flushRender, setupComponent } from '../src/community/test-renderer'

const messages = vi.hoisted(() => ({ success: vi.fn(), warning: vi.fn() }))
vi.mock('../../admin-web/node_modules/element-plus', () => ({ ElMessage: messages }))
vi.mock('../../admin-web/node_modules/vue-router', () => ({ useRoute: () => ({ query: {} }) }))
vi.mock('../../admin-web/src/stores/session', () => ({ useSessionStore: () => ({ user: { permissions: ['resource.read', 'resource.write', 'resource.publish'] } }) }))
vi.mock('../../admin-web/src/services/api', () => ({ api: vi.fn() }))
let outcome: object, reject = false
beforeEach(() => {
  vi.resetAllMocks(); reject = false; outcome = { status: 'reviewing' }
  vi.mocked(api).mockImplementation(async (path) => {
    if (path.endsWith('/publish')) { if (reject) throw new Error('内容未发布，请修改当前输入'); return outcome }
    if (path.startsWith('/admin/resources?')) return { items: [{ id: 'synthetic-slug', databaseId: 'synthetic-resource', title: '合成资源', data: {} }], total: 1, page: 1, pageSize: 10 }
    if (path === '/admin/resources/synthetic-resource') return { title: '合成资源' }
    if (path === '/admin/resource-hub/config') return { revision: 1, bannerPostIds: [], sectionCategoryCodes: [] }
    if (/^\/admin\/resource-hub\/(items|collections|processing-failures|reports)(\?|$)/.test(path)) return { items: [], nextCursor: null }
    if (path.startsWith('/admin/resource-hub/')) return []
    return { items: [] }
  })
})

describe('后台资源发布真实状态提示', () => {
  it('待复核不提示发布成功', async () => {
    const view = setupComponent<{ publish(): Promise<void> }>(ResourceManagementView)
    await flushRender(); await view.state.publish()
    expect(messages.success).not.toHaveBeenCalled()
    expect(messages.warning).toHaveBeenCalledWith(expect.stringContaining('尚未公开'))
    expect(api).toHaveBeenCalledWith('/admin/resources/synthetic-resource/publish', { method: 'POST' })
    view.unmount()
  })
  it('已发布的提醒正常显示，重复命中不重复提示', async () => {
    outcome = { status: 'published', detection: { action: 'warn', hits: [{ explanation: '请确认资料授权' }, { explanation: '请确认资料授权' }] } }
    const view = setupComponent<{ publish(): Promise<void> }>(ResourceManagementView)
    await flushRender(); await view.state.publish()
    expect(messages.success).toHaveBeenCalledWith('资源已发布')
    expect(messages.warning).toHaveBeenCalledWith('请确认资料授权')
    view.unmount()
  })
  it('拒绝时不清空编辑字段，也不弹出成功提示', async () => {
    const view = setupComponent<{ publish(): Promise<void>; fields: { tags: string } }>(ResourceManagementView)
    await flushRender(); view.state.fields.tags = '保留的合成标签'; reject = true
    await expect(view.state.publish()).rejects.toThrow('内容未发布')
    expect(view.state.fields.tags).toBe('保留的合成标签')
    expect(messages.success).not.toHaveBeenCalled()
    expect(messages.warning).not.toHaveBeenCalled()
    view.unmount()
  })
})

interface PaginationState {
  hubItems: Array<{ id: string }>; hubNextCursor: string | null; hubKeyword: string
  loadHubItems(append?: boolean): Promise<void>; loadHub(): Promise<void>
}
describe('后台资源真实分页', () => {
  it('使用服务器游标连续读完55条，超过原来的48条仍可加载', async () => {
    const defaults = vi.mocked(api).getMockImplementation()!
    vi.mocked(api).mockImplementation(async (path, options) => {
      if (!path.startsWith('/admin/resource-hub/items?')) return defaults(path, options)
      const start = Number(new URL(path, 'http://test.invalid').searchParams.get('cursor') || 0)
      return { items: Array.from({ length: Math.min(18, 55 - start) }, (_, index) => ({ id: String(start + index) })), nextCursor: start + 18 < 55 ? String(start + 18) : null }
    })
    const view = setupComponent<PaginationState>(ResourceManagementView); await flushRender()
    for (let page = 0; page < 3; page++) await view.state.loadHubItems(true)
    expect(view.state.hubItems).toHaveLength(55)
    expect(new Set(view.state.hubItems.map((row) => row.id)).size).toBe(55)
    expect(view.state.hubNextCursor).toBeNull()
    const paths = vi.mocked(api).mock.calls.map(([path]) => path).filter((path) => path.startsWith('/admin/resource-hub/items?'))
    expect(paths.map((path) => new URL(path, 'http://test.invalid').searchParams.get('cursor'))).toEqual([null, '18', '36', '54'])
    view.unmount()
  })
  it('刷新或改变筛选后，旧分页响应不能覆盖新列表', async () => {
    const defaults = vi.mocked(api).getMockImplementation()!
    let resolve!: (page: unknown) => void
    vi.mocked(api).mockImplementation(async (path, options) => {
      if (!path.startsWith('/admin/resource-hub/items?')) return defaults(path, options)
      const query = new URL(path, 'http://test.invalid').searchParams
      if (query.get('cursor')) return new Promise((done) => { resolve = done })
      return { items: [{ id: query.get('keyword') || 'old' }], nextCursor: 'next-page' }
    })
    const view = setupComponent<PaginationState>(ResourceManagementView); await flushRender()
    const pending = view.state.loadHubItems(true)
    view.state.hubKeyword = 'new'; await view.state.loadHub()
    resolve({ items: [{ id: 'late-old' }], nextCursor: null }); await pending
    expect(view.state.hubItems.map((row) => row.id)).toEqual(['new'])
    expect(view.state.hubNextCursor).toBe('next-page')
    view.unmount()
  })
})
