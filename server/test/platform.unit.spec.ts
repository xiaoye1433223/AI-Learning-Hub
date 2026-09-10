import { describe, expect, it } from 'vitest'
import { QuestionType } from '@prisma/client'
import { QuizBoxMapper } from '../src/integrations/quiz-box/quiz-box.mapper'
import { evaluateAnswer } from '../src/modules/behavior/assessment-evaluator'
import { ContentSupportService } from '../src/common/content/content-support.service'
import { Reflector } from '@nestjs/core'
import type { ExecutionContext } from '@nestjs/common'
import { PermissionsGuard } from '../src/modules/auth/permissions.guard'
import { PERMISSIONS_KEY } from '../src/modules/auth/permissions.decorator'

describe('平台公共契约', () => {
  it('题盒成绩映射只保留统一字段', () => {
    expect(QuizBoxMapper.attempt({ id: 'a1', userId: 'u1', paperId: 'p1', score: 88, submittedAt: '2026-08-29T00:00:00Z', answer: 'secret' })).toEqual({
      externalAttemptId: 'a1',
      userExternalId: 'u1',
      paperExternalId: 'p1',
      score: 88,
      submittedAt: '2026-08-29T00:00:00Z',
    })
  })

  it('结构化内容拒绝脚本协议', () => {
    const service = new ContentSupportService({} as never, {} as never)
    expect(() => service.sanitize({ body: '<script>alert(1)</script>' })).toThrow('内容包含不安全脚本')
    expect(() => service.sanitize({ link: 'javascript:alert(1)' })).toThrow('内容包含不安全脚本')
  })

  it('安全结构化内容保持 JSON 语义', () => {
    const service = new ContentSupportService({} as never, {} as never)
    expect(service.sanitize({ blocks: [{ type: 'paragraph', text: '学习 AI' }] })).toEqual({ blocks: [{ type: 'paragraph', text: '学习 AI' }] })
  })

  it('服务端按题型执行确定性判分，不依赖 JSON 字符串顺序', () => {
    expect(evaluateAnswer(QuestionType.single, 'B', 'B')).toBe(true)
    expect(evaluateAnswer(QuestionType.multiple, ['B', 'A'], ['A', 'B'])).toBe(true)
    expect(evaluateAnswer(QuestionType.multiple, ['A'], ['A', 'B'])).toBe(false)
    expect(evaluateAnswer(QuestionType.true_false, false, false)).toBe(true)
    expect(evaluateAnswer(QuestionType.short_answer, '注意力可以捕捉上下文关联', { keywords: ['注意力', '关联'], mode: 'all' })).toBe(true)
    expect(evaluateAnswer(QuestionType.short_answer, '任意文本', '任意文本')).toBe(false)
    expect(evaluateAnswer(QuestionType.code, { outputs: ['ok', '42'] }, { expectedOutputs: ['ok', 42] })).toBe(true)
    expect(evaluateAnswer(QuestionType.code, 'console.log(42)', { expectedOutputs: ['42'] })).toBe(false)
  })

  it('受限角色必须同时满足领域级权限，不能借用通用内容权限越权', () => {
    const guard = new PermissionsGuard(new Reflector())
    const authorize = (required: string[], permissions: string[]) => {
      const handler = () => undefined
      Reflect.defineMetadata(PERMISSIONS_KEY, required, handler)
      const context = {
        getHandler: () => handler,
        getClass: () => class TestController {},
        switchToHttp: () => ({ getRequest: () => ({ user: { permissions, sessionClient: 'admin', mfaVerified: true } }) }),
      } as unknown as ExecutionContext
      return () => guard.canActivate(context)
    }
    const operator = ['theme.read', 'course.read', 'lab.read', 'resource.read', 'article.read', 'challenge.read']
    expect(authorize(['course.read'], operator)()).toBe(true)
    expect(authorize(['course.write'], operator)).toThrow('缺少所需权限')
    const contentEditor = ['theme.read', 'theme.write', 'theme.publish', 'course.read', 'course.write', 'course.publish']
    expect(authorize(['course.write'], contentEditor)()).toBe(true)
    expect(authorize(['challenge.write'], contentEditor)).toThrow('缺少所需权限')
    const questionEditor = ['challenge.read', 'challenge.write', 'challenge.publish', 'question.read', 'question.write']
    expect(authorize(['challenge.write', 'question.write'], questionEditor)()).toBe(true)
    expect(authorize(['course.read'], questionEditor)).toThrow('缺少所需权限')
    expect(authorize(['course.write'], ['content.read', 'content.write', 'content.publish'])).toThrow('缺少所需权限')
  })
})
