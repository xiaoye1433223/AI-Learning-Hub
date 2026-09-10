import { UnauthorizedException } from '@nestjs/common'
import { ACCOUNT_BANNED, SESSION_REPLACED, SESSION_REPLACED_MESSAGE } from '@ai-learning-hub/contracts'
import type { Prisma } from '@prisma/client'
import { activeSanction } from '../community/governance-policy'

export async function assertNotBanned(tx: Pick<Prisma.TransactionClient, 'communityModerationAction'>, userId: string) {
  const action = await tx.communityModerationAction.findFirst({ where: { ...activeSanction('ban'), subjectId: userId }, orderBy: { createdAt: 'desc' }, select: { reason: true, expiresAt: true } })
  if (action) throw new UnauthorizedException({ errorCode: ACCOUNT_BANNED, message: `账号已被封禁：${action.reason}。请通过账号恢复与申诉入口查看处理决定。`, availableAt: action.expiresAt?.toISOString() || null, nextAction: { label: '查看处理与申诉', route: '/account-recovery' } })
}

export function assertNotReplaced(session: { revokedAt: Date | null; revocationReason: string | null } | null) {
  if (session?.revokedAt && session.revocationReason === 'replaced_by_login') {
    throw new UnauthorizedException({ errorCode: SESSION_REPLACED, message: SESSION_REPLACED_MESSAGE })
  }
}
