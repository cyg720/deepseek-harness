/**
 * Keyless runtime smoke for the source-mode workflow worker. The Node
 * compatibility matrix runs this WHOLE file, so renaming or removing its test
 * cannot turn the runtime proof into a successful zero-match filter.
 */
/*
 * 中文说明：
 * - 文件职责：验证源码模式下的工作流 Worker 能在真实工作线程中编译并执行默认配置。
 * - 技术维度：使用 Vitest、Cordis 插件上下文、Worker Thread 引擎和异步资源释放。
 * - 产品维度：保障开发者从源码启动 dsh 时，工作流脚本无需预构建也能正常运行。
 * - 逻辑维度：装载子代理服务、注册禁止启动子代理的提供者、执行算式脚本并按层释放资源。
 * - 关键边界：这是无密钥冒烟测试，只证明默认源码入口可运行，不覆盖子代理实际启动。
 * - 新手阅读建议：先看 provider 的保护性 start，再看 workflowEngine.start 的输入、结果与两层 finally。
 */

import { expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type { SubagentProvider } from '@deepseek-ai/dsh-subagent'
import WorkerThreadWorkflowEngine from '../src/index.ts'
import { SessionId } from '@deepseek-ai/dsh-session'

// A fresh thread compiles the source runtime. Leave contention headroom on
// shared CI runners without weakening any engine-level timeout assertion.
// 中文：新线程首次运行会编译源码，因此给共享 CI 机器 30 秒余量；这不会放宽引擎自身的超时规则。
vi.setConfig({ testTimeout: 30_000 })

/** 中文：执行源码 Worker 默认配置并断言得到 42；无参数和返回值，所有插件句柄都在 finally 中释放。 */
it('runs the default config through the source worker', async () => {
  /** 本测试独占的 Cordis 上下文，负责持有下方装载的服务。 */
  const ctx = new Context()
  /** 子代理运行时插件句柄；结尾显式释放以防工作线程测试残留资源。 */
  const subagents = await ctx.plugin(SubagentRuntime)
  /** 只提供能力声明的保护性提供者；若脚本意外启动子代理，start 会立刻令测试失败。 */
  const provider: SubagentProvider = {
    name: 'spawn',
    capabilities: { outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
    inheritsParentContext: false,
    start: () => Promise.reject(new Error('source-worker compat script must not start a child')),
  }
  ctx.subagents.registerProvider(provider)
  /** 使用空配置装载的 Worker Thread 工作流引擎句柄。 */
  const engine = await ctx.plugin(WorkerThreadWorkflowEngine, {})
  /** 传给工作流的最小父代理对象；该冒烟路径只读取标识和选项。 */
  const parent = { id: SessionId('workflow-compat-parent'), options: {} } as unknown as Agent
  try {
    /** 正在运行的工作流句柄；result 提供最终结果，dispose 关闭其工作线程资源。 */
    const run = ctx.workflowEngine.start({
      script: 'return 6 * 7',
      meta: { name: 'source-worker-compat', description: 'exercise the unbuilt worker entry' },
      parent,
    })
    try {
      await expect(run.result).resolves.toMatchObject({ value: 42, stopReason: 'completed', agentsStarted: 0 })
    } finally {
      await run.dispose()
    }
  } finally {
    await engine.dispose()
    await subagents.dispose()
  }
})
