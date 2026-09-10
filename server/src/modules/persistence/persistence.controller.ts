import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common'
import { AuthGuard } from '../auth/auth.guard'
import { PermissionsGuard } from '../auth/permissions.guard'
import { Permissions } from '../auth/permissions.decorator'
import { CurrentUser } from '../auth/current-user.decorator'
import type { AuthUser } from '../auth/auth.types'
import { PersistenceService } from './persistence.service'
import { OperationsService } from './operations.service'
import { UserReasonDto } from '../users/users.dto'
import { IsOptional, IsString, MaxLength } from 'class-validator'
class MaintenanceDto extends UserReasonDto {
  @IsOptional() @IsString() @MaxLength(400) cursor?: string
}
@Controller('admin/persistence')
@UseGuards(AuthGuard, PermissionsGuard)
export class PersistenceController {
  constructor(private readonly persistence: PersistenceService, private readonly operations: OperationsService) {}
  @Get('operations') @Permissions('platform.manage') operationsStatus() { return this.operations.status() }
  @Get() @Permissions('settings.read') status() { return this.persistence.status() }
  @Post(':action') @Permissions('platform.manage')
  maintain(@CurrentUser() user: AuthUser, @Param('action') action: string, @Body() input: MaintenanceDto) { return this.persistence.maintain(user.id, action, input.reason, input.cursor) }
}
