/**
 * ================================ 文件注释 ================================
 * 【文件职责】定义子进程 Service Definition 的词汇：完全指定的 spawn 请求（按 Node 形状
 * 的逐流 stdio）、有界收集输出与溢出恢复、原始管道流、进程树范围终止，以及终端进程原语。
 * 【技术维度】纯类型模块（仅一个 DSH_ 前缀常量）；所有 stdio 配置显式、无默认值；
 * 收集读取器基于整流字节偏移、非消耗式；终止语义按进程树。
 * 【产品维度】bash/pwsh 执行器与 PTY 会话的共同底层契约：输出不会无限占内存
 * （溢出落盘）、辅助进程不会脱离管控（树范围终止）、凭据不会泄漏（擦除在 index.ts）。
 * 【逻辑维度】DSH_* 命名空间常量 → 收集输出 → stdio 配置 → spawn 规格 → 退出事实 →
 * 偏移读取器 → 进程句柄 → 终端原语类型。
 * 【关键边界】命令默认值、shell 语义、协议帧与展示归消费者（如 bash 执行缝）；
 * 本缝不解释 argv（绝不经过 shell）；terminate 是唯一终止动词。
 * 【新手阅读建议】先读 SubprocessSpawnSpec 与 SubprocessHandle 这对"请求/句柄"，
 * 再读 SubprocessOutputReader 理解偏移读取语义，最后读终端原语类型。
 * ==========================================================================
 */

/**
 * Vocabulary for the subprocess Service Definition: fully-specified spawn requests with
 * Node-shaped per-stream stdio modes, bounded collected output with spill
 * recovery, raw piped streams, and tree-scoped termination. Command
 * defaulting, shell semantics, protocol framing, and presentation belong to
 * consumers such as the bash executor seam.
 * @module dsh-subprocess/types
 */

import type { Readable, Writable } from 'node:stream'

/** Namespace prefix reserved for DeepSeek Harness-managed child environment facts. */
/* 保留给 DeepSeek Harness 受管子进程环境事实的命名空间前缀（DSH_）。 */
export const DSH_ENV_PREFIX = 'DSH_' as const

/** One environment key inside the managed {@link DSH_ENV_PREFIX} namespace. */
/* 受管 DSH_ 命名空间内的一个环境键（以 DSH_ 开头的字符串）。 */
export type DshEnvironmentKey = `${typeof DSH_ENV_PREFIX}${string}`

/** Trusted DeepSeek Harness variables for one child-process execution. */
/* 一次子进程执行的受信 DeepSeek Harness 变量（只读映射）。 */
export type DshEnvironment = Readonly<Record<DshEnvironmentKey, string>>

/** One captured stream: the (possibly truncated) text plus recovery info. */
/* 一个已捕获的流：可能被截断的文本加恢复信息。 */
export interface CollectedOutput {
  /** Collected text — the TAIL of the stream when truncated. */
  /* 收集到的文本——被截断时是流的尾部。 */
  text: string
  /** True when bytes were dropped from `text`. */
  /* 是否有字节从 text 中被丢弃。 */
  truncated: boolean
  /** Path to a file holding the COMPLETE stream, when truncated and available. */
  /* 截断且可用时，持有完整流的溢出文件路径。 */
  spillPath?: string
}

/**
 * stdin disposition. `'ignore'` leaves fd 0 on `/dev/null`; `'pipe'` exposes
 * {@link SubprocessHandle.stdin} for the caller's ongoing protocol writes;
 * `{ data }` writes the bytes and closes (the batch shape).
 */
/*
 * stdin 配置。'ignore' 把 fd 0 接到 /dev/null；'pipe' 暴露 SubprocessHandle.stdin
 * 供调用方持续做协议写入；`{ data }` 写入字节后关闭（批量形状）。
 */
export type SubprocessStdinMode = 'ignore' | 'pipe' | { readonly data: string }

/**
 * Bounded in-memory collection for one output stream, with an optional
 * full-stream spill file. Omitting `spill` keeps only the in-memory tail —
 * the diagnostic-tail shape (a language server's stderr); including it makes
 * the complete stream recoverable up to its cap (the bash tool shape).
 */
/*
 * 单个输出流的有界内存收集，带可选的全流溢出文件。省略 spill 只保留内存尾部——
 * 诊断尾部形状（如语言服务器的 stderr）；包含 spill 则在预算内可恢复完整流
 * （bash 工具形状）。
 */
export interface SubprocessCollect {
  /** In-memory cap in bytes; overflow keeps the TAIL. */
  /* 内存上限（字节）；溢出只保留尾部。 */
  maxBytes: number
  /** Full-stream spill file; absent disables spilling entirely. */
  /* 全流溢出文件；缺省表示完全不落盘。 */
  spill?: {
    /** Whole-stream byte cap; a larger stream discards its now-incomplete spill. */
    /* 整流字节上限；更大的流会丢弃已不完整的溢出文件。 */
    maxBytes: number
  }
}

/**
 * stdout/stderr disposition. `'pipe'` exposes the raw `Readable` for the
 * caller's protocol decoding; `'inherit'` passes the parent's descriptor
 * through (child diagnostics land on the harness's own stream); a
 * {@link SubprocessCollect} object buffers boundedly with offset-based reads.
 */
/*
 * stdout/stderr 配置。'pipe' 暴露原始 Readable 供调用方做协议解码；'inherit' 透传
 * 父进程的描述符（子进程诊断落到 harness 自己的流上）；SubprocessCollect 对象以
 * 偏移读取做有界缓冲。
 */
export type SubprocessOutputMode = 'pipe' | 'inherit' | SubprocessCollect

/** Per-stream stdio dispositions, all explicit — this seam applies no defaults. */
/* 逐流 stdio 配置，全部显式——本缝不应用任何默认值。 */
export interface SubprocessStdio {
  stdin: SubprocessStdinMode
  stdout: SubprocessOutputMode
  stderr: SubprocessOutputMode
}

/**
 * A fully-specified spawn request. This seam applies no defaults: every
 * disposition, limit, and directory is explicit, so the caller's own config —
 * not a hidden subprocess-service default — decides them (the `dsh-shell`
 * request/spec split is the owning template).
 */
/*
 * 完全指定的 spawn 请求。本缝不应用默认值：每个配置、上限与目录都显式，
 * 由调用方自己的配置决定，而非隐藏的子进程服务默认值。
 */
export interface SubprocessSpawnSpec {
  /** Executable and arguments; `argv[0]` is the program. Never shell-interpreted here. */
  /* 可执行文件与参数；argv[0] 是程序。此处绝不经过 shell 解释。 */
  argv: readonly string[]
  /** Working directory for the child. */
  /* 子进程的工作目录。 */
  cwd: string
  /** Per-stream stdio dispositions. */
  /* 逐流 stdio 配置。 */
  stdio: SubprocessStdio
  /**
   * Positive finite grace period in milliseconds, no greater than
   * `MAX_TIMER_DELAY_MS`, for the {@link SubprocessHandle.terminate} escalation
   * and for draining still-open collected pipes after the process exits (an
   * inherited descriptor held by a surviving descendant cannot hold the
   * outcome open indefinitely).
   */
  /*
   * 正有限宽限期（毫秒），不超过 MAX_TIMER_DELAY_MS；用于 terminate 的终止升级，
   * 也用于进程退出后排空仍打开的收集管道（幸存后代持有的继承描述符不能无限期
   * 撑开结果）。
   */
  graceMs: number
  /**
   * Abort signal — starts the terminate escalation on the process tree when
   * it fires. The caller owns deadlines and cause classification; this seam
   * only reacts to the abort.
   */
  /*
   * 中止信号——触发时对进程树启动终止升级。截止时间与原因分类归调用方；
   * 本缝只对 abort 作出反应。
   */
  signal?: AbortSignal | undefined
  /**
   * Explicit environment entries merged onto the implementation's scrubbed
   * parent base (see `scrubbedParentEnv`), with no namespace validation. A
   * string is a deliberate caller opt-in, so a forwarded credential-shaped
   * entry or current `DSH_*` fact survives the scrub; `undefined` is a
   * tombstone that removes an ordinary ambient entry from the child.
   */
  /*
   * 合并到实现擦除过的父环境基线上的显式环境条目（见 scrubbedParentEnv），
   * 不做命名空间校验。字符串是调用方的刻意选择，因此转发的凭据形状条目或当前
   * DSH_* 事实能穿过擦除；undefined 是墓碑，把子进程中的某个普通环境条目删除。
   */
  env?: NodeJS.ProcessEnv | undefined
}

/**
 * Exit facts of one closed process — Node's `close`-event vocabulary.
 * Deliberately carries NO timeout or cancellation classification (the caller
 * reads the signal it owns to classify causes) and NO output: collected
 * streams stay readable through {@link SubprocessHandle.collected} after
 * settlement, so batch and streaming callers share one access path.
 */
/*
 * 一个已关闭进程的退出事实——Node 的 close 事件词汇。刻意不携带超时或取消分类
 * （调用方读自己拥有的信号来分类原因），也不携带输出：收集流在落定后仍经
 * SubprocessHandle.collected 可读，批处理与流式调用方共享同一访问路径。
 */
export interface SubprocessOutcome {
  /** Exit code; null when the process died from a signal. */
  /* 退出码；进程被信号杀死时为 null。 */
  exitCode: number | null
  /** Terminating signal (e.g. 'SIGTERM'); null on normal exit. */
  /* 终止信号（如 'SIGTERM'）；正常退出时为 null。 */
  signal: NodeJS.Signals | null
}

/** One incremental {@link SubprocessOutputReader.readFrom} read. */
/* 一次增量式的 readFrom 读取结果。 */
export interface SubprocessOutputRead {
  /** Stream text from the requested offset (the whole retained tail when lossy). */
  /* 从请求偏移开始的流文本（lossy 时是保留的整个尾部）。 */
  text: string
  /** Whole-stream offset to resume from on the next read. */
  /* 下次读取要续接的整流偏移。 */
  nextOffset: number
  /** True when the requested offset slid out of the in-memory tail window. */
  /* 请求的偏移是否已滑出内存尾部窗口。 */
  lossy: boolean
  /** Path to the full-stream spill file, when one was created and remains intact. */
  /* 溢出文件已创建且完好时的完整流溢出文件路径。 */
  spillPath?: string
}

/**
 * Cursor-free incremental access to one collected output stream. Offsets are
 * whole-stream byte coordinates owned by the caller, so independent readers
 * cannot consume one another's output; `readFrom(0)` after settlement is the
 * batch result (`lossy` then means the in-memory tail lost its head — the
 * {@link CollectedOutput.truncated} fact).
 */
/*
 * 对单个收集输出流的无游标增量访问。偏移是调用方拥有的整流字节坐标，因此独立的
 * 读者不会互相消费输出；落定后 readFrom(0) 就是批处理结果（此时 lossy 表示内存尾部
 * 丢了头部——即 CollectedOutput.truncated 事实）。
 */
export interface SubprocessOutputReader {
  /**
   * Read everything captured since `fromByte`. When that offset has slid out
   * of the in-memory tail window the read is `lossy` — it returns the whole
   * retained tail and the gap is only recoverable from the spill file.
   * @param fromByte - whole-stream offset to resume from (a prior read's `nextOffset`; 0 for the first read).
   * @returns the delta text, the next offset, the `lossy` flag, and the spill path when one exists.
   */
  /*
   * 读取自 fromByte 以来捕获的全部内容。该偏移滑出内存尾部窗口时读取是 lossy 的——
   * 返回整个保留尾部，缺口只能从溢出文件恢复。
   * @param fromByte 要续接的整流偏移（上次读取的 nextOffset；首次读取为 0）
   * @returns 增量文本、下一偏移、lossy 标志与（存在时的）溢出文件路径
   */
  readFrom(fromByte: number): SubprocessOutputRead
}

/** Offset-based readers for the streams spawned in collect mode. */
/* 收集模式 spawn 的流对应的偏移读取器。 */
export interface SubprocessCollectedOutputs {
  /** Present iff stdout is a {@link SubprocessCollect}. */
  /* 仅当 stdout 是 SubprocessCollect 时存在。 */
  readonly stdout?: SubprocessOutputReader
  /** Present iff stderr is a {@link SubprocessCollect}. */
  /* 仅当 stderr 是 SubprocessCollect 时存在。 */
  readonly stderr?: SubprocessOutputReader
}

/**
 * A live child process rooted in its own process tree. Collected output
 * remains readable after exit; piped streams belong to the caller.
 *
 * Termination is tree-scoped everywhere: POSIX signals the detached process
 * group (falling back to the direct child when the group is gone), Windows
 * terminates the tree via `taskkill /T`, so helper processes cannot outlive
 * the handle unnoticed.
 */
/*
 * 扎根于自身进程树的存活子进程。收集输出在退出后仍可读；管道流归调用方。
 *
 * 终止处处按进程树范围：POSIX 给分离的进程组发信号（组消失时回退到直接子进程），
 * Windows 经 `taskkill /T` 终止整树——辅助进程无法在句柄之外悄然存活。
 */
export interface SubprocessHandle {
  /** Process id (tree root); -1 when the spawn itself failed. */
  /* 进程 id（树根）；spawn 本身失败时为 -1。 */
  readonly pid: number
  /** The child's stdin, present iff spawned with `stdin: 'pipe'`. */
  /* 子进程的 stdin；仅当以 stdin: 'pipe' spawn 时存在。 */
  readonly stdin: Writable | undefined
  /** The child's raw stdout, present iff spawned with `stdout: 'pipe'`. */
  /* 子进程的原始 stdout；仅当以 stdout: 'pipe' spawn 时存在。 */
  readonly stdout: Readable | undefined
  /** The child's raw stderr, present iff spawned with `stderr: 'pipe'`. */
  /* 子进程的原始 stderr；仅当以 stderr: 'pipe' spawn 时存在。 */
  readonly stderr: Readable | undefined
  /** Offset-based readers for collect-mode streams (also readable after exit). */
  /* 收集模式流的偏移读取器（退出后也可读）。 */
  readonly collected: SubprocessCollectedOutputs
  /** Resolves at process close with exit facts; rejects only for spawn-level failures. */
  /* 进程关闭时以退出事实 resolve；仅对 spawn 级失败 reject。 */
  readonly done: Promise<SubprocessOutcome>
  /**
   * Begin the SIGTERM → `graceMs` → SIGKILL escalation on the process tree
   * (Windows force-terminates immediately) — the seam's only termination
   * verb. Idempotent, a no-op once the tree is gone (the pid may be reused),
   * and also triggered by the spec's abort signal.
   */
  /*
   * 对进程树启动 SIGTERM → graceMs → SIGKILL 升级（Windows 立即强制终止）——
   * 本缝唯一的终止动词。幂等，树消失后为空操作（pid 可能被复用），
   * 规格的 abort 信号也会触发它。
   */
  terminate(): void
  /**
   * Wait until the process tree has exited — the tree, not just the direct
   * child, so a still-running helper is observable before teardown returns.
   * @param signal - optional bound for the wait.
   * @returns `true` when the tree exited, `false` when the signal aborted first.
   */
  /*
   * 等待进程树退出——是整树而非仅直接子进程，因此拆解返回前仍运行的辅助进程
   * 是可见的。
   * @param signal 可选的等待上限
   * @returns 树已退出返回 true；信号先中止返回 false
   */
  waitForExit(signal?: AbortSignal): Promise<boolean>
}

/**
 * Signals supported by the terminal-process primitive. Kept member-identical
 * to `TerminalSignal` in `@deepseek-ai/dsh-terminal` without a cross-seam dependency;
 * change both together.
 */
/*
 * 终端进程原语支持的信号。与 dsh-terminal 中的 TerminalSignal 保持成员一致，
 * 但不建立跨缝依赖；两处要一起改。
 */
export type SubprocessTerminalSignal = 'SIGINT' | 'SIGTERM' | 'SIGKILL' | 'SIGTSTP' | 'SIGHUP'

/** A fully specified terminal-process spawn. */
/* 完全指定的终端进程 spawn。 */
export interface SubprocessTerminalSpawnSpec {
  /** Executable and arguments; `argv[0]` is the program. */
  /* 可执行文件与参数；argv[0] 是程序。 */
  argv: readonly string[]
  /** Working directory in this subprocess provider's execution world. */
  /* 在该子进程提供者执行世界中的工作目录。 */
  cwd: string
  /** Explicit environment layered after the provider's ambient scrub. */
  /* 在提供者环境擦除之后叠加的显式环境。 */
  env?: Record<string, string> | undefined
  /** Initial terminal row count. */
  /* 终端初始行数。 */
  rows: number
  /** Initial terminal column count. */
  /* 终端初始列数。 */
  cols: number
  /** TERM-to-KILL cleanup grace for the complete terminal session. */
  /* 整个终端会话的 TERM→KILL 清理宽限期。 */
  graceMs: number
  /** Cancellation of terminal allocation; a published handle owns its later lifetime. */
  /* 终端分配阶段的取消；已发布的句柄自行拥有其后续生命周期。 */
  signal?: AbortSignal | undefined
}

/** Current foreground process-group facts for one terminal. */
/* 一个终端的当前前台进程组事实。 */
export interface SubprocessTerminalForeground {
  /** Foreground process-group id published by the terminal driver. */
  /* 终端驱动发布的前台进程组 id。 */
  processGroupId: number
  /** Whether the provider can currently prove that group is waiting on terminal input. */
  /* 提供者当前能否证明该组正在等待终端输入。 */
  inputWaiting: boolean
}

/**
 * One live terminal process and its owned OS session. Terminal allocation,
 * foreground-group inspection/signalling, and session-tree cleanup are one
 * deep subprocess primitive because none can be reconstructed from ordinary
 * piped stdio without substrate-specific process control.
 */
/*
 * 一个存活的终端进程及其拥有的 OS 会话。终端分配、前台组检查/发信号、会话树清理
 * 是同一个深层子进程原语，因为没有底层特有的进程控制，这些都无法从普通管道 stdio
 * 重建。
 */
export interface SubprocessTerminalHandle {
  /** Top-level terminal process id. */
  /* 顶层终端进程 id。 */
  readonly pid: number
  /** UTF-8 terminal output bytes in delivery order; ends after queued output when the terminal exits. */
  /* 按投递顺序的 UTF-8 终端输出字节；终端退出后队列输出完即结束。 */
  readonly output: Readable
  /** Resolves when the top-level process exits; rejects only for a live transport failure. */
  /* 顶层进程退出时 resolve；仅对活跃传输失败 reject。 */
  readonly done: Promise<SubprocessOutcome>
  /**
   * Write text to the terminal input.
   * @param data - text to deliver without implicit newline conversion.
   */
  /*
   * 向终端输入写入文本。
   * @param data 要投递的文本，不做隐式换行转换
   */
  write(data: string): Promise<void>
  /**
   * Inspect the current foreground process group.
   * @returns its id and input-wait fact, or undefined when no foreground group can be resolved.
   */
  /*
   * 检查当前前台进程组。
   * @returns 其 id 与输入等待事实；无法解析前台组时为 undefined
   */
  inspectForeground(): Promise<SubprocessTerminalForeground | undefined>
  /**
   * Deliver a signal to the current foreground process group.
   * @param signal - permitted terminal signal.
   * @returns the exact group id that received it.
   */
  /*
   * 给当前前台进程组投递一个信号。
   * @param signal 允许的终端信号
   * @returns 实际收到信号的组 id
   */
  signalForeground(signal: SubprocessTerminalSignal): Promise<number>
  /**
   * Idempotently terminate every terminal-session member the provider can still observe and await quiescence.
   * After settlement, no write, inspection, or signal call remains in flight.
   * Providers document substrate-specific observability limits.
   */
  /*
   * 幂等地终止提供者仍能观测到的每个终端会话成员并等待静默。
   * 落定后不再有任何 write/检查/信号调用在途；提供者应记录底层特有的可观测性限制。
   */
  terminate(): Promise<void>
}
