import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommunityPostDetailDto, CreatorContentSummaryDto, LearningCollectionDto, LearningCollectionSummaryDto, ResourceContributionDetailDto, ResourceHubHomeDto, ResourceHubListDto, ResourceHubPageDto, VideoAssetDto, VideoPlaybackDto } from '@ai-learning-hub/contracts'
import { mockCommunity, resetCommunityMock } from './community.mock'
import { mockResourceHub, resetResourceHubMock } from './resourceHub.mock'

const values = new Map<string, string>()
const localStorageStub = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value) },
  removeItem: (key: string) => { values.delete(key) },
  clear: () => { values.clear() },
}

beforeEach(() => {
  vi.stubGlobal('localStorage', localStorageStub)
  values.clear()
  resetCommunityMock()
  resetResourceHubMock()
})
afterEach(() => {
  resetResourceHubMock()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('资源共创 Mock 与正式契约语义', () => {
  it('旧作品的新打开进入周期榜，曝光不充当播放，有效观看按六小时去重', async () => {
    vi.useFakeTimers()
    const now = Date.parse('2026-11-01T00:00:00Z'), day = 86400000
    vi.setSystemTime(now - 40 * day)
    const article = await mockCommunity<CommunityPostDetailDto>('/posts', 'POST', { type: 'note', title: '周期统计合成教程', contentBlocks: [{ type: 'paragraph', text: '仅用于验证事件时间窗口。' }], bindings: [], topicIds: [], visibility: 'public', status: 'published', contribution: { kind: 'article', tags: [] } })
    for (const [days, count] of [[40, 1], [10, 2], [0, 3]]) {
      vi.setSystemTime(now - days * day)
      for (let index = 0; index < count; index++) await mockCommunity('/signals', 'POST', { eventType: 'community_post_click', targetType: 'post', targetId: article.id })
    }
    let home = await mockResourceHub<ResourceHubHomeDto>('/home')
    expect(home.rankings.week[0]).toMatchObject({ id: article.id, rankingViews: 3 })
    expect(home.rankings.month[0]).toMatchObject({ id: article.id, rankingViews: 5 })
    expect((await mockResourceHub<ResourceContributionDetailDto>(`/contributions/${article.id}`)).stats).toMatchObject({ views: 6, plays: null })
    const postId = 'resource-demo-ai-literacy', assetId = `video-${postId}`
    const baseline = (await mockResourceHub<ResourceContributionDetailDto>(`/contributions/${postId}`)).stats.plays!
    const input = { items: [{ requestId: 'metrics-request', postId }] }
    await mockCommunity('/feed/impressions', 'POST', input)
    await mockCommunity('/feed/impressions', 'POST', input)
    expect((await mockResourceHub<ResourceContributionDetailDto>(`/contributions/${postId}`)).stats).toMatchObject({ plays: baseline, impressions: 1 })
    for (let index = 0; index < 2; index++) await mockResourceHub(`/videos/${assetId}/progress`, 'PUT', { positionSeconds: 8, watchedSeconds: 8, completed: true })
    expect((await mockResourceHub<ResourceContributionDetailDto>(`/contributions/${postId}`)).stats).toMatchObject({ plays: baseline + 1, impressions: 1 })
    vi.setSystemTime(now + 8 * day)
    home = await mockResourceHub<ResourceHubHomeDto>('/home')
    expect(home.rankings.week.every((row) => row.rankingViews === 0)).toBe(true)
    expect(home.rankings.month[0]).toMatchObject({ id: article.id, rankingViews: 5 })
    expect((await mockResourceHub<ResourceContributionDetailDto>(`/contributions/${article.id}`)).stats.views).toBe(6)
  })
  it('分页读完 24 条演示作品、保留 3 张 Banner 和四个核心分区', async () => {
    const home = await mockResourceHub<ResourceHubHomeDto>('/home')
    const list = await mockResourceHub<ResourceHubListDto>('/items?kind=all')
    expect(list.items).toHaveLength(18)
    expect(list.nextCursor).toBeTruthy()
    const next = await mockResourceHub<ResourceHubListDto>(`/items?kind=all&cursor=${encodeURIComponent(list.nextCursor!)}`)
    expect(next.items).toHaveLength(6)
    expect(next.nextCursor).toBeNull()
    const items = [...list.items, ...next.items]
    expect(new Set(items.map((item) => `${item.sourceType}:${item.id}`)).size).toBe(24)
    expect(home.banners).toHaveLength(3)
    expect(home.sections.map((section) => section.categoryCode)).toEqual(['ai-foundation', 'lab-demo', 'model-deployment', 'agent-practice'])
    expect(new Set(items.map((item) => item.kind))).toEqual(new Set(['video', 'article', 'document']))
    expect(items.filter((item) => item.kind === 'video').every((item) => item.videoAssetId && item.mediaStatus === 'ready' && item.coverUrl)).toBe(true)
  })

  it('筛选作用于完整结果，社区隐藏后各资源入口同步不可见', async () => {
    const filtered = await mockResourceHub<ResourceHubListDto>('/items?kind=video&category=agent-practice&keyword=Agent')
    expect(filtered.items.length).toBeGreaterThan(0)
    expect(filtered.items.every((item) => item.kind === 'video' && item.category?.code === 'agent-practice')).toBe(true)
    const hiddenId = filtered.items[0].postId!
    await mockCommunity(`/posts/${hiddenId}/hide`, 'POST')
    const after = await mockResourceHub<ResourceHubListDto>('/items?kind=all')
    await expect(mockResourceHub(`/contributions/${hiddenId}`)).rejects.toThrow()
    expect(after.items.some((item) => item.postId === hiddenId)).toBe(false)
  })

  it('合集新增、去重、排序、删除与修订冲突均持久化', async () => {
    let collection = await mockResourceHub<LearningCollectionDto>('/collections', 'POST', { name: '我的学习清单', description: '固定测试', visibility: 'private', learningGoal: '完成两项资源' })
    collection = await mockResourceHub<LearningCollectionDto>(`/collections/${collection.id}/items`, 'POST', { postId: 'resource-demo-ai-literacy' })
    collection = await mockResourceHub<LearningCollectionDto>(`/collections/${collection.id}/items`, 'POST', { postId: 'resource-demo-campus-agent' })
    const duplicate = await mockResourceHub<LearningCollectionDto>(`/collections/${collection.id}/items`, 'POST', { postId: 'resource-demo-campus-agent' })
    expect(duplicate.items).toHaveLength(2)
    const reversed = duplicate.items.map((item) => item.id).reverse()
    collection = await mockResourceHub<LearningCollectionDto>(`/collections/${collection.id}/order`, 'PUT', { expectedRevision: duplicate.revision, itemIds: reversed })
    expect(collection.items.map((item) => item.id)).toEqual(reversed)
    await expect(mockResourceHub(`/collections/${collection.id}/order`, 'PUT', { expectedRevision: duplicate.revision, itemIds: reversed })).rejects.toThrow('已变化')
    collection = await mockResourceHub<LearningCollectionDto>(`/collections/${collection.id}/items/${collection.items[0].id}`, 'DELETE')
    expect(collection.items).toHaveLength(1)
  })

  it('合集超过一页仍完整可读，局部排序保留未加载成员，详情聚焦后续内容', async () => {
    const resources = (await mockResourceHub<ResourceHubListDto>('/items?limit=48')).items
    let collection = await mockResourceHub<LearningCollectionDto>('/collections', 'POST', { name: '分页测试清单', description: '', visibility: 'private' })
    for (const item of resources) collection = await mockResourceHub<LearningCollectionDto>(`/collections/${collection.id}/items`, 'POST', { postId: item.postId })
    const path = `/collections/${collection.id}`
    expect(collection.itemCount).toBe(24)
    expect(collection.items).toHaveLength(18)
    const tail = await mockResourceHub<LearningCollectionDto>(path + '?' + new URLSearchParams({ cursor: collection.nextCursor! }))
    expect(tail.items).toHaveLength(6)
    expect(tail.nextCursor).toBeNull()
    const original = [...collection.items, ...tail.items]
    const changed = await mockResourceHub<LearningCollectionDto>(path + '/order', 'PUT', { expectedRevision: collection.revision, itemIds: [original[18].id, original[17].id] })
    const after = await mockResourceHub<LearningCollectionDto>(path + '?' + new URLSearchParams({ cursor: changed.nextCursor! }))
    const expected = original.map((item) => item.id)
    ;[expected[17], expected[18]] = [expected[18], expected[17]]
    expect([...changed.items, ...after.items].map((item) => item.id)).toEqual(expected)
    const previous = await mockResourceHub<LearningCollectionDto>(path + '?' + new URLSearchParams({ cursor: after.previousCursor!, direction: 'before' }))
    expect(previous.items.map((item) => item.id)).toEqual(expected.slice(0, 18))
    expect(previous.previousCursor).toBeNull()
    const reserved = new Set(['resource-demo-first-agent', 'resource-demo-function', 'resource-demo-memory', 'resource-demo-multi-agent'])
    const focusedPost = resources.slice(19, 23).find((item) => !reserved.has(item.postId!))!.postId!
    const focused = await mockResourceHub<ResourceContributionDetailDto>(`/contributions/${focusedPost}`)
    expect(focused.collection?.id).toBe(collection.id)
    expect(focused.collection?.items[0].contribution.postId).toBe(focusedPost)
    expect(focused.collection?.items[1]).toBeDefined()
    expect(focused.collection?.previousCursor).toBeTruthy()
    await expect(mockResourceHub(path + '?cursor=foreign-item')).rejects.toThrow('游标无效')
  })

  it('个人合集分页且首页只取四项，工作室按组读完所有作品', async () => {
    for (let index = 0; index < 20; index++) await mockResourceHub('/collections', 'POST', { name: `合成清单${index}`, description: '', visibility: 'private' })
    const first = await mockResourceHub<ResourceHubPageDto<LearningCollectionSummaryDto>>('/collections')
    const second = await mockResourceHub<ResourceHubPageDto<LearningCollectionSummaryDto>>('/collections?' + new URLSearchParams({ cursor: first.nextCursor! }))
    expect(first.items).toHaveLength(18)
    expect(second.items).toHaveLength(3)
    expect(second.nextCursor).toBeNull()
    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(21)
    expect((await mockResourceHub<ResourceHubHomeDto>('/home')).collections.map((item) => item.id)).toEqual(first.items.slice(0, 4).map((item) => item.id))
    const before = await mockResourceHub<CreatorContentSummaryDto>('/studio')
    for (let index = 0; index < 22; index++) await mockCommunity('/posts', 'POST', { type: 'note', title: `合成教程${index}`, contentBlocks: [{ type: 'paragraph', text: '仅用于分页回归的合成教程正文。' }], bindings: [], topicIds: [], visibility: 'public', status: 'published', contribution: { kind: 'article', tags: [] } })
    const studio = await mockResourceHub<CreatorContentSummaryDto>('/studio')
    expect(studio.counts.items).toBe(before.counts.items + 22)
    expect(studio.items).toHaveLength(18)
    const ids = studio.items.map((item) => item.id)
    let cursor = studio.nextCursors.items
    do {
      const page = await mockResourceHub<CreatorContentSummaryDto>('/studio?' + new URLSearchParams({ section: 'items', cursor: cursor! }))
      expect(page.items.length).toBeLessThanOrEqual(18)
      expect(page.counts).toEqual(studio.counts)
      ids.push(...page.items.map((item) => item.id)); cursor = page.nextCursors.items
    } while (cursor)
    expect(ids.length).toBe(studio.counts.items)
    expect(new Set(ids).size).toBe(ids.length)
    await expect(mockResourceHub('/studio?' + new URLSearchParams({ section: 'drafts', cursor: studio.nextCursors.items! }))).rejects.toThrow('游标无效')
    await expect(mockResourceHub('/studio?section=toString')).rejects.toThrow('内容分组')
    const query = { keyword: '合成教程', sort: 'popular' }
    const firstWorks = await mockResourceHub<ResourceHubListDto>('/items?' + new URLSearchParams({ ...query, limit: '3' }))
    const remainingId = ids.find((id) => !firstWorks.items.some((item) => item.id === id) && studio.items.some((item) => item.id === id && item.title.startsWith('合成教程')))!
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 1000)
    await mockCommunity('/signals', 'POST', { eventType: 'community_post_click', targetType: 'post', targetId: remainingId })
    const restWorks = await mockResourceHub<ResourceHubListDto>('/items?' + new URLSearchParams({ ...query, limit: '48', cursor: firstWorks.nextCursor! }))
    expect([...firstWorks.items, ...restWorks.items]).toHaveLength(22)
    expect(restWorks.items.find((item) => item.id === remainingId)?.stats.views).toBe(0)
  })

  it('上传视频和资料后返回可用的演示对象地址，观看进度可续取', async () => {
    const video = await mockResourceHub<VideoAssetDto>('/uploads/video', 'POST', new File(['video'], 'demo.mp4', { type: 'video/mp4' }))
    const document = await mockResourceHub<{ id: string; mimeType: string }>('/uploads/document', 'POST', new File(['notes'], 'notes.txt', { type: 'text/plain' }))
    expect(video).toMatchObject({ status: 'ready', originalMimeType: 'video/mp4' })
    expect(await mockResourceHub<VideoAssetDto>(`/videos/${video.id}`)).toEqual(video)
    expect(document.mimeType).toBe('text/plain')
    await expect(mockResourceHub(`/videos/${video.id}/playback`)).rejects.toThrow('不可见')
    await mockCommunity('/posts', 'POST', { type: 'note', title: '合成视频投稿', contentBlocks: [{ type: 'paragraph', text: '用于验证观看进度的合成教程' }], bindings: [], topicIds: [], visibility: 'public', status: 'published', contribution: { kind: 'video', categoryId: 'ai-foundation', tags: [], videoAssetId: video.id } })
    const playback = await mockResourceHub<VideoPlaybackDto>(`/videos/${video.id}/playback`)
    expect(playback.sources[0]).toMatchObject({ type: 'video/mp4', src: expect.stringMatching(/^blob:/) })
    await mockResourceHub(`/videos/${video.id}/progress`, 'PUT', { positionSeconds: 24, watchedSeconds: 18, completed: false, eventKey: 'mock-watch-1' })
    expect((await mockResourceHub<VideoPlaybackDto>(`/videos/${video.id}/playback`)).progress).toMatchObject({ positionSeconds: 24, watchedSeconds: 18, completed: false })
  })

  it('作者下架资源后从公开结果移除并保留为自己的草稿', async () => {
    const id = 'resource-demo-campus-agent'
    await mockCommunity(`/posts/${id}/unpublish`, 'POST')
    expect((await mockResourceHub<ResourceHubListDto>('/items?kind=all')).items.some((entry) => entry.postId === id)).toBe(false)
    const studio = await mockResourceHub<CreatorContentSummaryDto>('/studio')
    expect(studio.drafts.some((post) => post.id === id)).toBe(true)
    expect(studio.pendingReview).toEqual([])
  })

  it('详情、作者、互动与社区帖子共用同一份数据', async () => {
    const detail = await mockResourceHub<ResourceContributionDetailDto>('/contributions/resource-demo-campus-agent')
    const community = await mockCommunity<typeof detail.post>('/posts/resource-demo-campus-agent', 'GET')
    expect(detail.post).toEqual(community)
    expect(detail.contribution).toEqual(detail.post.contribution)
    expect(detail.stats.views).toBeGreaterThan(0)
    expect(detail.related.every((item) => item.id !== detail.post.id)).toBe(true)
  })

  it('未认证禁止资源上传和社区合集，但保留私人合集与观看进度', async () => {
    values.set('community-demo-user', JSON.stringify({ identityVerificationStatus: 'unsubmitted' }))
    await expect(mockResourceHub('/uploads/video', 'POST', new File(['video'], 'demo.mp4', { type: 'video/mp4' }))).rejects.toMatchObject({ code: 'COMMUNITY_VERIFICATION_REQUIRED' })
    await expect(mockResourceHub('/uploads/document', 'POST', new File(['notes'], 'notes.txt', { type: 'text/plain' }))).rejects.toMatchObject({ code: 'COMMUNITY_VERIFICATION_REQUIRED' })
    await expect(mockResourceHub('/collections', 'POST', { name: '公开清单', description: '', visibility: 'community' })).rejects.toMatchObject({ code: 'COMMUNITY_VERIFICATION_REQUIRED' })
    const privateCollection = await mockResourceHub<LearningCollectionDto>('/collections', 'POST', { name: '私人清单', description: '', visibility: 'private' })
    await expect(mockResourceHub(`/collections/${privateCollection.id}/items`, 'POST', { postId: 'resource-demo-ai-literacy' })).resolves.toMatchObject({ itemCount: 1 })
    await expect(mockResourceHub('/videos/video-resource-demo-ai-literacy/progress', 'PUT', { positionSeconds: 10, watchedSeconds: 8, completed: false })).resolves.toMatchObject({ positionSeconds: 10 })
  })
})
