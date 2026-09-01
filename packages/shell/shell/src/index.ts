/**
 * Service Definition for the `ctx.shell` capability seam, covering foreground commands and background process
 * handles. Job ids, ownership, polling, and notices belong to
 * `@deepseek-ai/dsh-jobs`, keeping executors independent of sessions.
 * @module @deepseek-ai/dsh-shell
 */

/*
 * ================================ 文件注释 ================================
 * 【文件职责】dsh-shell 包入口：声明 ctx.shell 能力缝（capability seam）的抽象 Service 与
 * 设置命名空间，并统一再导出全部请求/结果类型与渲染辅助函数，是消费者唯一的导入根。
 * 【技术维度】Cordis 插件 + Service 模式：通过模块增强（declare module）把 shell 服务挂到
 * Context 上；抽象基类 ShellExecutor 定义统一契约（resolve / run / start），由各执行器子类
 * （bash-local、bash-sandbox、pwsh-local、pwsh-sandbox）实现并注册。
 * 【产品维度】"bash 能力缝合"的总闸门：宿主组合加载一个执行器后，模型与进程内插件即可
 * 统一通过 ctx.shell 运行前台命令或持有后台进程句柄。
 * 【逻辑维度】导出设置命名空间 → 再导出类型与解析函数 → 模块增强声明服务 → 定义抽象执行器契约。
 * 【关键边界】同一上下文只能加载一个 ctx.shell 实现（重复注册会报错）；后台作业语义
 * （job id、所有权、轮询、通知）归 dsh-jobs 管，本包只暴露进程句柄。
 * 【新手阅读建议】从 ShellExecutor 抽象类读起，理解 run 与 start 两条执行路径的契约差异；
 * 再结合 types.ts 看"请求 → 规格 → 结果"三类形状之间的关系。
 * ==========================================================================
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox'
import type { ShellExecRequest, ShellExecSpec, ShellProcess, ShellRunResult } from './types.ts'

/**
 * Settings namespace of this capability, owned here rather than by either
 * executor family because it names the capability, not an implementation: a
 * host composes exactly one provider of `ctx.shell` (the win32 layer swaps the
 * POSIX rows for the pwsh ones, and mounting both fails loud on a duplicate
 * service registration), so the providers share one namespace without ever
 * registering it twice, and a settings document carried between platforms
 * keeps resolving on both.
 */
export const SHELL_SETTINGS_NAMESPACE = 'shell'

export { DSH_ENV_PREFIX } from './types.ts'
export type {
  ShellExecRequest,
  ShellExecSpec,
  ShellProcess,
  ShellProcessRead,
  ShellProcessStatus,
  ShellRunResult,
  ShellSandboxInfo,
  CollectedOutput,
  DshEnvironment,
  DshEnvironmentKey,
} from './types.ts'
export { parseExitStatus } from './render.ts'
export type { ParsedExitStatus } from './render.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    shell: ShellExecutor
  }
}

/**
 * Abstract bash execution service. Subclass, implement the abstract methods,
 * and load the subclass as a plugin — it registers as `ctx.shell` (one
 * implementation per context; loading a second throws, which is cordis'
 * standard duplicate-service behavior).
 *
 * Implementations must honor these semantics:
 * - {@link run} rejects only for infrastructure failures. Nonzero exits,
 *   timeout kills, and abort kills resolve with a {@link ShellRunResult}.
 * - {@link start} returns immediately; no timeout applies to background
 *   processes. `done` settles at process close and never rejects; spawn
 *   failures settle as `killed` with the error on stderr.
 * - {@link ShellProcess.readOutput} is incremental: consecutive reads never
 *   repeat output. Lossy reads report truncation and available spill files.
 * - A still-running background process is stopped and awaited when its
 *   owning composition tears down. With the subprocess seam that
 *   boundary is `ctx.subprocess` disposal, so a background process survives
 *   an executor-only reload.
 */
export abstract class ShellExecutor extends Service {
  constructor(ctx: Context) {
    super(ctx, 'shell')
  }

  /**
   * The sandbox mode this executor applies by default, or `undefined` when it
   * does not sandbox commands.
   * @returns the configured default sandbox mode, when supported.
   */
  get sandboxMode(): SandboxMode | undefined {
    return undefined
  }

  /**
   * Apply implementation-owned defaults and caps to a request before execution.
   * @param request - the caller's request; omitted fields get this
   *   implementation's defaults, capped fields are clamped.
   * @returns the fully-specified spec to hand to {@link run}/{@link start}.
   */
  abstract resolve(request: ShellExecRequest): ShellExecSpec

  /**
   * Run a command in the foreground; resolves when it finishes.
   * @param spec - a resolved spec from {@link resolve}, never a raw request.
   * @returns the outcome; nonzero exits, timeout kills, and abort kills
   *   resolve with a descriptive result rather than reject.
   */
  abstract run(spec: ShellExecSpec): Promise<ShellRunResult>

  /**
   * Start a background process and return its handle immediately.
   * @param spec - a resolved spec from {@link resolve}, never a raw request.
   * @returns the live process handle (reads, kill, quiescence promise).
   */
  abstract start(spec: ShellExecSpec): ShellProcess
}

export default ShellExecutor
