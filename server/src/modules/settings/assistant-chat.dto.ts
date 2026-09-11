import { Type } from 'class-transformer'
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, Length, ValidateNested } from 'class-validator'

/** 学生端对话的一条历史消息；只允许交替出现的用户/助手文本。 */
export class AssistantChatMessageDto {
  @IsIn(['user', 'assistant']) role: 'user' | 'assistant' = 'user'
  @IsString() @Length(1, 2000) content!: string
}

/** 学生端发起对话：当前问题 + 最近历史（服务端截取最后 10 条）。 */
export class AssistantChatDto {
  @IsString() @Length(1, 2000) message!: string
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => AssistantChatMessageDto) history?: AssistantChatMessageDto[]
}
