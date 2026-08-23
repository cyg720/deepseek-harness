/**
 * ================================ 文件注释 ================================
 * 【文件职责】实现 bash 能力缝的本地 Service Provider：LocalBashExecutor 把前台命令作为
 * `bash -c` 在受管进程组里运行，负责命令默认值、截止时间与原因分类、模型友好的终端环境、
 * 以及后台读取时的 stdout/stderr 合并。
 * 【技术维度】基于子进程能力缝（ctx.subprocess）：通过 SubprocessSpawnSpec 声明输出收集
 * 预算与溢出文件；用 dsh-timeout 的 deadline 把"超时 + 调用方取消"融合成单一截止时间；
 * 后台进程由子进程服务按进程树管理，能跨执行器重载存活。
 * 【产品维度】模型与插件执行 shell 命令的默认通道：禁用颜色/分页等干扰输出的终端特性，
 * 输出超限自动落盘（spill 文件），超时可配置，是 sandbox 执行器的父类与执行机制来源。
 * 【逻辑维度】config 解析与校验 → resolve 补全规格 → run/start 分流（前台/后台）→
 * spawnSpec 组装子进程请求 → runArgv/startArgv 驱动生命周期与输出读取 → onProcessDone 钩子。
 * 【关键边界】执行策略（沙箱、预执行钩子）不属于本执行器；stderr 在后台读取时放入
 * [stderr] 标记分区；executor 自身超时才算 timedOut，外层截止时间算 aborted。
 * 【新手阅读建议】从 resolve 的字段补全规则读起，再看 runArgv 的 deadline 融合逻辑，
 * 最后看 startArgv 里 proc 句柄的 done/readOutput/kill 三个接口如何落地。
 * ==========================================================================
 */

/**
 * Local Service Provider for the bash capability seam over the subprocess
 * capability seam. Public commands run as `bash -c` in a managed process group spawned
 * through `ctx.subprocess`; subclasses may reuse the same mechanics with an
 * explicit argv. This executor owns command defaulting, deadlines and cause
 * classification, the model-friendly terminal environment, and the model-facing
 * stdout/stderr merge for background reads. Execution policy belongs in
 * `tools/pre-execute` or a sandboxing executor.
 * @module @deepseek-ai/dsh-bash-local
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SHELL_SETTINGS_NAMESPACE, ShellExecutor } from '@deepseek-ai/dsh-shell'
import type { ShellExecRequest, ShellExecSpec, ShellProcess, ShellProcessRead, ShellRunResult, CollectedOutput } from '@deepseek-ai/dsh-shell'
import type { SubprocessCollect, SubprocessHandle, SubprocessOutputReader, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { installSettingsSection } from '@deepseek-ai/dsh-settings'
import { clampTimeout, deadline, MAX_TIMER_DELAY_MS, timeoutOf } from '@deepseek-ai/dsh-timeout'

/**
 * Model-friendly environment overrides: disable colors, pagers, and
 * interactive terminal features that would garble tool output (the same set
 * Codex hardcodes; Claude Code achieves it via TERM=dumb). Bash-tool policy —
 * merged first into the spawn's explicit env, so a trusted caller's own entry
 * still wins; the subprocess service applies its credential scrub independently.
 */
/**
 * 模型友好的环境覆盖：关闭颜色、分页器与交互式终端特性，防止工具输出被转义序列污染
 * （与 Codex 硬编码的集合相同；Claude Code 用 TERM=dumb 达到同样效果）。该映射最先
 * 合并进 spawn 的显式 env，所以可信调用方自己的条目仍然胜出；凭据擦除由子进程服务
 * 独立执行。
 */
export const ENV_OVERRIDES = {
  NO_COLOR: '1',
  TERM: 'dumb',
  PAGER: 'cat',
  GIT_PAGER: 'cat',
} as const

/** Default SIGTERM→SIGKILL grace period (the `graceMs` config; matches OpenCode's 3s). */
/** 默认的 SIGTERM→SIGKILL 宽限期（对应 graceMs 配置项，与 OpenCode 的 3 秒一致）。 */
const DEFAULT_GRACE_MS = 3_000

/** Default per-stream spill cap (the `maxSpillBytes` config). */
/** 默认的每流溢出文件上限（对应 maxSpillBytes 配置项，64 MiB）。 */
const DEFAULT_MAX_SPILL_BYTES = 64 * 1024 * 1024

/** Plugin config (all optional — `static Config` supplies the defaults). */
/**
 * 插件配置（全部可选——static Config 提供默认值）。这些字段决定命令默认工作目录、
 * 超时与输出预算，可在 cordis.yml 中覆盖，也可经设置文档按会话调整。
 */
export interface Config {
  /** Default working directory for commands (default: process.cwd()). */
  /** 命令默认工作目录（缺省为 process.cwd()）。 */
  cwd?: string
  /** Default foreground timeout in milliseconds. */
  /** 前台命令默认超时毫秒数。 */
  timeoutMs?: number
  /** Upper bound for per-call timeout overrides. */
  /** 单次调用超时覆盖值的上限。 */
  maxTimeoutMs?: number
  /** Per-stream in-memory output cap; overflow spills to a temp file. */
  /** 每流内存输出上限；溢出部分落到临时文件。 */
  maxOutputBytes?: number
  /** Per-stream spill-file cap; larger streams retain only their in-memory tail. */
  /** 每流溢出文件上限；更大的流只保留内存中的尾部。 */
  maxSpillBytes?: number
  /** Grace period for kill escalation and inherited pipes; at most `MAX_TIMER_DELAY_MS`. */
  /** 终止升级与继承管道的宽限期；不能超过 MAX_TIMER_DELAY_MS。 */
  graceMs?: number
}

/** The shape after schemastery applied the defaults (cwd has none). */
/** schemastery 应用默认值之后的配置形状（cwd 无默认值）。 */
type ResolvedConfig = Required<Omit<Config, 'cwd'>> & Pick<Config, 'cwd'>

/** Project a settled collect-mode reader into the final CollectedOutput shape. */
/**
 * 把一个已落定的收集模式读取器投影为最终的 CollectedOutput 形状：从偏移 0 全量读取，
 * 汇总文本、截断标志与溢出文件路径。
 */
function finalOutput(reader: SubprocessOutputReader): CollectedOutput {
  const read = reader.readFrom(0)
  return {
    text: read.text,
    truncated: read.lossy,
    ...read.spillPath !== undefined ? { spillPath: read.spillPath } : {},
  }
}

/** 校验配置数值必须为正有限数，否则抛错（本执行器所有输出/超时预算字段共用）。 */
function assertPositiveFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`bash-local: ${name} must be a positive finite number`)
  }
}

/**
 * Reject a resolved section this executor could not run with. The schema
 * expresses neither "positive and finite" nor the timer bound `graceMs` has to
 * fit, so a stored value is refused where it is written instead of failing at
 * the next command.
 * @param config - the resolved section, schema-valid by construction.
 * @throws Error naming the field that cannot be used.
 */
/**
 * 拒绝一份本执行器无法运行的已解析配置段。schema 表达不了"正有限数"和 graceMs 必须
 * 适配的定时器上限，因此在这里（写入处）拒绝存储值，而不是等到下次命令执行时才失败。
 * @param config 已解析的配置段（按构造必为 schema 合法）
 * @throws 指出无法使用的字段名的 Error
 */
export function assertServiceableBashConfig(config: Config): void {
  const resolved = config as ResolvedConfig
  assertPositiveFinite('timeoutMs', resolved.timeoutMs)
  assertPositiveFinite('maxTimeoutMs', resolved.maxTimeoutMs)
  assertPositiveFinite('maxOutputBytes', resolved.maxOutputBytes)
  assertPositiveFinite('maxSpillBytes', resolved.maxSpillBytes)
  assertPositiveFinite('graceMs', resolved.graceMs)
  if (resolved.graceMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`bash-local: graceMs must be no greater than ${MAX_TIMER_DELAY_MS}`)
  }
}

/**
 * Local bash executor over `ctx.subprocess`. Bounded output, spill files, and
 * process-group SIGTERM→SIGKILL escalation are the subprocess service's
 * mechanics; this executor supplies their configured budgets per spawn, so a
 * still-running background process stays managed (killed and joined at
 * composition teardown) even across an executor reload.
 */
/**
 * 基于 ctx.subprocess 的本地 bash 执行器。有界输出、溢出文件、进程组 SIGTERM→SIGKILL
 * 升级都是子进程服务的机制；本执行器每次 spawn 为它们提供配置好的预算，因此仍在运行的
 * 后台进程在组合体拆解时保持受管（被杀死并等待），甚至跨执行器重载也如此。
 */
export class LocalBashExecutor extends ShellExecutor {
  static inject = ['subprocess']

  static Config: z<Config> = z.object({
    cwd: z.string(),
    timeoutMs: z.number().default(120_000),
    maxTimeoutMs: z.number().default(600_000),
    maxOutputBytes: z.number().default(64_000),
    maxSpillBytes: z.number().default(DEFAULT_MAX_SPILL_BYTES),
    graceMs: z.number().default(DEFAULT_GRACE_MS),
  })

  /** The currently authoritative config: the settings section, or the composition entry. */
  /** 当前权威配置的来源：优先设置文档中的 section，否则是组合条目的静态配置。 */
  private source: () => ResolvedConfig

  /** Validated config (schemastery applied the defaults before construction). */
  /** 已校验的配置（schemastery 在构造前已应用默认值）。 */
  get config(): ResolvedConfig {
    return this.source()
  }

  constructor(ctx: Context, config: Config) {
    super(ctx)
    // Schemastery fills these fields before construction; the type does not encode that step.
    // schemastery 在构造前已填好这些字段，但类型没有表达这一步骤，故需断言。
    const entry = config as ResolvedConfig
    assertServiceableBashConfig(entry)
    this.source = () => entry
    installSettingsSection(ctx, SHELL_SETTINGS_NAMESPACE, LocalBashExecutor.Config, entry, {
      validate: assertServiceableBashConfig,
      setSource: (current) => {
        this.source = current as () => ResolvedConfig
      },
      // Every field is read through the getter at each command, so nothing
      // derived from the source needs rebuilding when the document changes.
      // 每个字段都在每次命令时经 getter 读取，因此设置文档变化后无需重建派生数据。
      onChange: () => {},
    })
  }

  /**
   * Resolve a request into a fully-specified spec: fill `workdir` from
   * `config.cwd` (else `process.cwd()`), and `timeoutMs` from
   * `config.timeoutMs`, capped at `config.maxTimeoutMs`. The tool layer calls
   * this before {@link run}/{@link start}, so those methods receive explicit
   * values and never re-default.
   */
  /**
   * 把请求解析为完全指定的规格：workdir 取自 config.cwd（否则 process.cwd()），timeoutMs
   * 取自 config.timeoutMs 并按 config.maxTimeoutMs 封顶。工具层会在 run/start 之前调用本方法，
   * 因此这两个方法拿到的都是显式值，不会再做默认化。
   */
  resolve(request: ShellExecRequest): ShellExecSpec {
    const timeoutMs = clampTimeout(
      request.timeoutMs,
      this.config.timeoutMs,
      this.config.maxTimeoutMs,
      'bash-local: request.timeoutMs',
    )
    const stdoutMaxBytes = request.stdoutMaxBytes ?? this.config.maxOutputBytes
    assertPositiveFinite('request.stdoutMaxBytes', stdoutMaxBytes)
    return {
      command: request.command,
      workdir: request.workdir ?? this.config.cwd ?? process.cwd(),
      timeoutMs,
      stdoutMaxBytes,
      ...request.signal ? { signal: request.signal } : {},
      // Carry stdin/ordinary env/trusted dshEnv through verbatim — optional,
      // no config default. The subprocess service owns the scrub and merge order.
      // stdin/普通 env/可信 dshEnv 原样透传——可选、无配置默认值；擦除与合并顺序归子进程服务。
      ...request.stdin !== undefined ? { stdin: request.stdin } : {},
      ...request.env !== undefined ? { env: request.env } : {},
      ...request.dshEnv !== undefined ? { dshEnv: request.dshEnv } : {},
      // Carry a sandbox policy through verbatim: this executor never
      // confines, so the field is inert here (the seam contract) — a
      // sandboxing subclass overrides resolve() to stamp its default instead.
      // 沙箱策略原样透传：本执行器从不隔离，因此该字段在这里是惰性的（缝契约）；
      // 沙箱子类会覆写 resolve() 来盖印自己的默认值。
      sandboxPolicy: request.sandboxPolicy,
    }
  }

  /** Map one resolved bash spec and explicit argv onto a fully-specified subprocess spawn. */
  /** 把一个已解析的 bash 规格与显式 argv 映射为完全指定的子进程 spawn 请求。 */
  // XXX(stateful-shell): evaluate persistent cwd or PTY sessions when workflows require shell state.
  // XXX(stateful-shell): 当工作流需要 shell 状态时，评估持久 cwd 或 PTY 会话（遗留标记）。
  private spawnSpec(
    spec: ShellExecSpec,
    argv: readonly string[],
    stdoutMaxBytes: number,
    signal: AbortSignal | undefined,
  ): SubprocessSpawnSpec {
    // 每个输出流都配置内存上限与溢出文件上限。
    const collect = (maxBytes: number): SubprocessCollect =>
      ({ maxBytes, spill: { maxBytes: this.config.maxSpillBytes } })
    return {
      argv,
      cwd: spec.workdir,
      stdio: {
        stdin: spec.stdin !== undefined ? { data: spec.stdin } : 'ignore',
        stdout: collect(stdoutMaxBytes),
        stderr: collect(this.config.maxOutputBytes),
      },
      graceMs: this.config.graceMs,
      signal,
      // One explicit env map for the seam, layered so the trusted dshEnv
      // snapshot beats both the caller's env and the terminal overrides; the
      // subprocess service merges the whole map after its ambient scrub.
      // 单张显式 env 分层合并：可信 dshEnv 快照压过调用方 env 与终端覆盖；子进程服务在
      // 环境擦除后合并整张映射。
      env: { ...ENV_OVERRIDES, ...spec.env, ...spec.dshEnv },
    }
  }

  /** The collect-mode readers the executor itself requested (present by construction). */
  /** 执行器自己请求的收集模式读取器（按构造必然存在，防御性断言）。 */
  private static collected(handle: SubprocessHandle): { stdout: SubprocessOutputReader; stderr: SubprocessOutputReader } {
    const { stdout, stderr } = handle.collected
    /* v8 ignore start -- collect dispositions expose both readers by the seam contract; defensive. */
    if (stdout === undefined || stderr === undefined) {
      throw new Error('bash-local: subprocess implementation dropped a requested collect stream')
    }
    /* v8 ignore stop */
    return { stdout, stderr }
  }

  /** 前台执行：命令以 `bash -c` 形式运行。 */
  async run(spec: ShellExecSpec): Promise<ShellRunResult> {
    return this.runArgv(spec, ['bash', '-c', spec.command])
  }

  /**
   * Run an explicit argv with the foreground lifecycle, environment, output,
   * timeout, and cancellation semantics of this executor. Subclasses use this
   * after replacing the public command's shell argv at an execution boundary.
   * @param spec - resolved execution settings and caller-owned command metadata.
   * @param argv - exact executable and arguments to hand to `ctx.subprocess`.
   * @returns the settled foreground result with collected output and cause facts.
   */
  /**
   * 以前台生命周期、环境、输出、超时与取消语义运行一个显式 argv。子类在替换了公开命令的
   * shell argv 后使用本方法（这是执行边界上的复用点）。
   * @param spec 已解析的执行设置与调用方持有的命令元数据
   * @param argv 要交给 ctx.subprocess 的精确可执行文件与参数
   * @returns 已落定的前台结果，含收集的输出与原因事实
   */
  protected async runArgv(spec: ShellExecSpec, argv: readonly string[]): Promise<ShellRunResult> {
    // One deadline combines timeout and upstream cancellation; disposal clears its timer.
    // 单一截止时间同时驱动超时与上游取消；dispose 时清除其定时器。
    using d = deadline(spec.signal, spec.timeoutMs, 'BASH_TIMEOUT')
    const handle = this.ctx.subprocess.spawn(this.spawnSpec(spec, argv, spec.stdoutMaxBytes, d.signal))
    const outcome = await handle.done
    const collected = LocalBashExecutor.collected(handle)
    // Only this executor's timeout reason counts as timedOut; outer deadlines count as aborts.
    // 只有本执行器自身的超时原因才算 timedOut；外层截止时间算 aborted。
    const timedOut = timeoutOf(d.signal, 'BASH_TIMEOUT') !== undefined
    const aborted = d.signal.aborted && !timedOut
    return {
      ...outcome,
      timedOut,
      aborted,
      timeoutMs: spec.timeoutMs,
      stdout: finalOutput(collected.stdout),
      stderr: finalOutput(collected.stderr),
    }
  }

  /** 后台启动：命令以 `bash -c` 形式运行。 */
  start(spec: ShellExecSpec): ShellProcess {
    return this.startArgv(spec, ['bash', '-c', spec.command])
  }

  /**
   * Start an explicit argv with the background lifecycle, environment, output,
   * cancellation, and process-tree ownership semantics of this executor.
   * Subclasses use this after replacing the public command's shell argv at an
   * execution boundary.
   * @param spec - resolved execution settings and caller-owned command metadata.
   * @param argv - exact executable and arguments to hand to `ctx.subprocess`.
   * @returns the live background handle; spawn rejection settles it as killed.
   */
  /**
   * 以后台生命周期、环境、输出、取消与进程树归属语义启动一个显式 argv。子类在替换了
   * 公开命令的 shell argv 后使用本方法（这是执行边界上的复用点）。
   * @param spec 已解析的执行设置与调用方持有的命令元数据
   * @param argv 要交给 ctx.subprocess 的精确可执行文件与参数
   * @returns 存活的进程句柄；spawn 被拒时以 killed 状态落定
   */
  protected startArgv(spec: ShellExecSpec, argv: readonly string[]): ShellProcess {
    // Background runs ignore timeoutMs; callers stop them through kill() or spec.signal.
    // 后台运行忽略 timeoutMs；调用方通过 kill() 或 spec.signal 停止它们。
    const running = this.ctx.subprocess.spawn(this.spawnSpec(spec, argv, this.config.maxOutputBytes, spec.signal))
    const collected = LocalBashExecutor.collected(running)

    // A spawn failure produces no process output, so the subprocess service has nothing
    // to buffer; the note is delivered exactly once through the read path.
    // spawn 失败不会产生进程输出，子进程服务没有可缓冲的内容；这条备注经读取路径恰好投递一次。
    let spawnFailureNote: string | undefined
    const consumeSpawnFailure = (): string => {
      const note = spawnFailureNote ?? ''
      spawnFailureNote = undefined
      return note
    }

    let stdoutOffset = 0
    let stderrOffset = 0
    const proc: ShellProcess = {
      status: 'running',
      exitCode: null,
      signal: null,
      done: running.done.then((outcome) => {
        // Any signal termination is killed, including a command signaling itself.
        // 任何信号终止都算 killed，包括命令自己给自己发信号。
        if (proc.status === 'running') {
          proc.status = spec.signal?.aborted === true || outcome.signal !== null ? 'killed' : 'completed'
        }
        proc.exitCode = outcome.exitCode
        proc.signal = outcome.signal
        this.onProcessDone(proc, collected.stderr.readFrom(0).text, false)
      }, (error: unknown) => {
        // Background spawn failures settle as killed and surface through the read path.
        // 后台 spawn 失败以 killed 落定，并通过读取路径浮出水面。
        proc.status = 'killed'
        spawnFailureNote = `spawn failed: ${String(error)}`
        this.onProcessDone(proc, spawnFailureNote, true, error)
      }),
      readOutput: (): ShellProcessRead => {
        const out = collected.stdout.readFrom(stdoutOffset)
        const err = collected.stderr.readFrom(stderrOffset)
        stdoutOffset = out.nextOffset
        stderrOffset = err.nextOffset

        // A failed spawn never produced process output, so the note and real
        // stderr text are mutually exclusive.
        // spawn 失败从未产生进程输出，因此备注与真实 stderr 文本互斥。
        const errText = err.text.length > 0 ? err.text : consumeSpawnFailure()
        // Single newline between sections: stdout chunks usually end with one
        // already; add it only when missing.
        // 分区之间用单个换行：stdout 块通常已以换行结尾，缺失时才补一个。
        const separator = out.text.length > 0 && !out.text.endsWith('\n') ? '\n' : ''
        const delta = out.text
          + (errText.length > 0 ? `${separator}[stderr]\n${errText}` : '')
        return {
          delta,
          lossy: out.lossy || err.lossy,
          ...out.spillPath !== undefined ? { stdoutSpillPath: out.spillPath } : {},
          ...err.spillPath !== undefined ? { stderrSpillPath: err.spillPath } : {},
        }
      },
      kill: (): boolean => {
        if (proc.status !== 'running') return false
        proc.status = 'killed'
        running.terminate()
        return true
      },
    }
    return proc
  }

  /**
   * Settlement hook for subclasses that attach execution facts to a process.
   * Called after exit facts or spawn-failure output are stamped and before
   * {@link ShellProcess.done} resolves. The base implementation is intentionally
   * empty.
   * @param _proc - the settled process handle.
   * @param _stderr - the process's retained stderr tail used by subclasses for settlement classification.
   * @param _spawnFailed - whether the subprocess promise rejected before a process started.
   * @param _spawnError - the original spawn rejection reason, which may itself be undefined.
   */
  /**
   * 供子类挂接"给进程附加执行事实"的落定钩子：在退出事实或 spawn 失败输出写好之后、
   * done resolve 之前调用。基类实现刻意为空（bash-sandbox 的沙箱子类消费同一钩子）。
   * @param _proc 已落定的进程句柄
   * @param _stderr 进程保留的 stderr 尾部，供子类做落定分类
   * @param _spawnFailed 子进程 promise 是否在进程启动前就 reject 了
   * @param _spawnError 原始 spawn 拒绝原因，本身可能为 undefined
   */
  protected onProcessDone(_proc: ShellProcess, _stderr: string, _spawnFailed: boolean, _spawnError?: unknown): void {}
}

export default LocalBashExecutor
