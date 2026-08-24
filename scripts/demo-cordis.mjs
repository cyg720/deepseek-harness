/**
 * Boot the self-referential Cordis tools under Web or ACP, defaulting to Web. This is a repository demo wrapper, not a product CLI feature.
 */
/**
 * 文件职责：以 Web 或 ACP 表面启动能检查并修改自身 Cordis 组合的仓库演示。
 * 技术维度：使用 Node.js spawn、Map 模式表和继承 stdio 启动现有 CLI 入口。
 * 产品维度：帮助开发者体验代理通过工具理解和调整自身插件运行时。
 * 逻辑维度：声明两种表面参数，读取可选命令行选择，校验用法，提示 Web 地址并转发子进程退出。
 * 关键边界：仅是仓库演示包装器，不是产品 CLI；Web 固定使用 3081 端口。
 * 新手阅读建议：先比较 SURFACES 的两组 Node 参数，再看 surface 校验和 child 退出码转发。
 */
import { spawn } from 'node:child_process'

// SURFACES：演示表面到 Node 子进程参数的固定映射，只允许 web 或 acp。
const SURFACES = new Map([
  // The browser surface with the cordis toolset layered on: `dsh web --config`
  // applies this overlay over the shipped web composition; it owns port 3081.
  // 浏览器表面在发布 Web 组合上叠加 Cordis 工具配置，并占用 3081 端口。
  ['web', ['--import', 'tsx', 'apps/cli/src/bin.ts', 'web', '--patch', 'examples/web-cordis/cordis.yml']],
  ['acp', ['--import', 'tsx', 'packages/examples/acp-demo/src/bin.ts', '--config', 'examples/acp-agent/cordis-tools.cordis.yml']],
])

// surface：用户选择的演示表面；未提供参数时默认 web。
const surface = process.argv[2] ?? 'web'
// args：所选表面的固定 Node 参数；未知表面时为 undefined。
const args = SURFACES.get(surface)
if (args === undefined || process.argv.length > 3) {
  console.error('usage: pnpm run demo:cordis [web|acp]')
  process.exit(2)
}

if (surface === 'web') console.log('Cordis Web: http://127.0.0.1:3081')
// child：继承当前终端输入输出的演示子进程。
const child = spawn(process.execPath, args, { stdio: 'inherit' })
// 退出监听器：正常退出转发子进程代码，信号终止或空代码统一返回失败 1。
child.on('exit', (code, signal) => { process.exit(signal === null ? code ?? 1 : 1) })
