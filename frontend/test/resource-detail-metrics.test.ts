import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LearningCollectionDto, LearningCollectionSummaryDto, ResourceContributionDetailDto, ResourceHubItemDto } from '@ai-learning-hub/contracts'
import ResourceDetailView from '../src/views/ResourceDetailView.vue'
import { resourceHubApi } from '../src/services/api/resourceHub'
import { communityApi } from '../src/services/api/community'
import { flushRender, setupComponent } from '../src/community/test-renderer'

vi.mock('vue-router', () => ({ useRoute: () => ({ params: { postId: 'synthetic-post' } }), useRouter: () => ({}) }))
vi.mock('../src/services/api/resourceHub', () => ({ resourceHubApi: { detail: vi.fn(), collection: vi.fn(), collections: vi.fn(), playback: vi.fn() } }))
vi.mock('../src/services/api/community', () => ({ communityApi: { signals: vi.fn() } }))
vi.mock('../src/community/composables/useCommunityAccess', () => ({ useCommunityAccess: () => ({ requireWrite: () => true }) }))

const resource = (kind = 'article') => ({ post: { id: 'synthetic-post' }, contribution: { kind, video: null } }) as ResourceContributionDetailDto
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(resourceHubApi.collections).mockResolvedValue({ items: [], nextCursor: null })
  vi.mocked(communityApi.signals).mockResolvedValue({ recorded: true })
})
describe('资源打开与播放统计', () => {
  it('从后续内容进入仍有下一项，播放列表双向追加且合集选择可翻页', async () => {
    const entries = (ids: string[]) => ids.map((id) => ({ id, contribution: { id, postId: id } })) as LearningCollectionDto['items']
    const initial = { id: 'series', revision: 1, items: entries(['synthetic-post', 'next-post']), previousCursor: 'synthetic-post', nextCursor: 'next-post' } as LearningCollectionDto
    vi.mocked(resourceHubApi.detail).mockResolvedValue({ ...resource('video'), collection: initial })
    vi.mocked(resourceHubApi.collections).mockResolvedValueOnce({ items: [{ id: 'collection-1' }] as LearningCollectionSummaryDto[], nextCursor: 'collection-1' }).mockResolvedValueOnce({ items: [{ id: 'collection-2' }] as LearningCollectionSummaryDto[], nextCursor: null })
    const view = setupComponent<{ detail: ResourceContributionDetailDto; nextItem: ResourceHubItemDto; collections: LearningCollectionSummaryDto[]; moreSeries(direction: 'before' | 'after'): Promise<void>; moreCollections(): Promise<void> }>(ResourceDetailView); await flushRender()
    expect(view.state.nextItem.postId).toBe('next-post')
    vi.mocked(resourceHubApi.collection).mockResolvedValueOnce({ ...initial, items: entries(['previous-post']), previousCursor: null, nextCursor: 'previous-post' }).mockResolvedValueOnce({ ...initial, items: entries(['last-post']), previousCursor: 'last-post', nextCursor: null })
    await view.state.moreSeries('before')
    expect(resourceHubApi.collection).toHaveBeenLastCalledWith('series', { cursor: 'synthetic-post', direction: 'before' })
    expect(view.state.detail.collection?.nextCursor).toBe('next-post')
    await view.state.moreSeries('after')
    expect(resourceHubApi.collection).toHaveBeenLastCalledWith('series', { cursor: 'next-post', direction: 'after' })
    expect(view.state.detail.collection?.items.map((item) => item.id)).toEqual(['previous-post', 'synthetic-post', 'next-post', 'last-post'])
    expect(view.state.detail.collection).toMatchObject({ previousCursor: null, nextCursor: null })
    expect(view.state.nextItem.postId).toBe('next-post')
    await view.state.moreCollections()
    expect(resourceHubApi.collections).toHaveBeenLastCalledWith('collection-1')
    expect(view.state.collections.map((row) => row.id)).toEqual(['collection-1', 'collection-2'])
    view.unmount()
  })
  it.each(['article', 'document', 'video'])('%s 仅已显示图文和资料记录打开，视频等待有效播放', async (kind) => {
    vi.mocked(resourceHubApi.detail).mockResolvedValue(resource(kind))
    const view = setupComponent<{ load(): Promise<void> }>(ResourceDetailView); await flushRender()
    await view.state.load() // 点赞等操作刷新详情不应产生第二次浏览。
    if (kind === 'video') expect(communityApi.signals).not.toHaveBeenCalled()
    else expect(communityApi.signals).toHaveBeenCalledExactlyOnceWith({ eventType: 'community_post_click', targetType: 'post', targetId: 'synthetic-post' })
    view.unmount()
  })
  it('读取失败或离开后的迟到结果均不产生浏览记录', async () => {
    vi.mocked(resourceHubApi.detail).mockRejectedValueOnce(new Error('当前不可见'))
    const failed = setupComponent(ResourceDetailView); await flushRender(); failed.unmount()
    let resolve!: (value: ResourceContributionDetailDto) => void
    vi.mocked(resourceHubApi.detail).mockReturnValueOnce(new Promise((done) => { resolve = done }))
    const late = setupComponent(ResourceDetailView); late.unmount()
    resolve(resource()); await flushRender()
    expect(communityApi.signals).not.toHaveBeenCalled()
    expect(resourceHubApi.collections).not.toHaveBeenCalled()
  })
})
