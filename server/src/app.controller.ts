import { Controller, Get, ServiceUnavailableException } from '@nestjs/common'
import { OperationsService } from './modules/persistence/operations.service'

@Controller()
export class AppController {
  constructor(private readonly operations: OperationsService) {}

  @Get('health/live')
  live() { return { status: 'alive' } }

  @Get(['health', 'health/ready'])
  async health() {
    if (!await this.operations.readiness()) throw new ServiceUnavailableException('服务尚未就绪')
    return { status: 'ready' }
  }

  @Get('version')
  version() {
    return { commit: process.env.APP_COMMIT_SHA || 'development', environment: process.env.NODE_ENV || 'development' }
  }
}
