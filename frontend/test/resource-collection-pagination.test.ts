import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LearningCollectionDto } from '@ai-learning-hub/contracts'
import ResourceCollectionView from '../src/views/ResourceCollectionView.vue'
import { resourceHubApi } from '../src/services/api/resourceHub'
import { flushRender, setupComponent } from '../src/community/test-renderer'

vi.mock('vue-router', () => ({ useRoute: () => ({ params: { collectionId: 'collection' } }) }))
vi.mock('../src/services/api/resourceHub', () => ({ resourceHubApi: { collection: vi.fn(), reorderCollection: vi.fn(), removeFromCollection: vi.fn() } }))
vi.mock('../src/community/composables/useCommunityAccess', () => ({ useCommunityAccess: () => ({ requireWrite: () => true }) }))

const page = (indices: number[], nextCursor: string | null, revision = 1) => ({
  id: 'collection', revision, visibility: 'private', isOwner: true, itemCount: 60, nextCursor, previousCursor: null,
  items: indices.map((index) => ({ id: `item-${index}`, sortOrder: index, contribution: { id: `post-${index}` } })),
}) as LearningCollectionDto
interface State { collection: LearningCollectionDto; error: string; load(append?: boolean): Promise<void>; move(index: number, step: number): Promise<void>; remove(id: string): Promise<void> }
beforeEach(() => vi.resetAllMocks())

describe('合集连续分页及编排', () => {
  it('跨页排序与移除仅更新目标，保留已加载条目及后续游标', async () => {
    vi.mocked(resourceHubApi.collection).mockResolvedValueOnce(page([0, 1], 'item-1')).mockResolvedValueOnce(page([2, 3], 'item-3')).mockResolvedValueOnce(page([4, 5], null, 3))
    const view = setupComponent<State>(ResourceCollectionView); await flushRender()
    await view.state.load(true)
    expect(resourceHubApi.collection).toHaveBeenLastCalledWith('collection', { cursor: 'item-1' })
    expect(view.state.collection.items.map((item) => item.id)).toEqual(['item-0', 'item-1', 'item-2', 'item-3'])
    vi.mocked(resourceHubApi.reorderCollection).mockResolvedValueOnce(page([0, 2], 'item-2', 2))
    await view.state.move(2, -1)
    expect(resourceHubApi.reorderCollection).toHaveBeenCalledExactlyOnceWith('collection', 1, ['item-2', 'item-1'])
    expect(view.state.collection.items.map((item) => [item.id, item.sortOrder])).toEqual([['item-0', 0], ['item-2', 1], ['item-1', 2], ['item-3', 3]])
    vi.mocked(resourceHubApi.removeFromCollection).mockResolvedValueOnce({ ...page([0, 2], 'item-2', 3), itemCount: 59 })
    await view.state.remove('item-3')
    expect(view.state.collection).toMatchObject({ revision: 3, itemCount: 59, nextCursor: 'item-1' })
    expect(view.state.collection.items).toHaveLength(3)
    await view.state.load(true)
    expect(resourceHubApi.collection).toHaveBeenLastCalledWith('collection', { cursor: 'item-1' })
    expect(view.state.collection.items.map((item) => item.id)).toEqual(['item-0', 'item-2', 'item-1', 'item-4', 'item-5'])
    expect(view.state.collection.nextCursor).toBeNull()
    view.unmount()
  })
  it('修订变化重新读取首屏，刷新后忽略上一轮翻页结果', async () => {
    vi.mocked(resourceHubApi.collection).mockResolvedValueOnce(page([0], 'item-0')).mockResolvedValueOnce(page([1], null, 2)).mockResolvedValueOnce(page([9], 'item-9', 2))
    const view = setupComponent<State>(ResourceCollectionView); await flushRender()
    await view.state.load(true)
    expect(view.state.collection.items.map((item) => item.id)).toEqual(['item-9'])
    let resolve!: (value: LearningCollectionDto) => void
    vi.mocked(resourceHubApi.collection).mockReturnValueOnce(new Promise((done) => { resolve = done })).mockResolvedValueOnce(page([20], null, 3))
    const pending = view.state.load(true)
    await view.state.load()
    resolve(page([10], null, 2)); await pending
    expect(view.state.collection.items.map((item) => item.id)).toEqual(['item-20'])
    view.unmount()
  })
  it('排序失败保留原顺序与修订，允许重试', async () => {
    vi.mocked(resourceHubApi.collection).mockResolvedValue(page([0, 1], null))
    const view = setupComponent<State>(ResourceCollectionView); await flushRender()
    vi.mocked(resourceHubApi.reorderCollection).mockRejectedValueOnce(new Error('合集已变化'))
    await view.state.move(1, -1)
    expect(view.state.collection.items.map((item) => item.id)).toEqual(['item-0', 'item-1'])
    expect(view.state.collection.revision).toBe(1)
    expect(view.state.error).toBe('合集已变化')
    view.unmount()
  })
})
