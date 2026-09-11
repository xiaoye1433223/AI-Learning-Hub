import { BadRequestException, ConflictException, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import type { SaveAssistantConfigDto } from './assistant-config.dto'

const CONFIG_KEY = 'xiaoxue_assistant'

/** 未配置时的默认展示内容；保存后整体覆盖，避免旧字段残留。 */
const DEFAULT_CONFIG = {
  enabled: true,
  name: '小雪助手',
  welcome: '你好！我是小雪助手 🙋\n我可以帮你解答问题、推荐学习资源、总结帖子内容，一起探索 AI 的无限可能！',
  description: '你的 AI 学习伙伴，随时为你解答问题、推荐内容，让学习更高效、更有趣！',
  entryPosition: 'right',
  avatarUrl: '',
}

type ConfigValue = typeof DEFAULT_CONFIG

/** 模型接入信息只从服务端受限配置（环境变量）读取，不写入数据库、不下发到浏览器。 */
export interface AssistantModelAccess {
  provider: string
  baseUrl: string
  model: string
  apiKey: string
}

@Injectable()
export class AssistantConfigService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  private merge(rowValue: unknown): ConfigValue {
    const raw = (rowValue && typeof rowValue === 'object' ? rowValue : {}) as Partial<ConfigValue>
    const value = { ...DEFAULT_CONFIG, ...raw }
    value.entryPosition = value.entryPosition === 'left' ? 'left' : 'right'
    return value
  }

  private modelAccess(): AssistantModelAccess {
    return {
      provider: this.config.get<string>('ASSISTANT_MODEL_PROVIDER') || 'openai',
      baseUrl: this.config.get<string>('ASSISTANT_MODEL_BASE_URL') || 'https://api.deepseek.com',
      model: this.config.get<string>('ASSISTANT_MODEL_NAME') || 'DeepSeek-V4.1-Flash',
      apiKey: this.config.get<string>('ASSISTANT_MODEL_API_KEY') || '',
    }
  }

  /** 管理端与前端只看得到模型是否已配置，永远拿不到密钥本身。 */
  private modelStatus() {
    const { provider, baseUrl, model, apiKey } = this.modelAccess()
    return { provider, baseUrl, model, configured: !!apiKey.trim() }
  }

  private assertAvatarUrl(url: string) {
    if (!url || /^https?:\/\/\S+$/.test(url) || /^\/api\/v1\/public\/media\/[\w-]+$/.test(url)) return
    throw new BadRequestException('头像地址不合法；请留空、使用素材库上传返回的地址或 http(s) 图片链接')
  }

  /** 管理端读取：展示配置 + 版本号 + 模型配置状态（只读）。 */
  async get() {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: CONFIG_KEY } })
    return { ...this.merge(row?.value), revision: row?.revision || 0, model: this.modelStatus() }
  }

  /** 供对话代理使用：返回展示配置与模型接入信息（含完整密钥，绝不进日志或前端）。 */
  async resolveModelAccess() {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: CONFIG_KEY } })
    const value = this.merge(row?.value)
    return { enabled: value.enabled, name: value.name, description: value.description, model: this.modelAccess() }
  }

  /** 前台公开读取：只暴露展示字段；关闭时仅返回 enabled=false，学生端据此隐藏入口。 */
  async publicConfig() {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: CONFIG_KEY } })
    const value = this.merge(row?.value)
    if (!value.enabled) return { enabled: false }
    return { enabled: true, name: value.name, welcome: value.welcome, description: value.description, entryPosition: value.entryPosition, avatarUrl: value.avatarUrl }
  }

  async save(input: SaveAssistantConfigDto) {
    this.assertAvatarUrl(input.avatarUrl || '')
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('xiaoxue-assistant',0))::text`
      const current = await tx.systemSetting.findUnique({ where: { key: CONFIG_KEY } })
      if (current && input.expectedRevision && current.revision !== input.expectedRevision) throw new ConflictException('小雪助手配置已被他人修改，请刷新后重试')
      const value: ConfigValue = {
        enabled: input.enabled, name: input.name, welcome: input.welcome, description: input.description,
        entryPosition: input.entryPosition, avatarUrl: input.avatarUrl || '',
      }
      const updated = await tx.systemSetting.upsert({
        where: { key: CONFIG_KEY },
        create: { key: CONFIG_KEY, value: value as Prisma.InputJsonValue, sensitive: false },
        update: { value: value as Prisma.InputJsonValue, revision: { increment: 1 } },
      })
      return { ...this.merge(updated.value), revision: updated.revision, model: this.modelStatus() }
    })
  }
}
