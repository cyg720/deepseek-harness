/**
 * ================================ 文件注释 ================================
 * 【文件职责】实现 bash 能力缝的本地 PowerShell Service Provider：PwshLocalExecutor 把每条
 * 命令作为 `pwsh -NoLogo -NoProfile -NonInteractive -Command <command>` 在受管子进程里运行，
 * 负责命令默认值、截止时间与原因分类、模型友好的终端环境、UTF-8 输出固定与后台读取时的
 * stdout/stderr 合并。
 * 【技术维度】基于子进程能力缝（ctx.subprocess）；命令字符串作为单个 argv 元素传给 -Command，
 * 由 PowerShell 自行解析，不存在中间 shell，因而没有 bash 式引号转义层；ENCODING_PREAMBLE
 * 在每条命令前固定 UTF-8 输出编码（兼容 Windows PowerShell 5.1）；pwsh 可执行文件由独立的
 * resolve.ts 解析。
 * 【产品维度】Windows 上模型与插件执行 shell 命令的默认通道：自动定位 pwsh 安装、关闭
 * 颜色/分页等干扰、输出超限落盘、超时可配置，是 pwsh-sandbox 执行器的父类与执行机制来源。
 * 【逻辑维度】config 解析与校验 → pwsh 路径解析 → resolve 补全规格 → run/start 分流 →
 * argv 生成（含编码前导）→ runArgv/startArgv 驱动生命周期与输出读取 → onProcessDone 钩子。
 * 【关键边界】执行策略（沙箱、预执行钩子）不属于本执行器；沙箱子类通过 argv() 方法重包装
 * 命令；本文件与 bash-local 刻意逐调用镜像（jscpd 豁免），修改时需同步两份。
 * 【新手阅读建议】先看 argv() 理解命令如何组装（注意编码前导与单 argv 元素），再看
 * resolve 与 runArgv，最后对照 bash-local/index.ts 体会二者的镜像关系。
 * ==========================================================================
 */

/**
 * Local PowerShell Service Provider for the bash capability seam. Each command runs
 * as `pwsh -NoLogo -NoProfile -NonInteractive -Command <command>` in a managed
 * process spawned through `ctx.subprocess`; the executor owns command
 * defaulting, deadlines and cause classification, the model-friendly terminal
 * environment, and the model-facing stdout/stderr merge for background reads.
 *
 * The command string is passed as ONE argv element to `-Command`: PowerShell
 * itself parses the text, and no intermediate shell exists, so there is no
 * shell-quoting layer to escape (the `bash -c` string domain has no
 * equivalent here). Native Win32 paths (`C:\...`) pass through unchanged.
 *
 * @module @deepseek-ai/dsh-pwsh-local
 */

/* jscpd:ignore-start -- this executor mirrors dsh-bash-local call-for-call by
   design (see this package's README), so the two import the same seam surface */
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SHELL_SETTINGS_NAMESPACE, ShellExecutor } from '@deepseek-ai/dsh-shell'
import type { ShellExecRequest, ShellExecSpec, ShellProcess, ShellProcessRead, ShellRunResult, CollectedOutput } from '@deepseek-ai/dsh-shell'
import type { SubprocessCollect, SubprocessHandle, SubprocessOutputReader, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { installSettingsSection } from '@deepseek-ai/dsh-settings'
import { clampTimeout, deadline, MAX_TIMER_DELAY_MS, timeoutOf } from '@deepseek-ai/dsh-timeout'
/* jscpd:ignore-end */
import { resolvePwshPath } from './resolve.ts'

/**
 * 下面的实现体是 bash-local 的逐调用镜像（见 Agent Note），jscpd pragma 豁免其重复检测；
 * 元素级中文注释集中在各声明上方，重点标出 PowerShell 特有的差异点。
 */
/* jscpd:ignore-start -- deliberate call-for-call mirror of dsh-bash-local (Agent Note: pwsh-tool-and-executor). */
/**
 * Model-friendly environment overrides for PowerShell: disable colors and
 * pagers that would garble tool output. `TERM=dumb` is a POSIX concept and is
 * deliberately absent; `NO_COLOR` is honored by modern pwsh renderers.
 */
/**
 * 模型友好的环境覆盖（PowerShell 版）：关闭颜色与分页器，防止工具输出被污染。
 * TERM=dumb 是 POSIX 概念，这里刻意不设；NO_COLOR 被现代 pwsh 渲染器支持。
 */
export const ENV_OVERRIDES = {
  NO_COLOR: '1',
  PAGER: 'cat',
  GIT_PAGER: 'cat',
} as const

/**
 * UTF-8 output pinning prepended to every command. The subprocess collector
 * decodes output bytes as UTF-8, but Windows PowerShell 5.1 (the last-resort
 * executable fallback) writes the console/OEM code page by default, which
 * garbles non-ASCII output; pwsh 7 defaults to UTF-8 and is unaffected. The
 * statements ride on line 1 after `; ` separators so PowerShell error line
 * numbers stay accurate.
 */
/**
 * 每条命令前拼接的 UTF-8 输出固定前导。子进程收集器按 UTF-8 解码输出字节，但 Windows
 * PowerShell 5.1（最后回退的可执行文件）默认写控制台/OEM 代码页，会把非 ASCII 输出弄乱；
 * pwsh 7 默认 UTF-8 不受影响。这些语句经 `; ` 分隔后骑在第 1 行，保证 PowerShell 的
 * 错误行号仍然准确。
 */
export const ENCODING_PREAMBLE =
  '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $OutputEncoding = [System.Text.UTF8Encoding]::new($false); '

/** Default SIGTERM→SIGKILL grace period (the `graceMs` config). */
/** 默认的 SIGTERM→SIGKILL 宽限期（对应 graceMs 配置项）。 */
const DEFAULT_GRACE_MS = 3_000

/** Default per-stream spill cap (the `maxSpillBytes` config). */
/** 默认的每流溢出文件上限（对应 maxSpillBytes 配置项，64 MiB）。 */
const DEFAULT_MAX_SPILL_BYTES = 64 * 1024 * 1024

/** Plugin config (all optional — `static Config` supplies the defaults). */
/**
 * 插件配置（全部可选——static Config 提供默认值）。除与 bash-local 相同的预算字段外，
 * 还多了 pwshPath：显式指定 pwsh 可执行文件。
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
  /**
   * Explicit pwsh executable. When omitted, well-known Windows install
   * locations and PATH entries are probed in order (PowerShell 7 install,
   * PATH entries such as the Microsoft Store install, then Windows
   * PowerShell 5.1), falling back to a bare `pwsh` resolved through PATH.
   */
  /**
   * 显式指定的 pwsh 可执行文件。缺省时按顺序探测 Windows 常见安装位置与 PATH 条目
   * （PowerShell 7 安装目录、PATH 条目如 Microsoft Store 安装、再退到 Windows
   * PowerShell 5.1），最后回退到裸 `pwsh` 交给 PATH 解析。
   */
  pwshPath?: string
}

/** The shape after schemastery applied the defaults (cwd/pwshPath have none). */
/** schemastery 应用默认值之后的配置形状（cwd 与 pwshPath 无默认值）。 */
type ResolvedConfig = Required<Omit<Config, 'cwd' | 'pwshPath'>> & Pick<Config, 'cwd' | 'pwshPath'>

// Resolution lives in its own dependency-free module so the repository's
// coverage-gate probe shares the exact definition the suites use.
// 解析逻辑放在独立的零依赖模块中，让仓库覆盖率门探针与测试套件共用同一份定义。
export { candidatePwshPaths, resolvePwshPath } from './resolve.ts'

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
    throw new Error(`pwsh-local: ${name} must be a positive finite number`)
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
export function assertServiceablePwshConfig(config: Config): void {
  const resolved = config as ResolvedConfig
  assertPositiveFinite('timeoutMs', resolved.timeoutMs)
  assertPositiveFinite('maxTimeoutMs', resolved.maxTimeoutMs)
  assertPositiveFinite('maxOutputBytes', resolved.maxOutputBytes)
  assertPositiveFinite('maxSpillBytes', resolved.maxSpillBytes)
  assertPositiveFinite('graceMs', resolved.graceMs)
  if (resolved.graceMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`pwsh-local: graceMs must be no greater than ${MAX_TIMER_DELAY_MS}`)
  }
}

/**
 * Local PowerShell executor over `ctx.subprocess`. Bounded output, spill
 * files, and process-tree termination are the subprocess service's mechanics;
 * this executor supplies their configured budgets per spawn.
 */
/**
 * 基于 ctx.subprocess 的本地 PowerShell 执行器。有界输出、溢出文件、进程树终止都是
 * 子进程服务的机制；本执行器每次 spawn 为它们提供配置好的预算。
 */
export class PwshLocalExecutor extends ShellExecutor {
  static inject = ['subprocess']

  static Config: z<Config> = z.object({
    cwd: z.string(),
    timeoutMs: z.number().default(120_000),
    maxTimeoutMs: z.number().default(600_000),
    maxOutputBytes: z.number().default(64_000),
    maxSpillBytes: z.number().default(DEFAULT_MAX_SPILL_BYTES),
    graceMs: z.number().default(DEFAULT_GRACE_MS),
    pwshPath: z.string(),
  })

  /** The currently authoritative config: the settings section, or the composition entry. */
  /** 当前权威配置的来源：优先设置文档中的 section，否则是组合条目的静态配置。 */
  private source: () => ResolvedConfig

  /** The declared executable the current {@link pwshPath} was resolved from. */
  /** 当前配置中声明（未经解析）的 pwsh 路径，用于检测设置变化。 */
  private declaredPwshPath: string | undefined

  /** The pwsh executable resolved from the current config. */
  /** 从当前配置解析出的 pwsh 可执行文件（每次命令实际 spawn 的目标）。 */
  private resolvedPwshPath: string

  /** Validated config (schemastery applied the defaults before construction). */
  /** 已校验的配置（schemastery 在构造前已应用默认值）。 */
  get config(): ResolvedConfig {
    return this.source()
  }

  /** The pwsh executable every command runs through. */
  /** 每条命令都会经由的 pwsh 可执行文件。 */
  get pwshPath(): string {
    return this.resolvedPwshPath
  }

  constructor(ctx: Context, config: Config) {
    super(ctx)
    // Schemastery fills these fields before construction; the type does not encode that step.
    // schemastery 在构造前已填好这些字段，但类型没有表达这一步骤，故需断言。
    const entry = config as ResolvedConfig
    assertServiceablePwshConfig(entry)
    this.source = () => entry
    this.declaredPwshPath = entry.pwshPath
    this.resolvedPwshPath = resolvePwshPath(entry.pwshPath)
    installSettingsSection(ctx, SHELL_SETTINGS_NAMESPACE, PwshLocalExecutor.Config, entry, {
      validate: assertServiceablePwshConfig,
      setSource: (current) => {
        this.source = current as () => ResolvedConfig
      },
      // Probing the filesystem is the one fact derived from the source: every
      // other field is read through the getter at each command.
      // 探测文件系统是从配置派生出的唯一事实；其它字段都在每次命令时经 getter 读取。
      onChange: () => {
        const declared = this.source().pwshPath
        if (declared === this.declaredPwshPath) return
        this.declaredPwshPath = declared
        this.resolvedPwshPath = resolvePwshPath(declared)
      },
    })
  }

  /**
   * Resolve a request into a fully-specified spec: fill `workdir` from
   * `config.cwd` (else `process.cwd()`), and `timeoutMs` from
   * `config.timeoutMs`, capped at `config.maxTimeoutMs`.
   */
  /**
   * 把请求解析为完全指定的规格：workdir 取自 config.cwd（否则 process.cwd()），timeoutMs
   * 取自 config.timeoutMs 并按 config.maxTimeoutMs 封顶。
   */
  resolve(request: ShellExecRequest): ShellExecSpec {
    const timeoutMs = clampTimeout(
      request.timeoutMs,
      this.config.timeoutMs,
      this.config.maxTimeoutMs,
      'pwsh-local: request.timeoutMs',
    )
    const stdoutMaxBytes = request.stdoutMaxBytes ?? this.config.maxOutputBytes
    assertPositiveFinite('request.stdoutMaxBytes', stdoutMaxBytes)
    return {
      command: request.command,
      workdir: request.workdir ?? this.config.cwd ?? process.cwd(),
      timeoutMs,
      stdoutMaxBytes,
      ...request.signal ? { signal: request.signal } : {},
      ...request.stdin !== undefined ? { stdin: request.stdin } : {},
      ...request.env !== undefined ? { env: request.env } : {},
      ...request.dshEnv !== undefined ? { dshEnv: request.dshEnv } : {},
      sandboxPolicy: request.sandboxPolicy,
    }
  }

  /**
   * The pwsh invocation argv for one resolved spec — the argv-level seam a
   * confining subclass wraps through `ctx.sandbox.confine` (the pwsh twin of
   * `dsh-bash-local`'s `runArgv`/`startArgv` hooks; see
   * `@deepseek-ai/dsh-pwsh-sandbox`).
   */
  /**
   * 一个已解析规格对应的 pwsh 调用 argv——这是 argv 级别的缝：受限子类通过
   * ctx.sandbox.confine 包装它（对应 bash-local 的 runArgv/startArgv 钩子，见
   * dsh-pwsh-sandbox）。注意编码前导被拼在 -Command 参数里，且整个命令是单个 argv 元素。
   */
  protected argv(spec: ShellExecSpec): string[] {
    return [this.pwshPath, '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', `${ENCODING_PREAMBLE}${spec.command}`]
  }

  /** Map one resolved spec plus its argv onto a fully-specified subprocess spawn. */
  /** 把一个已解析的规格与其 argv 映射为完全指定的子进程 spawn 请求。 */
  private spawnSpec(
    spec: ShellExecSpec,
    stdoutMaxBytes: number,
    signal: AbortSignal | undefined,
    argv: readonly string[],
  ): SubprocessSpawnSpec {
    // 每个输出流都配置内存上限与溢出文件上限。
    const collect = (maxBytes: number): SubprocessCollect =>
      ({ maxBytes, spill: { maxBytes: this.config.maxSpillBytes } })
    return {
      argv: [...argv],
      cwd: spec.workdir,
      stdio: {
        stdin: spec.stdin !== undefined ? { data: spec.stdin } : 'ignore',
        stdout: collect(stdoutMaxBytes),
        stderr: collect(this.config.maxOutputBytes),
      },
      graceMs: this.config.graceMs,
      signal,
      env: { ...ENV_OVERRIDES, ...spec.env, ...spec.dshEnv },
    }
  }

  /** The collect-mode readers the executor itself requested (present by construction). */
  /** 执行器自己请求的收集模式读取器（按构造必然存在，防御性断言）。 */
  private static collected(handle: SubprocessHandle): { stdout: SubprocessOutputReader; stderr: SubprocessOutputReader } {
    const { stdout, stderr } = handle.collected
    /* v8 ignore start -- collect dispositions expose both readers by the seam contract; defensive. */
    if (stdout === undefined || stderr === undefined) {
      throw new Error('pwsh-local: subprocess implementation dropped a requested collect stream')
    }
    /* v8 ignore stop */
    return { stdout, stderr }
  }

  /** 前台执行：命令以 pwsh -Command 形式运行。 */
  async run(spec: ShellExecSpec): Promise<ShellRunResult> {
    return this.runArgv(spec, this.argv(spec))
  }

  /** Foreground run of an exact argv (the confining subclass re-wraps it). */
  /**
   * 以显式 argv 运行前台命令（受限子类会重新包装 argv）。
   * @param spec 已解析的执行规格
   * @param argv 要交给 ctx.subprocess 的精确可执行文件与参数
   * @returns 已落定的前台结果，含收集的输出与原因事实
   */
  protected async runArgv(spec: ShellExecSpec, argv: readonly string[]): Promise<ShellRunResult> {
    // One deadline combines timeout and upstream cancellation; disposal clears its timer.
    // 单一截止时间同时驱动超时与上游取消；dispose 时清除其定时器。
    using d = deadline(spec.signal, spec.timeoutMs, 'BASH_TIMEOUT')
    const handle = this.ctx.subprocess.spawn(this.spawnSpec(spec, spec.stdoutMaxBytes, d.signal, argv))
    const outcome = await handle.done
    const collected = PwshLocalExecutor.collected(handle)
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

  /** 后台启动：命令以 pwsh -Command 形式运行。 */
  start(spec: ShellExecSpec): ShellProcess {
    return this.startArgv(spec, this.argv(spec))
  }

  /** Background start of an exact argv (the confining subclass re-wraps it). */
  /**
   * 以显式 argv 后台启动命令（受限子类会重新包装 argv）。
   * @param spec 已解析的执行规格
   * @param argv 要交给 ctx.subprocess 的精确可执行文件与参数
   * @returns 存活的进程句柄；spawn 被拒时以 killed 状态落定
   */
  protected startArgv(spec: ShellExecSpec, argv: readonly string[]): ShellProcess {
    // Background runs ignore timeoutMs; callers stop them through kill() or spec.signal.
    // 后台运行忽略 timeoutMs；调用方通过 kill() 或 spec.signal 停止它们。
    const running = this.ctx.subprocess.spawn(this.spawnSpec(spec, this.config.maxOutputBytes, spec.signal, argv))
    const collected = PwshLocalExecutor.collected(running)

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
   * The base implementation is intentionally empty. Mirrored from
   * `dsh-bash-local` (whose sandboxing subclass consumes the same hook); the
   * pwsh-confining consumer is `@deepseek-ai/dsh-pwsh-sandbox`.
   * @param _proc - the settled process handle.
   * @param _stderr - the process's retained stderr tail used by subclasses for settlement classification.
   * @param _spawnFailed - whether the spawn rejected before any process existed.
   * @param _spawnError - the spawn rejection, when `_spawnFailed`.
   */
  /**
   * 供子类挂接"给进程附加执行事实"的落定钩子。基类实现刻意为空；从 bash-local 镜像而来
   * （其沙箱子类消费同一钩子），本包的受限消费者是 dsh-pwsh-sandbox。
   * @param _proc 已落定的进程句柄
   * @param _stderr 进程保留的 stderr 尾部，供子类做落定分类
   * @param _spawnFailed 子进程 promise 是否在进程启动前就 reject 了
   * @param _spawnError spawn 拒绝原因（当 _spawnFailed 为真时）
   */
  protected onProcessDone(_proc: ShellProcess, _stderr: string, _spawnFailed: boolean, _spawnError?: unknown): void {}
}
/* jscpd:ignore-end */

export default PwshLocalExecutor
