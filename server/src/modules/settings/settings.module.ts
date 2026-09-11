import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { SettingsController, SettingsOperationsController } from './settings.controller'
import { SettingsService } from './settings.service'
import { AssistantConfigController, PublicAssistantConfigController } from './assistant-config.controller'
import { AssistantConfigService } from './assistant-config.service'
import { AssistantChatController } from './assistant-chat.controller'
import { AssistantChatService } from './assistant-chat.service'

@Module({
  imports: [AuthModule],
  controllers: [SettingsController, SettingsOperationsController, AssistantConfigController, PublicAssistantConfigController, AssistantChatController],
  providers: [SettingsService, AssistantConfigService, AssistantChatService],
})
export class SettingsModule {}
