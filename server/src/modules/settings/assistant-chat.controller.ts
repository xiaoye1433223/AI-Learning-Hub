import { Body, Controller, Post, UseGuards } from '@nestjs/common'
import { AuthGuard } from '../auth/auth.guard'
import { AssistantChatService } from './assistant-chat.service'
import { AssistantChatDto } from './assistant-chat.dto'

/** 学生端小雪助手对话：需登录；模型调用在服务端完成，前端不接触密钥。 */
@Controller('assistant')
@UseGuards(AuthGuard)
export class AssistantChatController {
  constructor(private readonly chat: AssistantChatService) {}
  @Post('chat') send(@Body() input: AssistantChatDto) { return this.chat.chat(input) }
}
