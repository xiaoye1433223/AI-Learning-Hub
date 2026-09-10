import 'reflect-metadata'
import { describe, expect, it, vi } from 'vitest'
import { ConfigService } from '@nestjs/config'
import { Reflector } from '@nestjs/core'
import { AppController } from '../src/app.controller'
import { OperationsService } from '../src/modules/persistence/operations.service'
import { PersistenceController } from '../src/modules/persistence/persistence.controller'
import { PermissionsGuard } from '../src/modules/auth/permissions.guard'
import { cleanExpiredCredentials } from '../src/modules/persistence/maintenance'
import { httpMetrics, recordHttpStatus } from '../src/common/http-metrics'
import { RegistrationService } from '../src/modules/auth/registration.service'
import { createTransport } from 'nodemailer'
vi.mock('nodemailer', () => ({ createTransport: vi.fn() }))

describe('长期运行边界', () => {
  it('进程存活不依赖数据库，就绪失败返回503且不公开详情', async () => {
    const operations = { readiness: vi.fn().mockResolvedValue(false) }
    const app = new AppController(operations as never)
    expect(app.live()).toEqual({ status: 'alive' })
    await expect(app.health()).rejects.toMatchObject({ status: 503 })
    operations.readiness.mockResolvedValue(true)
    expect(await app.health()).toEqual({ status: 'ready' })
  })
  it('学生与普通编辑不能读取运维详情', () => {
    const guard = new PermissionsGuard(new Reflector())
    const context = (permissions: string[]) => ({ getHandler: () => PersistenceController.prototype.operationsStatus, getClass: () => PersistenceController, switchToHttp: () => ({ getRequest: () => ({ user: { permissions, sessionClient: 'admin', mfaVerified: true } }) }) })
    expect(() => guard.canActivate(context([]) as never)).toThrow()
    expect(() => guard.canActivate(context(['settings.read']) as never)).toThrow()
    expect(guard.canActivate(context(['platform.manage']) as never)).toBe(true)
  })
  it('HTTP只保留近5分钟计数，旧错误不会永久触发告警', () => {
    recordHttpStatus(500, 60_000)
    recordHttpStatus(200, 600_000)
    expect(httpMetrics(600_000)).toEqual({ requests: 1, errors5xx: 0, windowSeconds: 300 })
    recordHttpStatus(503, 600_000)
    expect(httpMetrics(600_000).errors5xx).toBe(1)
  })
  it('定时清理只触及过期凭证，每表限制批量并防止并发重复执行', async () => {
    const tx = { $queryRaw: vi.fn().mockResolvedValue([{ locked: true }]), $executeRaw: vi.fn().mockResolvedValue(2) }
    const prisma = { $transaction: (work: (value: typeof tx) => unknown) => work(tx) }
    const result = await cleanExpiredCredentials(prisma as never)
    expect(Object.keys(result.deleted)).toEqual(['password_reset_tokens', 'email_verification_tokens', 'refresh_tokens', 'request_idempotency', 'registration_throttles', 'login_throttles'])
    for (const [sql] of tx.$executeRaw.mock.calls) expect(sql.sql).toMatch(/expires_at < NOW\(\).*LIMIT 1000 FOR UPDATE SKIP LOCKED/)
    tx.$queryRaw.mockResolvedValue([{ locked: false }])
    tx.$executeRaw.mockClear()
    expect((await cleanExpiredCredentials(prisma as never)).skipped).toBe(true)
    expect(tx.$executeRaw).not.toHaveBeenCalled()
  })
  it('数据库失败转换为不可就绪，不抛出连接字符串', async () => {
    const service = new OperationsService({ $transaction: vi.fn().mockRejectedValue(new Error('private connection')) } as never, new ConfigService(), {} as never, {} as never)
    expect(await service.databaseReady()).toBe(false)
  })
  it('真实邮件发送入口持久记录成功或失败，不记录收件人和令牌', async () => {
    const mail = { sendMail: vi.fn().mockRejectedValue(new Error('smtp unavailable')), close: vi.fn() }
    vi.mocked(createTransport).mockReturnValue(mail as never)
    const prisma = { operationLog: { create: vi.fn().mockResolvedValue({}) } }
    const service = new RegistrationService(prisma as never, new ConfigService({ SMTP_HOST: 'mail.invalid', SMTP_FROM: 'no-reply@example.invalid', FRONTEND_URL: 'https://campus.invalid' }), {} as never, {} as never)
    const send = (service as unknown as { send(email: string, token: string, verify: boolean): Promise<void> }).send.bind(service)
    await expect(send('test@example.invalid', 'synthetic-token', true)).rejects.toThrow('邮件通道暂不可用')
    expect(prisma.operationLog.create).toHaveBeenLastCalledWith({ data: { method: 'MAIL', path: '/internal/mail/delivery', result: 'failed' } })
    mail.sendMail.mockResolvedValue({} as never)
    await send('test@example.invalid', 'synthetic-token', true)
    expect(prisma.operationLog.create).toHaveBeenLastCalledWith({ data: { method: 'MAIL', path: '/internal/mail/delivery', result: 'success' } })
    expect(JSON.stringify(prisma.operationLog.create.mock.calls)).not.toMatch(/synthetic-token|test@example/)
    expect(mail.close).toHaveBeenCalledTimes(2)
  })
})
