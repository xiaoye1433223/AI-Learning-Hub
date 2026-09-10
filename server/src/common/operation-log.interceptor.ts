import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common'
import { catchError, from, mergeMap, throwError } from 'rxjs'
import { PrismaService } from '../prisma/prisma.service'
import type { AuthRequest } from '../modules/auth/auth.types'

@Injectable()
export class OperationLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger(OperationLogInterceptor.name)
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<AuthRequest & { id?: string }>()
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return next.handle()
    // 只记录路由模板，动态 URL 段可能包含邮箱、恢复凭据或媒体 token。
    const path = typeof request.route?.path === 'string' ? request.route.path : 'matched-route'
    const write = (result: string) => this.prisma.operationLog.create({
      data: {
        actorId: request.user?.id,
        method: request.method,
        path,
        result,
        requestId: request.id,
      },
    }).catch(() => { this.logger.error(JSON.stringify({ event: 'operation_log_write_failed', method: request.method, path, result, requestId: request.id })); return null })
    return next.handle().pipe(
      mergeMap((value) => from(write('success')).pipe(mergeMap(() => [value]))),
      catchError((error: unknown) => from(write('failed')).pipe(mergeMap(() => throwError(() => error)))),
    )
  }
}
