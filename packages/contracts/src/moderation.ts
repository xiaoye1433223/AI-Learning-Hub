export const moderatorScopes = ['community', 'tutorials'] as const
export type ModeratorScope = typeof moderatorScopes[number]
export const moderatorActionLabels = { takedown: '删除这条内容', mute: '禁言作者', ban: '封禁账号' } as const
export type ModeratorAction = keyof typeof moderatorActionLabels
export interface ModeratorCapability { scope: ModeratorScope; actions: ModeratorAction[] }
export interface ModeratorGrantDto extends ModeratorCapability {
  enabled: boolean; revision: number; grantedById: string; updatedAt: string
}
export interface ModeratorGrantInput {
  expectedRevision: number; scopes: ModeratorScope[]; enabled: boolean
  canDelete: boolean; canMute: boolean; canBan: boolean; reason: string
}
export interface ModeratorTargetDto {
  type: 'post' | 'resource' | 'comment'; id: string; title: string; revision: number
  author: { id: string; displayName: string }; scope: ModeratorScope; actions: ModeratorAction[]
}
export interface ModeratorDecisionInput {
  expectedRevision: number; action: ModeratorAction; reason: string; expiresAt?: string
}
