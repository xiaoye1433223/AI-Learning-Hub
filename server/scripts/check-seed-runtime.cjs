// 只校验最终镜像形态的npm前置生命周期，不执行Seed、数据库查询或应用监听。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const source = path.resolve(__dirname, '..')
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-seed-runtime-'))
try {
  const target = path.join(temporary, 'server')
  fs.mkdirSync(path.join(target, 'scripts'), { recursive: true })
  for (const name of ['package.json', 'prisma', 'dist', 'resources']) fs.cpSync(path.join(source, name), path.join(target, name), { recursive: true })
  for (const name of ['modules/homepage/upgrade-landing.ts', 'modules/persistence/bootstrap.ts']) {
    const dest = path.join(target, 'src', name)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(path.join(source, 'src', name), dest)
  }
  fs.copyFileSync(path.join(source, 'scripts/check-runtime-imports.cjs'), path.join(target, 'scripts/check-runtime-imports.cjs'))
  // 依赖使用同一已安装只读目录；不复制或启动数据库与应用运行环境。
  fs.symlinkSync(path.join(source, 'node_modules'), path.join(target, 'node_modules'), 'dir')
  assert.equal(fs.existsSync(path.join(target, 'src/main.ts')), false)
  const pkg = JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8'))
  for (const hook of ['preprisma:seed', 'preseed:demo']) {
    assert.equal(pkg.scripts[hook], 'npm run check:runtime')
    const output = execFileSync('npm', ['run', hook], { cwd: target, encoding: 'utf8' })
    assert.match(output, /"networkStarted":false/)
  }
  for (const name of ['modules/media/import-catalog.js', 'modules/media/demo-data.js']) assert.equal(fs.existsSync(path.join(target, 'dist', name)), true)
  console.log(JSON.stringify({ check: 'seed-runtime-prehooks', sourceMainPresent: false, hooks: 2, compiledMediaCliPresent: true, actualSeedExecuted: false, databaseConnected: false }))
} finally {
  fs.rmSync(temporary, { recursive: true, force: true })
}
