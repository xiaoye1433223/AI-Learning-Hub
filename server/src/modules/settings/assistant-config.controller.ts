import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common'
import { AuthGuard } from '../auth/auth.guard'
import { PermissionsGuard } from '../auth/permissions.guard'
import { Permissions } from '../auth/permissions.decorator'
import { AssistantConfigService } from './assistant-config.service'
import { AssistantChatService } from './assistant-chat.service'
import { SaveAssistantConfigDto } from './assistant-config.dto'

/** 管理端「小雪助手设置」：读取走 settings.read，保存与测试连接走 settings.write（均为既有权限码）。 */
@Controller('admin/assistant-config')
@UseGuards(AuthGuard, PermissionsGuard)
export class AssistantConfigController {
  constructor(private readonly assistant: AssistantConfigService, private readonly chat: AssistantChatService) {}
  @Get() @Permissions('settings.read') get() { return this.assistant.get() }
  @Put() @Permissions('settings.write') save(@Body() input: SaveAssistantConfigDto) { return this.assistant.save(input) }
  @Post('test') @Permissions('settings.write') test() { return this.chat.testConnection() }
}

/** 前台公开读取展示配置（匿名可访问；只含展示字段，绝不含模型密钥）。 */
@Controller('public')
export class PublicAssistantConfigController {
  constructor(private readonly assistant: AssistantConfigService) {}
  @Get('assistant-config') show() { return this.assistant.publicConfig() }
}
