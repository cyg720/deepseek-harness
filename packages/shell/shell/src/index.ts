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

/**
 * Service Definition for the `ctx.shell` capability seam, covering foreground commands and background process
 * handles. Job ids, ownership, polling, and notices belong to
 * `@deepseek-ai/dsh-jobs`, keeping executors independent of sessions.
 * @module @deepseek-ai/dsh-shell
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
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
export const SHELL_SETTINGS_NAMESPACE = settingsNamespace('shell')
/**
 * 本能力的设置命名空间（settingsNamespace('shell')），由能力层而非某个执行器持有：
 * 它命名的是"能力"而非"实现"。宿主只组合一个 ctx.shell 提供者（win32 平台会把 POSIX 行换成
 * pwsh 行），多个提供者共享这一个命名空间而不会重复注册，跨平台携带的设置文档也能照常解析。
 */

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
/*
 * 抽象的 bash 执行服务。子类实现抽象方法后作为插件加载，即注册为 ctx.shell
 * （每个上下文只能有一个实现，加载第二个会抛错——这是 Cordis 标准的重复服务行为）。
 *
 * 实现必须遵守的语义：
 * - run 只在基础设施故障时 reject；非零退出、超时终止、abort 终止都以 ShellRunResult 正常返回。
 * - start 立即返回句柄，后台进程没有超时；done 在进程关闭时落定且永不 reject，
 *   启动失败以 killed 状态落定并把错误写入 stderr。
 * - readOutput 是增量读取：连续读取不会重复输出；丢数据的读取会报告截断与可用溢出文件。
 * - 组合体拆解时仍在运行的后台进程会被终止并等待；经由 ctx.subprocess 管理时，
 *   后台进程可以跨执行器重载继续存活。
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
  /* 该执行器默认应用的沙箱模式；不支持沙箱的执行器返回 undefined。 */
  get sandboxMode(): SandboxMode | undefined {
    return undefined
  }

  /**
   * Apply implementation-owned defaults and caps to a request before execution.
   * @param request - the caller's request; omitted fields get this
   *   implementation's defaults, capped fields are clamped.
   * @returns the fully-specified spec to hand to {@link run}/{@link start}.
   */
  /*
   * 在真正执行前，给请求补上实现自有的默认值并对超时等字段设上限，产出"完全指定"的规格。
   * @param request 调用方传入的请求；缺省字段取该实现的默认值，超出上限的字段被钳制
   * @returns 交给 run/start 的完整规格，调用方不应直接传原始请求
   */
  abstract resolve(request: ShellExecRequest): ShellExecSpec

  /**
   * Run a command in the foreground; resolves when it finishes.
   * @param spec - a resolved spec from {@link resolve}, never a raw request.
   * @returns the outcome; nonzero exits, timeout kills, and abort kills
   *   resolve with a descriptive result rather than reject.
   */
  /*
   * 前台执行一条命令，命令结束时 resolve。
   * @param spec 由 resolve 产出的完整规格，绝不可直接传原始请求
   * @returns 执行结果；非零退出、超时终止、abort 终止都以带描述的结果正常返回而非 reject
   */
  abstract run(spec: ShellExecSpec): Promise<ShellRunResult>

  /**
   * Start a background process and return its handle immediately.
   * @param spec - a resolved spec from {@link resolve}, never a raw request.
   * @returns the live process handle (reads, kill, quiescence promise).
   */
  /*
   * 启动一个后台进程并立即返回句柄。
   * @param spec 由 resolve 产出的完整规格，绝不可直接传原始请求
   * @returns 存活进程句柄（可读取输出、kill、等待结束）
   */
  abstract start(spec: ShellExecSpec): ShellProcess
}

export default ShellExecutor
