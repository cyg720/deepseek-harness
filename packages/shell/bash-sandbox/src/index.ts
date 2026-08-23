/**
 * ================================ 文件注释 ================================
 * 【文件职责】实现沙箱化的 bash 执行器 SandboxBashExecutor：在本地 bash 执行器基础上，
 * 把 `bash -c <command>` 的 argv 交给 ctx.sandbox 提供者做隔离包装，并上报沙箱模式、
 * 执行完整度与拒绝事实。
 * 【技术维度】继承 LocalBashExecutor 复用其进程/输出/超时机制；通过 ctx.sandbox.confine
 * 生成受限 argv；对前台 run 与后台 start 分别处理"运行器启动失败"（抛 SANDBOX_UNAVAILABLE
 * 或标 runnerFailed）与"策略拒绝"（classifyDenial 依据 stderr 签名判定）。
 * 【产品维度】模型执行 shell 命令时的安全边界：默认在沙箱模式下运行，危险操作被策略拒绝；
 * 工具层通过 ctx.approval 处理升级审批，本执行器只负责上报沙箱事实供工具渲染。
 * 【逻辑维度】resolve 盖印完整策略 → run/start 按模式分流（full-access 直通，受限则包装
 * argv）→ 失败分类（spawn 失败 / 运行器失败 / 拒绝）→ onProcessDone 落定进程级事实。
 * 【关键边界】沙箱策略（默认模式与 workspace-write 根目录）不在本执行器配置里，而是来自
 * ctx.sandboxPolicy；运行器选择是 ctx.sandbox 提供者的配置；danger-full-access 模式不产生
 * 沙箱事实。
 * 【新手阅读建议】先读 bash-local/index.ts 理解被继承的执行机制，再对照 helpers.ts 看
 * 失败分类规则，最后回到本文件的 run/start 看两类结局如何分流。
 * ==========================================================================
 */

/**
 * Sandbox-consuming bash executor. It wraps the exact local bash argv through
 * `ctx.sandbox`, inherits local process mechanics, and reports the selected
 * mode, enforcement, and denial facts. Positive runner-launch evidence means
 * the command never ran: foreground calls throw `SANDBOX_UNAVAILABLE`, while
 * background processes carry `runnerFailed`; other spawn rejections retain
 * local-executor semantics. The tool owns approval and passes a complete per-call policy.
 * @module @deepseek-ai/dsh-bash-sandbox
 */

import { Context } from '@deepseek-ai/cordis'
import type { ShellExecRequest, ShellExecSpec, ShellProcess, ShellRunResult } from '@deepseek-ai/dsh-shell'
import { SandboxUnavailableError } from '@deepseek-ai/dsh-sandbox'
import type {
  ConfinedArgv,
  ConfinedSandboxMode,
  RunnerFailureRule,
  SandboxEnforcement,
  SandboxExecutionPolicy,
  SandboxMode,
  SandboxPolicy,
} from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import { LocalBashExecutor } from '@deepseek-ai/dsh-bash-local'
import type { Config as LocalConfig } from '@deepseek-ai/dsh-bash-local'
import { classifyDenial, classifyRunnerFailure, isRunnerSpawnFailure, matchesSignature } from './helpers.ts'

/**
 * Plugin config: the local executor's knobs, verbatim. The sandbox policy —
 * the default mode and fallback `workspace-write` root — is NOT here: it lives
 * on `ctx.sandboxPolicy` (`@deepseek-ai/dsh-sandbox-policy`), which resolves
 * each calling session's mode and cwd for every enforcing capability. The runner
 * choice is likewise the `ctx.sandbox` provider's config, not this executor's.
 */
/**
 * 插件配置：原样复用本地执行器的配置项。沙箱策略（默认模式与 workspace-write 回退根目录）
 * 不在这里，而是由 ctx.sandboxPolicy 按会话解析；运行器选择同样是 ctx.sandbox 提供者的配置。
 */
export type Config = LocalConfig

/**
 * Registers as `ctx.shell` in place of the local executor and requires a
 * `ctx.sandbox` provider plus `ctx.sandboxPolicy`; the tool layer is
 * unchanged. Tool calls pass the calling session's resolved policy; direct
 * calls fall back to deployment policy. `result.sandbox` reports the mode and
 * enforcement actually used.
 */
/**
 * 注册为 ctx.shell 以替代本地执行器，并要求 ctx.sandbox 提供者与 ctx.sandboxPolicy
 * 同时存在；工具层保持不变。工具调用传入调用会话已解析的策略，直接调用则回退到部署策略。
 * result.sandbox 上报实际使用的模式与执行完整度。
 */
export class SandboxBashExecutor extends LocalBashExecutor {
  static override inject = ['subprocess', 'sandbox', 'sandboxPolicy']

  // No own Config: the sandbox default (mode + workspaceRoot) is owned by
  // ctx.sandboxPolicy, so this executor inherits LocalBashExecutor's Config
  // verbatim (the config catalog walks the inherited static).

  private readonly mode: SandboxMode
  /** 沙箱默认模式，作为能力事实供模式广告（schema advertisement）使用。 */
  /**
   * Per-process confinement facts retained until settlement. Providers may
   * vary enforcement and diagnostic dialect between overlapping calls, so a
   * shared latest-wrap value would classify a process against the wrong facts.
   * Unconfined processes have no entry.
   */
  /**
   * 每个进程的隔离事实，保留到进程落定为止。提供者在重叠调用之间可能变化执行完整度与
   * 诊断方言，因此共享"最近一次包装"的值会把进程分类到错误的事实上；未隔离的进程无此条目。
   */
  private readonly processFacts = new Map<ShellProcess, {
    mode: ConfinedSandboxMode
    enforcement: SandboxEnforcement
    denialSignatures: readonly string[]
    runnerFailureRules: readonly RunnerFailureRule[]
    runnerProgram: string | undefined
    workdir: string
  }>()

  constructor(ctx: Context, config: Config) {
    super(ctx, config)
    // The default mode is the capability fact used for schema advertisement;
    // actual tool executions carry their resolved per-call policy.
    this.mode = ctx.sandboxPolicy.defaultMode
  }

  /** The configured default mode — the capability fact the tool layer reads. */
  /** 配置的默认模式——工具层读取的能力事实。 */
  override get sandboxMode(): SandboxMode {
    return this.mode
  }

  /**
   * Stamp a complete per-call policy onto the spec. Tool calls supply the
   * calling session's resolved mode and root; lower-level callers fall back to
   * the deployment policy.
   */
  /**
   * 把完整的一次调用策略盖到规格上。工具调用携带调用会话已解析的模式与根目录；
   * 底层调用方回退到部署策略。
   */
  override resolve(request: ShellExecRequest): ShellExecSpec {
    return { ...super.resolve(request), sandboxPolicy: request.sandboxPolicy ?? this.ctx.sandboxPolicy.resolve() }
  }

  /**
   * 前台执行一条受限命令：先按策略分流，再对三类失败（spawn 失败 / 运行器失败 / 拒绝）
   * 分别给出可区分的结局。
   */
  override async run(spec: ShellExecSpec): Promise<ShellRunResult> {
    // 取出本次调用已解析的策略及其模式；danger-full-access 表示完全放行。
    const policy = spec.sandboxPolicy as SandboxExecutionPolicy
    const { mode } = policy
    if (mode === 'danger-full-access') {
      // 完全放行模式：直接走本地执行器，仅补上"未拒绝"的沙箱事实。
      const result = await super.run(spec)
      return { ...result, sandbox: { mode, denied: false } }
    }
    // 受限模式：把 bash -c argv 交给沙箱提供者包装成受限 argv。
    const confined = this.confine(spec.command, { ...policy, mode })
    let result: ShellRunResult
    try {
      result = await this.runArgv(spec, confined.argv)
    } catch (error) {
      // An upstream abort remains cancellation even when it prevents spawn.
      // 即使中止阻止了 spawn，上游中止仍算取消，不算运行器故障。
      if (spec.signal?.aborted === true) spec.signal.throwIfAborted()
      if (isRunnerSpawnFailure(error, confined.argv[0], spec.workdir)) {
        throw new SandboxUnavailableError(mode, String(error))
      }
      throw error
    }
    // Runner failure outranks denial because the command did not run. Carry
    // the matched fatal line, not an informational line that preceded it.
    // 运行器失败优先于拒绝（命令根本没运行）；携带匹配到的致命行而非其前的信息行。
    const runnerFailure = classifyRunnerFailure(result.exitCode, result.stderr.text, confined.runnerFailureRules)
    if (runnerFailure !== undefined) {
      throw new SandboxUnavailableError(mode, runnerFailure.detail)
    }
    return { ...result, sandbox: { mode, denied: classifyDenial(result, confined.denialSignatures), enforcement: confined.enforcement } }
  }

  /**
   * 后台启动一条受限命令：与 run 同样先按模式分流，并把本次隔离事实记入 processFacts，
   * 供 onProcessDone 在落定时分类使用。启动失败以 killed 状态落定。
   */
  override start(spec: ShellExecSpec): ShellProcess {
    const policy = spec.sandboxPolicy as SandboxExecutionPolicy
    const { mode } = policy
    if (mode === 'danger-full-access') return super.start(spec)
    // Once startArgv returns, install facts synchronously; promise settlement
    // cannot run before start() returns.
    // startArgv 返回后要同步写入事实：promise 的落定回调不可能先于 start() 返回执行。
    const confined = this.confine(spec.command, { ...policy, mode })
    let proc: ShellProcess
    try {
      proc = this.startArgv(spec, confined.argv)
    } catch (error) {
      // LocalSubprocessRuntime reports ENOENT/EACCES with the failed executable path through async
      // `done` rejection; this covers alternatives that throw the same error synchronously.
      // 本地子进程运行器通过异步 done reject 上报 ENOENT/EACCES；这里同时覆盖同步抛错的变体。
      if (isRunnerSpawnFailure(error, confined.argv[0], spec.workdir)) {
        throw new SandboxUnavailableError(mode, String(error))
      }
      throw error
    }
    // 把本次隔离事实与进程句柄绑定，落定时据此分类（而非用全局"最近一次"的值）。
    const { enforcement, denialSignatures, runnerFailureRules } = confined
    this.processFacts.set(proc, {
      mode,
      enforcement,
      denialSignatures,
      runnerFailureRules,
      runnerProgram: confined.argv[0],
      workdir: spec.workdir,
    })
    return proc
  }

  /**
   * Stamp per-process sandbox facts before `done` settles. Full-access processes
   * have no facts; signal deaths are not denials.
   */
  /**
   * 在 done 落定前给进程盖印沙箱事实。完全放行（full-access）的进程没有事实；
   * 被信号杀死的进程不算拒绝。
   */
  protected override onProcessDone(proc: ShellProcess, stderr: string, spawnFailed: boolean, spawnError?: unknown): void {
    const facts = this.processFacts.get(proc)
    if (facts !== undefined) {
      this.processFacts.delete(proc)
      // A rejected spawn never started the confined launch. Otherwise runner
      // failure outranks denial because its diagnostics may contain denial terms.
      // spawn 被拒说明受限启动根本没发生；否则运行器失败优先于拒绝（其诊断可能包含拒绝措辞）。
      const runnerFailed = spawnFailed
        ? isRunnerSpawnFailure(spawnError, facts.runnerProgram, facts.workdir)
        : classifyRunnerFailure(proc.exitCode, stderr, facts.runnerFailureRules) !== undefined
      proc.sandbox = {
        mode: facts.mode,
        denied: !runnerFailed && matchesSignature(proc.exitCode, stderr, facts.denialSignatures),
        enforcement: facts.enforcement,
        ...(runnerFailed ? { runnerFailed } : {}),
      }
    }
    super.onProcessDone(proc, stderr, spawnFailed, spawnError)
  }

  /**
   * Wrap one shell command via the `ctx.sandbox` provider. Provider errors
   * propagate unchanged; the returned argv is handed directly to the local
   * executor's subprocess path.
   * @param command - shell source for the confined inner `bash -c`.
   * @param policy - resolved confined execution policy.
   * @returns the provider's exact argv and settlement-classification facts.
   */
  /**
   * 通过 ctx.sandbox 提供者包装一条 shell 命令。提供者错误原样向上抛；返回的 argv
   * 直接交给本地执行器的子进程路径。
   * @param command 需要被隔离包装的 bash -c 内部 shell 源码
   * @param policy 已解析的受限执行策略
   * @returns 提供者给出的精确 argv 与落定分类所需事实
   */
  private confine(command: string, policy: SandboxPolicy): ConfinedArgv {
    return this.ctx.sandbox.confine(['bash', '-c', command], policy)
  }
}

export default SandboxBashExecutor
