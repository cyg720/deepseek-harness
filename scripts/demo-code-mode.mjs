/** Boot the ACP Code Mode overlay. Requires a DeepSeek API key. */
/**
 * 文件职责：启动使用 Code Mode 覆盖配置的 ACP 演示子进程。
 * 技术维度：通过 Node child_process.spawn 运行 tsx 源码入口并继承终端流。
 * 产品维度：开发者可用真实 DeepSeek 密钥体验模型自修改运行时的代码模式。
 * 逻辑维度：拒绝额外参数，生成演示进程，再把信号或退出码映射到父进程。
 * 关键边界：需要 DEEPSEEK_API_KEY；子进程收到信号时父进程以失败码 1 退出。
 * 新手阅读建议：先看参数校验，再按可执行文件、加载器、入口和配置理解 argv。
 */
import { spawn } from 'node:child_process'

if (process.argv.length > 2) {
  console.error('usage: pnpm run demo:code-mode')
  process.exit(2)
}

/** ACP Code Mode 演示子进程；stdio 继承当前终端，不捕获或改写模型输出。 */
const child = spawn(process.execPath, [
  '--import',
  'tsx',
  'packages/examples/acp-demo/src/bin.ts',
  '--config',
  'examples/acp-agent/code-mode.cordis.yml',
], { stdio: 'inherit' })
/**
 * 转发子进程结束结果。
 * @param code 正常退出码，若由信号结束则可能为 null。
 * @param signal 终止信号；非 null 时统一映射为父进程失败码 1。
 * @returns 不返回，回调调用 process.exit 结束父进程。
 */
child.on('exit', (code, signal) => { process.exit(signal !== null ? 1 : code ?? 1) })
