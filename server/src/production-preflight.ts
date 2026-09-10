import { ConfigService } from '@nestjs/config'
import { validateDeployment } from './common/deployment-security'

try {
  validateDeployment(new ConfigService(process.env))
  process.stdout.write('部署配置预检通过；DNS、证书、代理和浏览器仍须执行外部验收。\n')
} catch (error) {
  process.stderr.write((error instanceof Error ? error.message : '部署配置预检失败') + '\n')
  process.exitCode = 1
}
