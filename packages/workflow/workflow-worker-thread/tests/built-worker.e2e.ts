/**
 * 文件职责：验证 built-worker.e2e.ts 覆盖的工作流与 Worker Thread行为与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、Worker Thread、消息协议或领域实体。
 * 产品维度：保障 Agent 的工作流与 Worker Thread能力稳定、可隔离且可诊断。
 * 逻辑维度：准备配置和消息，建立运行环境，执行流程，再处理事件、错误与清理。
 * 关键边界：线程消息不可信；跨线程状态必须显式传递；终止时必须等待所拥有资源停止。
 * 新手阅读建议：先看协议和类型，再读 Host/Runtime 主流程，最后关注隔离、失败与清理。
 */
import { existsSync } from 'node:fs'
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/** 中文说明：变量 packageRoot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const packageRoot = fileURLToPath(new URL('..', import.meta.url))
/** 中文说明：变量 builtIndex 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const builtIndex = join(packageRoot, 'lib', 'index.js')
/** 中文说明：变量 builtWorker 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const builtWorker = join(packageRoot, 'lib', 'worker.cjs')
/** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const run = promisify(execFile)

/**
 * Keyless built-artifact guard: plain Node loads `lib/index.js` and its sibling
 * `lib/worker.cjs` without tsx. Skips until the build produces both bundles.
 */
describe.skipIf(!existsSync(builtIndex) || !existsSync(builtWorker))('built worker entry (lib/worker.cjs)', () => {
  it('the built engine spawns its built worker under plain node and completes a run', async () => {
    // Keep the driver in-package so bare imports resolve its node_modules.
    /** 中文说明：变量 driver 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const driver = join(packageRoot, `.built-worker-driver-${process.pid}.mjs`)
    try {
      await writeFile(driver, `
import { Context } from '@deepseek-ai/cordis'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import WorkerThreadWorkflowEngine from '@deepseek-ai/dsh-workflow-worker-thread'

const ctx = new Context()
await ctx.plugin(SubagentRuntime)
let selectedStarts = 0
ctx.subagents.registerProvider({
  name: 'built-selected',
  capabilities: { outputSchema: true, depthLimit: false, toolFilter: false, persona: false },
  inheritsParentContext: false,
  async start() {
    selectedStarts += 1
    return {
      id: 'built-child',
      result: Promise.resolve({ output: [], structured: { answer: 42 }, stopReason: 'completed' }),
      dispose: () => Promise.resolve(),
    }
  },
})
await ctx.plugin(WorkerThreadWorkflowEngine, { provider: 'must-not-be-used' })
const run = ctx.workflowEngine.start({
  script: "const value = await agent('answer', { schema: { type: 'object', properties: { answer: { type: 'number' } }, required: ['answer'] } }); return value.answer",
  meta: { name: 'built-smoke', description: 'built worker smoke' },
  subagentProvider: 'built-selected',
  parent: { id: 'built-smoke-parent', options: {} },
})
const result = await run.result
await run.dispose()
if (result.stopReason !== 'completed' || result.value !== 42 || selectedStarts !== 1) {
  console.error('unexpected result: ' + JSON.stringify(result))
  process.exit(1)
}
console.log('built-worker-smoke-ok')
`, 'utf8')
      const { stdout } = await run(process.execPath, [driver], { cwd: packageRoot, timeout: 60_000 })
      expect(stdout).toContain('built-worker-smoke-ok')
    } finally {
      await rm(driver, { force: true })
    }
  }, 120_000)
})
