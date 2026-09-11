import { Type } from 'class-transformer'
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Min } from 'class-validator'

/** 助手悬浮入口的允许位置：左侧 / 右侧。 */
export const ASSISTANT_ENTRY_POSITIONS = ['left', 'right'] as const

/** 管理端保存小雪助手展示配置；名称、欢迎语、启用状态与位置存入 SystemSetting。模型接入信息来自服务端受限配置，不接受前端传入。 */
export class SaveAssistantConfigDto {
  @IsBoolean() enabled = true
  @IsString() @Length(1, 20) name!: string
  @IsString() @Length(1, 200) welcome!: string
  @IsOptional() @IsString() @Length(0, 100) description = ''
  @IsIn([...ASSISTANT_ENTRY_POSITIONS]) entryPosition: (typeof ASSISTANT_ENTRY_POSITIONS)[number] = 'right'
  @IsOptional() @IsString() @Length(0, 600) avatarUrl = ''
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) expectedRevision?: number
}
