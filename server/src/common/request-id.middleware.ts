import { Injectable, NestMiddleware } from '@nestjs/common'
import type { NextFunction, Request, Response } from 'express'
import { randomUUID } from 'node:crypto'
import { recordHttpStatus } from './http-metrics'

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(request: Request & { id?: string }, response: Response, next: NextFunction) {
    const supplied = String(request.headers['x-request-id'] || '')
    const requestId = /^[a-f0-9]{32}$/i.test(supplied) ? supplied : randomUUID()
    request.id = requestId
    response.locals.requestId = requestId
    response.setHeader('x-request-id', requestId)
    response.once('finish', () => { if (!request.path.startsWith('/api/v1/health')) recordHttpStatus(response.statusCode) })
    next()
  }
}
