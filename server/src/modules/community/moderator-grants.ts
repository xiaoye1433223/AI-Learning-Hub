import type { FrontendModeratorGrant } from '@prisma/client'
import type { ModeratorAction, ModeratorGrantDto } from '@ai-learning-hub/contracts'

export function moderatorActions(grant: Pick<FrontendModeratorGrant, 'canDelete' | 'canMute' | 'canBan'>): ModeratorAction[] {
  return [...(grant.canDelete ? ['takedown' as const] : []), ...(grant.canMute ? ['mute' as const] : []), ...(grant.canBan ? ['ban' as const] : [])]
}
export function moderatorGrantDto(grant: FrontendModeratorGrant): ModeratorGrantDto {
  return { scope: grant.scope, actions: moderatorActions(grant), enabled: grant.enabled, revision: grant.revision, grantedById: grant.grantedById, updatedAt: grant.updatedAt.toISOString() }
}
