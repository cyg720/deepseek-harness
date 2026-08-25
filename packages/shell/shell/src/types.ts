/**
 * ================================ 文件注释 ================================
 * 【文件职责】定义 bash 执行缝（capability seam）的全部类型：调用方请求（ShellExecRequest）、
 * 执行器解析后的规格（ShellExecSpec）、前台结果（ShellRunResult）、后台进程句柄
 * （ShellProcess）与沙箱事实（ShellSandboxInfo）。
 * 【技术维度】纯类型模块，仅含类型声明与少量 re-export；管理环境（DshEnvironment）与输出捕获
 * （CollectedOutput）词汇来自 subprocess 缝，在此再导出，让 bash 消费者只有一个导入根。
 * 【产品维度】这是"模型工具 / 插件 ↔ 执行器"之间的数据结构契约：工具提交的请求、执行器返回
 * 的结果、后台进程的读取接口都由此定型，展示层与钩子等调用方都依赖这些形状。
 * 【逻辑维度】re-export 子进程词汇 → 沙箱事实 → 请求 → 规格 → 前台结果 → 后台进程状态/读取/句柄。
 * 【关键边界】后台作业语义（job id、所有权、轮询、通知）归 dsh-jobs，本缝只暴露进程句柄；
 * 请求是"未解析"形状，必须先经 resolve() 得到规格才能交给执行器。
 * 【新手阅读建议】按"请求 → 规格 → 结果"的流向读：先看 ShellExecRequest 有哪些可选字段，
 * 再看 resolve 如何把它们补全为 ShellExecSpec，最后看 ShellRunResult 如何描述一次运行结局。
 * ==========================================================================
 */

/**
 * Execution types for the bash executor seam. Background job semantics belong
 * to `@deepseek-ai/dsh-jobs`; this seam exposes only process handles. The
 * managed-environment and captured-output vocabulary is owned by the
 * subprocess seam and re-exported here so bash consumers keep one import
 * root.
 * @module dsh-shell/types
 */

import type { SandboxEnforcement, SandboxExecutionPolicy, SandboxMode } from '@deepseek-ai/dsh-sandbox'
import type { CollectedOutput, DshEnvironment } from '@deepseek-ai/dsh-subprocess'

export { DSH_ENV_PREFIX } from '@deepseek-ai/dsh-subprocess'
export type { CollectedOutput, DshEnvironment, DshEnvironmentKey } from '@deepseek-ai/dsh-subprocess'

/**
 * Sandbox facts for one run, present iff a sandboxing executor handled it.
 * Facts are reported independently of process exit status so callers can
 * distinguish command failures from policy denials and runner failures.
 */
/*
 * 单次运行产生的沙箱事实，仅当沙箱执行器处理了这次运行时才存在。事实独立于进程退出码
 * 单独上报，这样调用方才能区分"命令本身失败"与"策略拒绝 / 运行器故障"两类情况。
 */
export interface ShellSandboxInfo {
  /** The mode the command actually ran under. */
  /* 命令实际运行时所处的沙箱模式。 */
  mode: SandboxMode
  /** Whether the sandbox denied a file operation. */
  /* 沙箱是否拒绝了一次文件操作（例如写入了策略禁止的路径）。 */
  denied: boolean
  /** How completely the selected runner enforced the requested mode. */
  /* 所选运行器对请求模式的实际执行完整度。 */
  enforcement?: SandboxEnforcement
  /** Whether the sandbox runner failed before the command could run. */
  /* 沙箱运行器是否在命令真正运行之前就失败了。 */
  runnerFailed?: boolean
}

/**
 * A caller's execution REQUEST: `workdir` and `timeoutMs` are optional and
 * filled by {@link ShellExecutor.resolve} from the implementation's config.
 * This is the model-/plugin-facing shape; pass it to `resolve()` to obtain a
 * fully-resolved {@link ShellExecSpec}.
 */
/*
 * 调用方的执行请求：workdir 与 timeoutMs 可选，由执行器的 resolve 依据自身配置补全。
 * 这是模型/插件面向的形状；先传给 resolve() 得到完全解析的 ShellExecSpec 才能执行。
 */
export interface ShellExecRequest {
  command: string
  /** Working directory override (default: implementation-configured). */
  /* 工作目录覆盖值，缺省用实现配置的目录。 */
  workdir?: string | undefined
  /** Timeout override in milliseconds (implementations cap it). */
  /* 前台超时毫秒数（实现会设上限钳制）。 */
  timeoutMs?: number | undefined
  /**
   * Foreground stdout capture budget in bytes. Absent uses the executor's
   * default output cap. Trusted in-process consumers use this when they must
   * parse complete stdout up to their own bounded limit; the model-facing bash
   * tool does not expose it as a parameter.
   */
  /*
   * 前台 stdout 捕获预算（字节）。缺省用执行器的默认输出上限。可信的进程内消费者
   * 在需要按自己的有界上限解析完整 stdout 时使用它；面向模型的 bash 工具不暴露此参数。
   */
  stdoutMaxBytes?: number | undefined
  /** Abort signal — implementations kill the command when it fires. */
  /* 中止信号：触发时实现会杀死命令。 */
  signal?: AbortSignal | undefined
  /**
   * Bytes to write to the command's stdin, then close it. Absent leaves stdin
   * closed/empty (the default for model-driven tool calls). Set by in-process
   * plugins (e.g. the hooks bridges, which write a hook command's JSON payload
   * to its stdin); the model-facing bash tool does not expose it as a parameter
   * (a model that needs stdin uses shell syntax like a heredoc or a pipe).
   */
  /*
   * 写入命令 stdin 的字节，写完即关闭。缺省保持 stdin 关闭/为空（模型驱动工具调用的
   * 默认情况）；由进程内插件设置（如 hooks 桥把钩子命令的 JSON 载荷写到 stdin）。
   */
  stdin?: string | undefined
  /**
   * Ordinary environment entries for the command, merged after the credential
   * scrub. Managed facts belong in {@link dshEnv}, which merges after this
   * map, so an entry here can never displace one. Set by in-process plugins
   * (the hooks bridges set `CLAUDE_PROJECT_DIR`, `CLAUDE_PLUGIN_ROOT`, …); the
   * model-facing bash tool does not expose it as a parameter.
   */
  /*
   * 命令的普通环境变量，在凭据擦除之后合并。托管事实应放进 dshEnv（在 env 之后合并，
   * 本映射中的条目无法覆盖它）。由进程内插件设置（hooks 桥设置 CLAUDE_PROJECT_DIR 等）。
   */
  env?: Record<string, string> | undefined
  /**
   * Harness-owned `DSH_*` variables for this execution (typed to managed
   * keys). Executors discard ambient `DSH_*` entries before merging this
   * snapshot last, so an unavailable current fact cannot inherit a stale
   * value from the harness process and a caller {@link env} entry cannot
   * displace a managed one.
   */
  /*
   * 本次执行由 harness 托管的 DSH_* 变量快照（按托管键类型化）。执行器先丢弃环境里残留的
   * DSH_* 条目，再最后合并这份快照，避免失效的当前事实继承陈旧值、也避免 env 覆盖托管值。
   */
  dshEnv?: DshEnvironment | undefined
  /** Fully resolved per-call sandbox policy; sandboxing executors default it. */
  /* 完全解析后的单次调用沙箱策略；沙箱执行器会为其补默认值。 */
  sandboxPolicy?: SandboxExecutionPolicy | undefined
}

/**
 * A resolved execution spec. {@link ShellExecutor.resolve} fills and caps the
 * required fields; {@link ShellExecutor.start} ignores `timeoutMs` because
 * background processes have no executor timeout.
 */
/*
 * 已解析的执行规格：resolve 负责填满并钳制必填字段；start 忽略 timeoutMs，
 * 因为后台进程没有执行器超时。
 */
export interface ShellExecSpec {
  command: string
  workdir: string
  timeoutMs: number
  /**
   * Resolved foreground stdout capture budget in bytes. `run()` uses it for
   * stdout; background jobs and stderr keep the executor's own output cap.
   */
  /*
   * 已解析的前台 stdout 捕获预算（字节）。run 用于 stdout；后台作业与 stderr
   * 仍用执行器自有的输出上限。
   */
  stdoutMaxBytes: number
  /** Abort signal — implementations kill the command when it fires. */
  /* 中止信号：触发时实现会杀死命令。 */
  signal?: AbortSignal | undefined
  /** Bytes to write to stdin before closing it; absent means no stdin. */
  /* 写入 stdin 的字节，写完即关闭；缺省表示无 stdin。 */
  stdin?: string | undefined
  /**
   * Ordinary environment entries carried through from
   * {@link ShellExecRequest.env}; {@link dshEnv} still merges after them.
   * OPTIONAL on the spec for the same reason as `stdin`: absent means no
   * ordinary extra environment.
   */
  /*
   * 从请求 env 原样带过来的普通环境变量；dshEnv 仍在其后合并。与 stdin 同理可选：
   * 缺省表示没有额外的普通环境。
   */
  env?: Record<string, string> | undefined
  /** Managed `DSH_*` snapshot (typed to managed keys); merges after {@link env}. */
  /* 托管的 DSH_* 快照（按托管键类型化）；在 env 之后合并。 */
  dshEnv?: DshEnvironment | undefined
  /** Resolved sandbox policy; ignored by executors that do not confine. */
  /* 已解析的沙箱策略；不实施隔离的执行器会忽略它。 */
  sandboxPolicy: SandboxExecutionPolicy | undefined
}

/** The outcome of one completed (or killed) foreground run. */
/* 一次已完成（或被终止）的前台运行的最终结果。 */
export interface ShellRunResult {
  /** Exit code; null when the process died from a signal. */
  /* 退出码；进程被信号杀死时为 null。 */
  exitCode: number | null
  /** Terminating signal (e.g. 'SIGTERM'); null on normal exit. */
  /* 终止信号（如 'SIGTERM'）；正常退出时为 null。 */
  signal: NodeJS.Signals | null
  /**
   * True when the executor's own timeout was the FIRST cause to cut the command
   * short. Mutually exclusive with {@link aborted}: one fused deadline drives
   * both the timeout and the caller's cancellation, so a timeout and an abort
   * racing before process close report the single first-abort cause, not both
   * (see the [timeout-library Agent Note](../../../../.agents/notes/implemented/architecture/2026-07-06-timeout-deadline-library.md)).
   */
  /*
   * 是否为执行器自身超时首先切断了命令。与 aborted 互斥：一个融合的截止时间同时驱动
   * 超时与调用方取消，因此超时与 abort 竞速时只报告最先发生的一种原因。
   */
  timedOut: boolean
  /**
   * True when the caller's `AbortSignal` was the FIRST cause to kill the command
   * (and it was not the executor's own timeout). Mutually exclusive with
   * {@link timedOut} — see there for the first-cause classification.
   */
  /*
   * 是否为调用方的 AbortSignal 首先杀死了命令（且不是执行器自身超时）。
   * 与 timedOut 互斥，首次原因分类见上。
   */
  aborted: boolean
  /** The effective timeout applied to this run (after defaulting/capping). */
  /* 本次运行实际生效的超时（经过默认值与上限钳制后）。 */
  timeoutMs: number
  /* 收集到的标准输出（截断时附溢出文件信息）。 */
  stdout: CollectedOutput
  /* 收集到的标准错误输出。 */
  stderr: CollectedOutput
  /** Sandbox execution facts, absent for an unsandboxed executor. */
  /* 沙箱执行事实；非沙箱执行器没有此字段。 */
  sandbox?: ShellSandboxInfo
}

/** Lifecycle of a background process. */
/* 后台进程的生命周期状态：运行中 / 已完成 / 已被杀死。 */
export type ShellProcessStatus = 'running' | 'completed' | 'killed'

/** One incremental {@link ShellProcess.readOutput} read. */
/* 一次增量式的 readOutput 读取结果。 */
export interface ShellProcessRead {
  /** Output produced since the previous read (stderr in a marked section). */
  /* 自上次读取以来新产生的输出（stderr 放在带标记的分区里）。 */
  delta: string
  /** True when truncation dropped unread bytes the delta cannot include. */
  /* 是否因截断丢弃了未被读到的字节（delta 无法包含它们）。 */
  lossy: boolean
  /** Full stdout spill file, when stdout truncation occurred and a safe path is available. */
  /* 发生 stdout 截断且有安全路径时的完整 stdout 溢出文件。 */
  stdoutSpillPath?: string
  /** Full stderr spill file, when stderr truncation occurred and a safe path is available. */
  /* 发生 stderr 截断且有安全路径时的完整 stderr 溢出文件。 */
  stderrSpillPath?: string
}

/**
 * A background process handle returned by {@link ShellExecutor.start}. It is the
 * only access path; buffered output remains readable after exit. Composition
 * teardown (the subprocess service's disposal) kills running processes and
 * awaits {@link done}; an executor-only reload leaves them running.
 */
/*
 * start 返回的后台进程句柄，也是访问该进程的唯一通道；缓冲的输出在进程退出后仍可读取。
 * 组合体拆解（子进程服务释放）时会杀死运行中的进程并等待 done；仅重载执行器则进程继续存活。
 */
export interface ShellProcess {
  /** Process lifecycle state (settled exactly once). */
  /* 进程生命周期状态（只会落定一次）。 */
  status: ShellProcessStatus
  /** Exit code once finished (null = killed by signal / still running). */
  /* 结束后才有值的退出码（null = 被信号杀死 / 仍在运行）。 */
  exitCode: number | null
  /** Terminating signal name, when signal-killed. */
  /* 被信号杀死时的终止信号名。 */
  signal: NodeJS.Signals | null
  /** Resolves when the underlying process closes (never rejects — a spawn failure settles as `killed` with the error on stderr). */
  /* 底层进程关闭时 resolve（永不 reject；启动失败以 killed 落定，错误写入 stderr）。 */
  readonly done: Promise<void>
  /** Sandbox facts, stamped once a confined process settles. */
  /* 沙箱事实，受限进程落定后写入。 */
  sandbox?: ShellSandboxInfo
  /**
   * Read output produced since the previous read (consuming — consecutive
   * reads never re-deliver). Reads that lost data flag `lossy` and point at
   * full-stream spill files when available.
   */
  /*
   * 读取自上次以来新产生的输出（消耗式：连续读取不会重复交付；丢数据的读取会标 lossy
   * 并尽量给出完整流的溢出文件路径）。
   */
  readOutput(): ShellProcessRead
  /**
   * Kill the process group. Returns false when it had already finished
   * (no-op); idempotent.
   */
  /*
   * 杀死整个进程组；进程已结束时返回 false（空操作）。幂等，可重复调用。
   */
  kill(): boolean
}
