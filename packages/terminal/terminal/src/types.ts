/**
 * ================================ 文件注释 ================================
 * 【文件职责】PTY 后端、owner 级注册表与工具消费者共享的类型：会话身份（品牌类型）、
 * 请求/结果形状、发送操作句柄、滚动区读取、信号结果与后端/会话接口。运行时服务代码
 * 在 index.ts。
 * 【技术维度】纯类型模块（含 TerminalBackendCleanupError 错误类与几个联合类型）；
 * TerminalSessionIdValue 是品牌类型（dsh-brand），跨包边界不裸传字符串。
 * 【产品维度】持久化终端能力的统一契约：任意 PTY 后端（bash/pwsh/node-pty/远程）都
 * 实现 TerminalBackend，注册表按 owner 授权，工具消费者只依赖这些形状。
 * 【逻辑维度】会话身份 → 等待原因/信号/状态联合 → 请求与结果接口 → 发送操作句柄 →
 * 滚动区读取 → 后端接口 → 发布结果。
 * 【关键边界】每 PTY 会话同时最多一个活跃发送；sessionId 品牌化防混淆；TerminalSignal
 * 与 dsh-subprocess 的 SubprocessTerminalSignal 成员一致（无跨缝依赖，需同步改）。
 * 【新手阅读建议】先读 TerminalBackend 与 TerminalBackendSession（后端的两个接口），
 * 再看 TerminalSendOperation/TerminalSendResult（一次交互等待的形状），最后看
 * TerminalSpawnSpec 的发布契约。
 * ==========================================================================
 */

/**
 * Types shared by PTY backends, the owner-scoped registry, and tool consumers.
 * Runtime service code lives in `./index.ts`.
 * @module @deepseek-ai/dsh-terminal/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { Agent } from '@deepseek-ai/dsh-agent'

/** Internal exported basis for the public `TerminalSessionId` type/value pair. */
/** 公开的 TerminalSessionId 类型/值对的内部导出基底。 */
export type TerminalSessionIdValue = Branded<'TerminalSessionId'>

/**
 * Backend-reported failure to clean partial resources after unpublished setup failed.
 * @param spawnError - original setup or cancellation failure.
 * @param cleanupError - failure that may leave backend-owned resources alive.
 */
/**
 * 后端上报的"未发布设置失败后清理部分资源也失败"错误。
 * @param spawnError 原始设置或取消失败
 * @param cleanupError 可能让后端自有资源继续存活于世的清理失败
 */
export class TerminalBackendCleanupError extends AggregateError {
  constructor(
    readonly spawnError: unknown,
    readonly cleanupError: unknown,
  ) {
    super([spawnError, cleanupError], 'PTY backend startup and cleanup both failed')
    this.name = 'TerminalBackendCleanupError'
  }
}

/** Why one interactive send returned control to its caller. */
/** 一次交互式发送把控制权交还调用方的原因。 */
export type TerminalWaitReason = 'stdin_read' | 'inferred_idle' | 'timeout' | 'session_exit'

/**
 * Signals the model-facing PTY surface permits for foreground process groups.
 * Kept member-identical to `SubprocessTerminalSignal` in
 * `@deepseek-ai/dsh-subprocess` without a cross-seam dependency; change both together.
 */
/**
 * 模型面向的 PTY 表面对前台进程组允许的信号。与 dsh-subprocess 中的
 * SubprocessTerminalSignal 成员一致，但不建立跨缝依赖；两处要一起改。
 */
export type TerminalSignal = 'SIGINT' | 'SIGTERM' | 'SIGKILL' | 'SIGTSTP' | 'SIGHUP'

/** Top-level PTY process status, independent of a send's wait reason. */
/** 顶层 PTY 进程状态，独立于一次发送的等待原因。 */
export type TerminalSessionStatus =
  | { kind: 'running' }
  | { kind: 'exited'; exitCode: number | null; signal: NodeJS.Signals | null }

/** Request to create one owner-scoped PTY session. */
/** 创建一个 owner 级 PTY 会话的请求。 */
export interface TerminalSpawnRequest {
  /** Registered backend type. */
  /** 已注册的后端类型。 */
  type: string
  /** Optional owner-local display name. */
  /** 可选的 owner 本地显示名。 */
  name?: string
  /** Optional initial working directory interpreted by the backend. */
  /** 可选初始工作目录，由后端解释。 */
  cwd?: string
}

/** Fully identified request handed from the registry to a backend. */
/** 注册表交给后端的完全标识请求。 */
export interface TerminalBackendSpawnSpec extends TerminalSpawnRequest {
  /** Registry-minted session identity. */
  /** 注册表铸造的会话身份。 */
  sessionId: TerminalSessionIdValue
  /** Exact live owner for authority-aware backend setup. */
  /** 供权限感知后端设置使用的精确存活 owner。 */
  owner: Agent
  /** Cancellation of unpublished backend setup. */
  /** 未发布后端设置的取消。 */
  signal?: AbortSignal
}

/** Input for one line-oriented terminal interaction. */
/** 一次面向行的终端交互输入。 */
export interface TerminalSendRequest {
  /** UTF-8 text to write. */
  /** 要写入的 UTF-8 文本。 */
  text: string
  /** Whether to write the backend's Enter sequence after {@link text}. */
  /** 是否在 text 之后写入后端的回车序列。 */
  submit: boolean
  /** Cancellation for the wait; backends also interrupt the foreground command. */
  /** 等待的取消；后端同时中断前台命令。 */
  signal?: AbortSignal
}

/** Incremental output consumed from one live send operation. */
/** 从一次存活发送操作消费的增量输出。 */
export interface TerminalSendRead {
  /** Output produced since the previous operation read. */
  /** 自上次操作读取以来产生的输出。 */
  delta: string
  /** Whether unread operation output was dropped by the backend's bound. */
  /** 未读操作输出是否被后端上限丢弃。 */
  truncated: boolean
}

/** Settled result for one foreground or background send. */
/** 一次前台或后台发送的落定结果。 */
export interface TerminalSendResult {
  /** Bounded rendered terminal delta remaining at settlement. */
  /** 落定时剩余的有界渲染终端增量。 */
  viewport: string
  /** Why the wait returned; this does not imply arbitrary child-process exit. */
  /** 等待为何返回；这不暗示任意子进程已退出。 */
  waitReason: TerminalWaitReason
  /** Top-level session status observed at settlement. */
  /** 落定时观察到的顶层会话状态。 */
  sessionStatus: TerminalSessionStatus
  /** Whether output was dropped from the operation or retained scrollback. */
  /** 输出是否从操作或保留滚动区被丢弃。 */
  truncated: boolean
}

/** Live backend-owned send; exactly one may be active per PTY session. */
/** 后端拥有的存活发送；每个 PTY 会话同时最多一个活跃。 */
export interface TerminalSendOperation {
  /** Resolves after readiness, timeout, cancellation, or top-level process exit. */
  /** 在就绪、超时、取消或顶层进程退出后 resolve。 */
  done: Promise<TerminalSendResult>
  /** Consume output produced since the prior call. */
  /** 消费自上次调用以来产生的输出。 */
  readOutput(): TerminalSendRead
  /** Request `SIGINT`; returns false after the operation settled. */
  /** 请求 SIGINT；操作落定后返回 false。 */
  cancel(): boolean
}

/** Request for one backward scrollback page. */
/** 向后翻一页滚动区的请求。 */
export interface TerminalReadRequest {
  /** Offset from the newest retained line; defaults are backend-owned. */
  /** 距最新保留行的偏移；默认值归后端。 */
  offset?: number
  /** Requested line count; backend limits still apply. */
  /** 请求的行数；后端上限仍生效。 */
  count?: number
}

/** Bounded scrollback page. */
/** 有界滚动区页。 */
export interface TerminalReadResult {
  /** Retained text in chronological order. */
  /** 按时间顺序保留的文本。 */
  text: string
  /** Number of lines currently retained. */
  /** 当前保留的行数。 */
  totalLines: number
  /** Inclusive newest-relative offset of the first returned line. */
  /** 首个返回行的包含式最新相对偏移。 */
  lineBegin: number
  /** Exclusive newest-relative offset after the returned page. */
  /** 返回页之后的排他式最新相对偏移。 */
  lineEnd: number
  /** Whether older retained output or the requested result exceeded a bound. */
  /** 更早的保留输出或请求结果是否超过上限。 */
  truncated: boolean
}

/** Result of delivering a signal to a verified foreground process group. */
/** 向已验证的前台进程组投递信号的结果。 */
export interface TerminalSignalResult {
  /** True only after the backend delivered the signal. */
  /** 仅当后端已投递信号时为 true。 */
  delivered: true
  /** Process group that received the signal. */
  /** 收到信号的进程组。 */
  targetPgid: number
}

/** Owner-visible summary of one published PTY session. */
/** 一个已发布 PTY 会话的 owner 可见摘要。 */
export interface TerminalSessionSnapshot {
  /** Registry-minted identity used by every operation. */
  /** 每次操作使用的注册表铸造身份。 */
  sessionId: TerminalSessionIdValue
  /** Optional owner-local display name. */
  /** 可选的 owner 本地显示名。 */
  name?: string
  /** Backend type that created the session. */
  /** 创建会话的后端类型。 */
  type: string
  /** Top-level process id when the backend has one. */
  /** 后端有时顶层进程 id。 */
  pid?: number
  /** Current top-level process status. */
  /** 当前顶层进程状态。 */
  status: TerminalSessionStatus
}

/** Backend-owned live session retained by {@link TerminalSessionService}. */
/** 由 TerminalSessionService 保留的后端自有存活会话。 */
export interface TerminalBackendSession {
  /** Initial bounded terminal output returned from `terminal_open`. */
  /** terminal_open 返回的初始有界终端输出。 */
  readonly motd: string
  /** Top-level process id when one exists. */
  /** 存在时顶层进程 id。 */
  readonly pid?: number
  /** Start one exclusive send operation. */
  /** 启动一个排他发送操作。 */
  startSend(request: TerminalSendRequest): TerminalSendOperation
  /** Read one bounded page from retained scrollback. */
  /** 从保留滚动区读一页有界内容。 */
  read(request: TerminalReadRequest): TerminalReadResult
  /** Signal the verified foreground process group. */
  /** 给已验证的前台进程组发信号。 */
  signal(signal: TerminalSignal): Promise<TerminalSignalResult>
  /** Observe top-level process status. */
  /** 观察顶层进程状态。 */
  status(): TerminalSessionStatus
  /** Idempotently close the captured owned process tree and await quiescence. */
  /** 幂等地关闭捕获的受管进程树并等待静默。 */
  close(reason: string): Promise<void>
}

/** Replaceable provider for one PTY session type. */
/** 一种 PTY 会话类型的可替换提供者。 */
export interface TerminalBackend {
  /** Stable type selected by {@link TerminalSpawnRequest.type}. */
  /** 由 TerminalSpawnRequest.type 选择的稳定类型。 */
  readonly type: string
  /** Create an unpublished session or reject after cleaning partial resources; cleanup failure uses {@link TerminalBackendCleanupError}. */
  /** 创建未发布会话，或在清理部分资源后拒绝；清理失败用 TerminalBackendCleanupError。 */
  spawn(spec: TerminalBackendSpawnSpec): Promise<TerminalBackendSession>
}

/** Successful publication returned by {@link TerminalSessionService.spawn}. */
/** TerminalSessionService.spawn 成功发布时返回的结果。 */
export interface TerminalSpawnResult extends TerminalSessionSnapshot {
  /** Initial bounded output captured before publication. */
  /** 发布前捕获的初始有界输出。 */
  motd: string
}
