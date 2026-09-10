import type { CommunityAuthorDto, CommunityPostDetailDto, CommunityPostSummaryDto } from './community'
import type { FileScanDto } from './media-runtime'

export type ResourceContributionKind = 'video' | 'article' | 'document'
export type VideoProcessingStatus = 'uploaded' | 'processing' | 'ready' | 'failed'
export type LearningCollectionVisibility = 'private' | 'community'

export interface ResourceHubCategoryDto {
  id: string
  code: string
  name: string
  description: string
  icon: string
  sortOrder: number
}

export interface VideoAssetDto {
  id: string
  status: VideoProcessingStatus
  originalName: string
  originalMimeType: string
  durationSeconds: number | null
  width: number | null
  height: number | null
  rotation: number
  attempts: number
  lastError: string | null
  posterUrl: string | null
  createdAt: string
  updatedAt: string
  securityScan?: FileScanDto
}

export interface ResourceContributionInput {
  kind: ResourceContributionKind
  categoryId?: string
  tags: string[]
  teachingReuseConsent: boolean
  sourceName?: string
  sourceUrl?: string
  videoAssetId?: string
  attachmentFileId?: string
  coverFileId?: string
}

export interface ResourceContributionDto extends ResourceContributionInput {
  postId: string
  category: ResourceHubCategoryDto | null
  video: VideoAssetDto | null
  attachment: null | { id: string; name: string; size: number; mimeType: string; downloadUrl?: string; securityScan?: FileScanDto }
  coverUrl: string | null
  featured: boolean
  liveReplay: boolean
  revision: number
}

export interface ResourceHubItemDto {
  rankingViews?: number
  sourceType: 'contribution' | 'legacy_resource'
  id: string
  postId: string | null
  title: string
  summary: string
  kind: ResourceContributionKind
  category: ResourceHubCategoryDto | null
  tags: string[]
  coverUrl: string | null
  author: CommunityAuthorDto | null
  stats: { views: number; plays?: number | null; impressions?: number | null; likes: number; comments: number; bookmarks: number; downloads: number }
  durationSeconds: number | null
  videoAssetId: string | null
  mediaStatus: VideoProcessingStatus | null
  publishedAt: string
  route: string
  featured: boolean
  liveReplay: boolean
}

export interface ResourceHubSectionDto {
  key: string
  title: string
  categoryCode: string | null
  items: ResourceHubItemDto[]
}

export interface LearningCollectionSummaryDto {
  contentStatus?: 'published' | 'pending_review'
  detection?: import('./content-detection').ContentDetectionResult
  id: string
  name: string
  description: string
  visibility: LearningCollectionVisibility
  systemKind: 'watch_later' | null
  learningGoal: string
  itemCount: number
  videoCount: number
  durationSeconds: number
  owner: CommunityAuthorDto
  isOwner: boolean
  revision: number
  updatedAt: string
}

export interface LearningCollectionItemDto {
  id: string
  sortOrder: number
  contribution: ResourceHubItemDto
}

export interface LearningCollectionDto extends LearningCollectionSummaryDto {
  items: LearningCollectionItemDto[]
  nextCursor: string | null
  previousCursor: string | null
}

export interface CollectionPageQuery { cursor?: string; direction?: 'before' | 'after' }
export type CreatorContentSection = 'items' | 'drafts' | 'pendingReview' | 'processing'

export interface LearningCollectionInput {
  name: string
  description: string
  visibility: LearningCollectionVisibility
  learningGoal?: string
  expectedRevision?: number
}

export interface ResourceHubHomeDto {
  banners: ResourceHubItemDto[]
  categories: ResourceHubCategoryDto[]
  featured: ResourceHubItemDto[]
  sections: ResourceHubSectionDto[]
  rankings: {
    week: ResourceHubItemDto[]
    month: ResourceHubItemDto[]
    all: ResourceHubItemDto[]
  }
  collections: LearningCollectionSummaryDto[]
  likedVideos: ResourceHubItemDto[]
  liveReplay: ResourceHubItemDto[]
}

export interface ResourceHubListDto {
  items: ResourceHubItemDto[]
  nextCursor: string | null
}
export interface ResourceHubCreatorDto extends ResourceHubListDto {
  collections: LearningCollectionSummaryDto[]
  collectionsNextCursor: string | null
}
export interface ResourceHubAdminItemDto extends ResourceHubItemDto {
  status: string; visibility: string; reportCount: number; deletedAt: string | null
}
export interface ResourceHubAdminListDto { items: ResourceHubAdminItemDto[]; nextCursor: string | null }
export interface ResourceHubPageDto<T> { items: T[]; nextCursor: string | null }
export interface ResourceProcessingFailureDto {
  id: string; originalName: string; attempts: number; lastError: string | null; updatedAt: string
  uploader: { id: string; displayName: string }
  contribution: { postId: string; post: { title: string | null } } | null
}
export interface ResourceReportSummaryDto {
  id: string; postId: string | null; reason: string; description: string; status: string; createdAt: string; handledAt: string | null
}
export interface ResourceAdminCollectionDto {
  id: string; name: string; description: string; learningGoal: string; revision: number; contentStatus: string; updatedAt: string
  owner: { id: string; username: string; displayName: string }
  _count: { items: number; courseLinks: number }
  courseLinks: Array<{ courseId: string; courseVersionId: string; sourceRevision: number; createdAt: string }>
}

export interface ResourceContributionDetailDto {
  post: CommunityPostDetailDto
  contribution: ResourceContributionDto
  stats: ResourceHubItemDto['stats']
  collection: LearningCollectionDto | null
  related: ResourceHubItemDto[]
}

export interface VideoPlaybackDto {
  assetId: string
  sources: Array<{ src: string; type: string }>
  poster: string | null
  durationSeconds: number
  expiresAt: string
  captions: Array<{ src: string; srclang: string; label: string; default?: boolean }>
  chapters: Array<{ title: string; startSeconds: number }>
  progress: { positionSeconds: number; watchedSeconds: number; completed: boolean } | null
}

export interface WatchProgressInput {
  positionSeconds: number
  watchedSeconds: number
  completed: boolean
  eventKey: string
}

export interface CreatorContentSummaryDto {
  counts: Record<CreatorContentSection, number>
  nextCursors: Record<CreatorContentSection, string | null>
  items: ResourceHubItemDto[]
  drafts: CommunityPostSummaryDto[]
  pendingReview: CommunityPostSummaryDto[]
  processing: ResourceHubItemDto[]
}

export interface ResourceHubAdminConfigDto {
  revision: number
  bannerPostIds: string[]
  sectionCategoryCodes: string[]
}
