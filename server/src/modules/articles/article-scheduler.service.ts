import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common'
import { ArticleService } from './article.service'

@Injectable()
export class ArticleSchedulerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ArticleSchedulerService.name)
  private timer?: NodeJS.Timeout

  constructor(private readonly articles: ArticleService) {}

  onApplicationBootstrap() {
    void this.publishDue()
    this.timer = setInterval(() => void this.publishDue(), 60_000)
    this.timer.unref()
  }

  onApplicationShutdown() {
    clearInterval(this.timer)
  }

  private async publishDue() {
    try {
      await this.articles.publishScheduled()
    } catch {
      this.logger.error('定时发布检查失败，请按任务时间核对数据库和发布条件')
    }
  }
}
