import { describe, expect, it } from 'vitest'
import type { AuthUser } from '@ai-learning-hub/contracts'
import { moderatorActionsFor } from '../src/community/moderation'

const moderator = { id: 'moderator', permissions: [], communityWriteEnabled: true, moderatorCapabilities: [{ scope: 'community', actions: ['takedown', 'mute'] }] } as AuthUser
describe('前台菜单能力摘要', () => {
  it('普通用户和游客不显示管理动作', () => {
    expect(moderatorActionsFor(null, 'community', 'author')).toEqual([])
    expect(moderatorActionsFor({ ...moderator, moderatorCapabilities: [] }, 'community', 'author')).toEqual([])
  })
  it('按板块与动作显示，封禁没有默认授权', () => {
    expect(moderatorActionsFor(moderator, 'community', 'author')).toEqual(['takedown', 'mute'])
    expect(moderatorActionsFor(moderator, 'tutorials', 'author')).toEqual([])
  })
  it('授权不绕过认证、自己和后台身份隔离', () => {
    expect(moderatorActionsFor(moderator, 'community', moderator.id)).toEqual([])
    expect(moderatorActionsFor({ ...moderator, communityWriteEnabled: false }, 'community', 'author')).toEqual([])
    expect(moderatorActionsFor({ ...moderator, permissions: ['community.moderate'] }, 'community', 'author')).toEqual([])
  })
  it('双板块仍使用各自的动作白名单', () => {
    const dual: AuthUser = { ...moderator, moderatorCapabilities: [...moderator.moderatorCapabilities!, { scope: 'tutorials', actions: ['takedown', 'ban'] }] }
    expect(moderatorActionsFor(dual, 'tutorials', 'author')).toEqual(['takedown', 'ban'])
    expect(moderatorActionsFor(dual, 'community', 'author')).toEqual(['takedown', 'mute'])
  })
})
