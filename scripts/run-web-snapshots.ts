/** Run serial browser owners before one bounded snapshot pool. */
/*
 * 文件职责：先串行运行会修改共享浏览器状态的 Web 用例，再用受控 worker 池运行其余快照。
 * 技术维度：使用 Node spawn、顶层 await、pnpm 调用解析和严格环境变量校验。
 * 产品维度：提高 Web 快照 CI 吞吐量，同时避免 HMR 与 Cordis 生命周期测试互相干扰。
 * 逻辑维度：解析 worker 数，依次运行 serialFiles；全部成功后排除它们并并行运行剩余文件，否则保留失败码。
 * 关键边界：DSH_WEB_SNAPSHOT_WORKERS 必须是大于 1 的规范整数；子进程信号终止统一视为失败。
 * 新手阅读建议：先看 serialFiles 与 workers 校验，再跟踪两个执行阶段，最后阅读 run 的事件处理。
 */
import { spawn } from 'node:child_process'
import { pnpmInvocation } from './pnpm-invocation.ts'

// 必须独占共享浏览器或工作区状态的测试文件，按声明顺序串行执行。
const serialFiles = [
  'apps/web/tests/hmr-live.e2e.ts',
  'apps/web/tests/cordis-tool-round.e2e.ts',
]
// worker 上限的原始环境字符串；缺失或非规范整数都会被拒绝。
const workerRaw = process.env.DSH_WEB_SNAPSHOT_WORKERS
// 解析后的 worker 数，必须是大于 1 的安全整数。
const workers = Number.parseInt(workerRaw ?? '', 10)
if (!Number.isSafeInteger(workers) || workers < 2 || String(workers) !== workerRaw) {
  throw new Error(`DSH_WEB_SNAPSHOT_WORKERS must be an integer greater than 1, got ${JSON.stringify(workerRaw)}.`)
}
// 运行 Vitest Web 配置的 pnpm 命令与参数，兼容脚本入口和原生可执行入口。
const invocation = pnpmInvocation(['exec', 'vitest', 'run', '--config', 'vitest.web.config.ts'])
// 串行阶段最近一次退出码；0 表示当前仍可继续。
let serialStatus = 0
// 当前需要串行执行的文件路径。
for (const file of serialFiles) {
  serialStatus = await run(invocation.command, [...invocation.args, file])
  if (serialStatus !== 0) break
}
if (serialStatus === 0) {
  process.exitCode = await run(invocation.command, [
    ...invocation.args,
    // file 是已在串行阶段运行的路径，转换为并行阶段排除参数。
    ...serialFiles.map(file => `--exclude=${file}`),
    '--fileParallelism',
    `--maxWorkers=${String(workers)}`,
  ])
} else {
  process.exitCode = serialStatus
}

/** 启动一个测试子进程。@param command 可执行文件。@param args 参数数组。@returns 退出码 Promise。@example await run('pnpm', ['test'])。 */
function run(command: string, args: string[]): Promise<number> {
  // 等待子进程 error 或 exit 事件的 Promise。
  return new Promise((resolveRun, reject) => {
    // 继承当前终端输入输出的子进程。
    const child = spawn(command, args, { stdio: 'inherit' })
    child.once('error', reject)
    // exitCode 是普通退出码，signalCode 是信号终止名称；两者不会同时有效。
    child.once('exit', (exitCode, signalCode) => {
      if (signalCode !== null) {
        console.error(`web snapshots terminated by ${signalCode}`)
        resolveRun(1)
        return
      }
      resolveRun(exitCode ?? 1)
    })
  })
}
