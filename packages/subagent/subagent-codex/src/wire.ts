/**
 * Minimal Codex app-server 0.147.0 protocol adapter. The shared JSON-RPC
 * transport owns framing and request correlation; this module owns only the
 * product methods, current thread/turn association, unattended approval
 * responses, and terminal-answer selection.
 *
 * @module @deepseek-ai/dsh-subagent-codex/wire
 */
/*
 * 文件职责：实现 wire.ts 覆盖的子代理启动、协议、继承与生命周期行为。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、进程协议或同进程代理驱动。
 * 产品维度：保障 Agent 能可靠委派任务、继承上下文并收集子代理结果。
 * 逻辑维度：准备代理配置，启动或连接子代理，转发事件，再处理结果、取消与清理。
 * 关键边界：异步状态不等于单次任务结果；外部输出不可信；清理必须等待子代理完全停止。
 * 新手阅读建议：先看公开配置和测试夹具，再读启动/事件流程，最后关注继承、取消与失败路径。
 */

import type { Readable, Writable } from 'node:stream'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SubagentResult } from '@deepseek-ai/dsh-subagent'
import { JsonRpcLineTransport } from '@deepseek-ai/dsh-sdk-protocol'
import type { CodexPermissionMode } from './run.ts'

/** 中文说明：type JsonObject 定义本模块所需的数据或行为，用于表达子代理场景。 */
type JsonObject = Record<string, unknown>

/** Product facts owned by the Codex wire after publication. */
/* 中文说明：interface CodexWireFailureFacts 定义本模块所需的数据或行为，用于表达子代理场景。 */
export interface CodexWireFailureFacts {
  readonly stage: 'turn-start' | 'turn'
  readonly category: string
  readonly httpStatus?: number | undefined
}

/** 中文说明：常量 THREAD_PERMISSION_PARAMS 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const THREAD_PERMISSION_PARAMS: Readonly<Record<CodexPermissionMode, JsonObject>> = {
  never: { approvalPolicy: 'never' },
  'approve-for-me': {
    approvalPolicy: 'on-request',
    approvalsReviewer: 'auto_review',
    sandbox: 'workspace-write',
  },
  'dangerously-bypass-approvals-and-sandbox': {
    approvalPolicy: 'never',
    sandbox: 'danger-full-access',
  },
}

/** 中文说明：常量 STDERR_PERMISSION_SIGNATURES 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const STDERR_PERMISSION_SIGNATURES = [
  {
    text: 'approval policy is Never; reject command',
    request: 'command execution',
    decision: 'denied',
    reason: 'Codex rejected an escalation because the selected policy never asks for approval',
  },
  {
    text: 'recorded sandbox violation:',
    request: 'sandbox execution',
    decision: 'failed',
    reason: 'Codex reported a sandbox violation',
  },
] as const

/** 中文说明：常量 STDERR_SIGNATURE_TAIL_CHARS 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const STDERR_SIGNATURE_TAIL_CHARS = Math.max(
  ...STDERR_PERMISSION_SIGNATURES.map(signature => signature.text.length),
) - 1

/** 中文说明：函数 stderrSignatureTail 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function stderrSignatureTail(value: string): string {
  /** 中文说明：该循环依次处理代理事件；循环变量仅在当前循环中有效。 */
  for (
    /** 中文说明：变量 length 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let length = Math.min(STDERR_SIGNATURE_TAIL_CHARS, value.length)
    ; length > 0
    ; length -= 1
  ) {
    /** 中文说明：变量 tail 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const tail = value.slice(-length)
    if (STDERR_PERMISSION_SIGNATURES.some(signature =>
      tail.length < signature.text.length && signature.text.startsWith(tail))) {
      return tail
    }
  }
  return ''
}

/** 中文说明：函数 object 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function object(value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`subagent-codex: app-server returned invalid ${label}`)
  }
  return value as JsonObject
}

/** 中文说明：函数 string 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`subagent-codex: app-server returned invalid ${label}`)
  }
  return value
}

/** 中文说明：函数 unattendedDecision 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function unattendedDecision(params: JsonObject): 'cancel' | 'decline' {
  /** 中文说明：变量 available 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const available = params.availableDecisions
  if (available === undefined || available === null) return 'decline'
  if (Array.isArray(available)) {
    if (available.includes('cancel')) return 'cancel'
    if (available.includes('decline')) return 'decline'
  }
  throw new Error('subagent-codex: app-server offered no unattended approval decision')
}

/** 中文说明：函数 numericHttpStatus 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function numericHttpStatus(value: unknown): number | undefined {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= 0
    && value <= 65_535
    ? value
    : undefined
}

/** 中文说明：函数 objectFailureInfo 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function objectFailureInfo(value: JsonObject): {
  readonly category: string
  readonly httpStatus?: number | undefined
} {
  /** 中文说明：变量 keys 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const keys = Object.keys(value)
  /** 中文说明：变量 category 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const category = keys[0]
  if (keys.length !== 1 || category === undefined) {
    return { category: 'unknown' }
  }
  /** 中文说明：变量 detail 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const detail = value[category]
  if (detail === null || typeof detail !== 'object' || Array.isArray(detail)) {
    return { category: 'unknown' }
  }
  /** 中文说明：变量 fields 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const fields = detail as JsonObject
  switch (category) {
    case 'httpConnectionFailed':
    case 'responseStreamConnectionFailed':
    case 'responseStreamDisconnected':
    case 'responseTooManyFailedAttempts':
    {
      /** 中文说明：变量 httpStatus 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const httpStatus = numericHttpStatus(fields.httpStatusCode)
      return httpStatus === undefined
        ? { category }
        : { category, httpStatus }
    }
    case 'activeTurnNotSteerable':
      return { category }
    default:
      return { category: 'unknown' }
  }
}

/** 中文说明：函数 failureInfo 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function failureInfo(turn: JsonObject): {
  readonly category: string
  readonly httpStatus?: number | undefined
} {
  if (turn.status !== 'failed') return { category: 'unknown' }
  /** 中文说明：变量 error 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const error = turn.error
  if (error === null || typeof error !== 'object' || Array.isArray(error)) {
    return { category: 'unknown' }
  }
  /** 中文说明：变量 info 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const info = (error as JsonObject).codexErrorInfo
  if (typeof info === 'string') {
    switch (info) {
      case 'contextWindowExceeded':
      case 'sessionBudgetExceeded':
      case 'usageLimitExceeded':
      case 'serverOverloaded':
      case 'cyberPolicy':
      case 'internalServerError':
      case 'unauthorized':
      case 'badRequest':
      case 'threadRollbackFailed':
      case 'sandboxError':
      case 'other':
        return { category: info }
      default:
        return { category: 'unknown' }
    }
  }
  return info !== null && typeof info === 'object' && !Array.isArray(info)
    ? objectFailureInfo(info as JsonObject)
    : { category: 'unknown' }
}

/** 中文说明：函数 unattendedDiagnostic 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function unattendedDiagnostic(
  mode: CodexPermissionMode,
  request: 'command approval' | 'file approval' | 'permission grant' | 'user input' | 'MCP elicitation' | 'command execution' | 'file change' | 'sandbox execution',
  decision: 'cancelled' | 'declined' | 'denied' | 'empty response' | 'failed',
  reason: string,
): string {
  return `Codex unattended decision (mode: ${mode}; request: ${request}; decision: ${decision}): ${reason}`
}

/** 中文说明：函数 thrown 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function thrown(value: unknown): Error {
  /* v8 ignore next -- typed protocol and stream failures reject with Error. */
  return value instanceof Error ? value : new Error(String(value))
}

/** 中文说明：函数 abortError 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error(`subagent-codex: app-server request aborted: ${String(signal.reason)}`)
}

/** 中文说明：函数 raceAbort 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
async function raceAbort<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void pending.catch(() => {})
    throw abortError(signal)
  }
  /** 中文说明：函数值 rejectAbort 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  let rejectAbort!: (error: Error) => void
  /** 中文说明：函数值 aborted 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject })
  /** 中文说明：函数值 onAbort 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const onAbort = (): void => { rejectAbort(abortError(signal)) }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    return await Promise.race([pending, aborted])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

/**
 * One app-server connection and its single ephemeral thread/turn.
 *
 * The class deliberately exposes no generic request surface. Supporting
 * another product method must first become part of the provider contract.
 */
/* 中文说明：class CodexAppServerWire 定义本模块所需的数据或行为，用于表达子代理场景。 */
export class CodexAppServerWire {
  private readonly transport: JsonRpcLineTransport
  private readonly fatal = Promise.withResolvers<never>()
  private threadId: string | undefined
  private turnId: string | undefined
  private pendingTurnId: string | undefined
  private turnCompleted: PromiseWithResolvers<{
    readonly params: JsonObject
    readonly order: number
  }> | undefined
  private readonly earlyTurnNotifications: Array<{
    readonly method: string
    readonly params: JsonObject
    readonly order: number
  }> = []
  private lastFinalAnswer: string | undefined
  private lastUnphasedAnswer: string | undefined
  private diagnostic: string | undefined
  private failure: CodexWireFailureFacts | undefined
  private diagnosticOrder = 0
  private observationOrder = 0
  private pendingDiagnostic: {
    readonly order: number
    readonly request: Parameters<typeof unattendedDiagnostic>[1]
    readonly decision: Parameters<typeof unattendedDiagnostic>[2]
    readonly reason: string
  } | undefined
  private stderrTail = ''
  private inputEnded = false
  private terminalObserved = false
  private closed = false

  constructor(
    private readonly input: Readable,
    output: Writable,
    private readonly permissionMode: CodexPermissionMode,
  ) {
    this.transport = new JsonRpcLineTransport(input, output)
    // Fatal protocol state can arrive after the current guarded operation has
    // already settled. Keep the shared rejection observed without inserting
    // another promise-adoption hop into active races.
    void this.fatal.promise.catch(() => {})
    this.transport.onRequest((method, params) => this.handleServerRequest(method, params))
    this.transport.onNotification((method, params) => {
      try {
        this.handleNotification(method, params)
      } catch (error: unknown) {
        this.fail(thrown(error))
      }
    })
    this.input.on('error', this.onInputError)
    this.input.on('end', this.onInputEnd)
    // Pipe errors can race protocol closure and process teardown. Retain both
    // error listeners for the lifetime of their per-run streams so no late
    // EPIPE or read failure becomes an unhandled EventEmitter error.
    output.on('error', this.onOutputError)
  }

  /** Start reading app-server frames. */
  start(): void {
    this.transport.start()
  }

  /**
   * Whether protocol output ended before a terminal turn notification.
   * @returns `true` only for an early protocol close without a terminal turn.
   */
  endedBeforeTerminal(): boolean {
    return this.inputEnded && !this.terminalObserved
  }

  /**
   * Perform the required app-server initialize/initialized handshake.
   * @param signal - unpublished-start cancellation.
   */
  async initialize(signal: AbortSignal): Promise<void> {
    object(await this.guarded(this.transport.request('initialize', {
      clientInfo: {
        name: 'deepseek-harness',
        title: 'DeepSeek Harness',
        version: '0.0.1',
      },
      capabilities: {
        experimentalApi: false,
        requestAttestation: false,
      },
    }, signal), signal), 'initialize response')
    this.transport.notify('initialized')
    await this.guarded(this.transport.flush(), signal)
  }

  /**
   * Create the run's private ephemeral thread and retain its identity.
   * @param cwd - parent Session workspace.
   * @param signal - unpublished-start cancellation.
   */
  async startThread(cwd: string, signal: AbortSignal): Promise<void> {
    /** 中文说明：变量 response 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const response = object(await this.guarded(this.transport.request('thread/start', {
      cwd,
      ephemeral: true,
      ...THREAD_PERMISSION_PARAMS[this.permissionMode],
    }, signal), signal), 'thread/start response')
    /** 中文说明：变量 thread 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const thread = object(response.thread, 'thread/start thread')
    /** 中文说明：变量 id 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const id = string(thread.id, 'thread/start thread id')
    if (thread.ephemeral !== true) {
      throw new Error('subagent-codex: app-server did not create an ephemeral thread')
    }
    this.threadId = id
  }

  /**
   * Submit the one text-only task and wait for this thread/turn's authoritative
   * terminal notification.
   * @param texts - already validated task text blocks.
   * @param signal - local cancellation for the published run.
   * @returns the shared subagent result.
   */
  async runTurn(
    texts: readonly string[],
    signal: AbortSignal,
  ): Promise<SubagentResult> {
    /** 中文说明：变量 completion 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const completion = Promise.withResolvers<{
      readonly params: JsonObject
      readonly order: number
    }>()
    this.turnCompleted = completion
    /** 中文说明：变量 threadId 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const threadId = this.threadId as string
    try {
      /** 中文说明：变量 response 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const response = object(await this.guarded(this.transport.request('turn/start', {
        threadId,
        input: texts.map(text => ({ type: 'text', text, text_elements: [] })),
      }, signal), signal), 'turn/start response')
      /** 中文说明：变量 turn 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const turn = object(response.turn, 'turn/start turn')
      this.commitTurnId(string(turn.id, 'turn/start turn id'))
    } catch (error: unknown) {
      this.recordFailure({ stage: 'turn-start', category: 'unknown' })
      throw error
    }

    /** 中文说明：变量 completed 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let completed: {
      readonly params: JsonObject
      readonly order: number
    }
    /** 中文说明：变量 terminal 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let terminal: JsonObject
    try {
      completed = await this.guarded(completion.promise, signal)
      terminal = object(completed.params.turn, 'turn/completed turn')
    } catch (error: unknown) {
      this.recordFailure({ stage: 'turn', category: 'unknown' })
      throw error
    }
    /** 中文说明：变量 status 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const status = terminal.status
    if (status !== 'completed') {
      /** 中文说明：变量 parsed 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const parsed = failureInfo(terminal)
      this.recordFailure(parsed.httpStatus === undefined
        ? { stage: 'turn', category: parsed.category }
        : {
          stage: 'turn',
          category: parsed.category,
          httpStatus: parsed.httpStatus,
        })
      if (parsed.category === 'sandboxError') {
        this.recordDiagnostic(
          'sandbox execution',
          'failed',
          'Codex reported a sandbox failure',
          completed.order,
        )
      }
      if (parsed.category === 'contextWindowExceeded') {
        return { output: this.collectOutput(), stopReason: 'max-tokens' }
      }
      /** 中文说明：变量 detail 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const detail = status === 'failed' ? `: ${parsed.category}` : ''
      throw new Error(`subagent-codex: Codex turn ended with status ${String(status)}${detail}`)
    }
    /** 中文说明：变量 output 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const output = this.collectOutput()
    if (output.length === 0) {
      this.recordFailure({ stage: 'turn', category: 'unknown' })
      throw new Error('subagent-codex: Codex completed without a final answer')
    }
    return { output, stopReason: 'completed' }
  }

  /**
   * Best-effort remote cancellation. Local settlement and process teardown
   * remain authoritative when the child no longer accepts protocol requests.
   */
  interrupt(): void {
    if (this.threadId === undefined || this.turnId === undefined || this.closed) return
    void this.transport.request('turn/interrupt', {
      threadId: this.threadId,
      turnId: this.turnId,
    }).catch(() => {})
  }

  /**
   * The best non-commentary answer observed so far, preserving exact bytes.
   * @returns the selected final or nullable-phase text block, if any.
   */
  collectOutput(): ContentBlock[] {
    /** 中文说明：变量 selected 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const selected = this.lastFinalAnswer ?? this.lastUnphasedAnswer
    return selected !== undefined && selected.trim().length > 0
      ? [{ type: 'text', text: selected }]
      : []
  }

  /**
   * The latest safe unattended permission fact observed for this run.
   * @returns provider-authored diagnostic text, when one was observed.
   */
  collectDiagnostic(): string | undefined {
    return this.diagnostic
  }

  /**
   * The structured failure fact observed for this published turn.
   * Call only after a non-completed return or rejection from {@link runTurn}.
   * @returns the fixed stage/category pair and optional HTTP status.
   */
  collectFailure(): CodexWireFailureFacts {
    return this.failure as CodexWireFailureFacts
  }

  /**
   * Observe product stderr while retaining only enough tail to recognize fixed
   * permission signatures. The raw text is never copied into the diagnostic.
   * @param chunk - one decoded stderr chunk already forwarded to the host.
   */
  observeStderr(chunk: string): void {
    /** 中文说明：变量 observed 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const observed = `${this.stderrTail}${chunk}`
    /** 中文说明：变量 latestIndex 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let latestIndex = -1
    /** 中文说明：变量 latest 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let latest: (typeof STDERR_PERMISSION_SIGNATURES)[number] | undefined
    /** 中文说明：该循环依次处理代理事件；循环变量仅在当前循环中有效。 */
    for (const signature of STDERR_PERMISSION_SIGNATURES) {
      /** 中文说明：变量 index 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const index = observed.lastIndexOf(signature.text)
      if (index > latestIndex) {
        latestIndex = index
        latest = signature
      }
    }
    if (latest !== undefined) {
      this.recordDiagnostic(latest.request, latest.decision, latest.reason)
    }
    this.stderrTail = stderrSignatureTail(observed)
  }

  /** Detach JSON-RPC listeners and reject outstanding requests. Idempotent. */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.input.off('end', this.onInputEnd)
    this.transport.close()
  }

  private async guarded<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
    /** 中文说明：变量 withFatal 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const withFatal = Promise.race([this.fatal.promise, pending])
    return raceAbort(withFatal, signal)
  }

  private fail(error: Error): void {
    this.fatal.reject(error)
  }

  private readonly onInputError = (error: Error): void => {
    this.fail(error)
  }

  private readonly onOutputError = (error: Error): void => {
    this.fail(error)
  }

  private readonly onInputEnd = (): void => {
    this.inputEnded = true
    this.fail(new Error('subagent-codex: app-server protocol stream closed'))
  }

  private observePendingTurnId(id: string): void {
    if (this.turnCompleted === undefined) {
      throw new Error('subagent-codex: app-server referenced a turn before turn/start')
    }
    if (this.pendingTurnId !== undefined && this.pendingTurnId !== id) {
      throw new Error('subagent-codex: app-server referenced conflicting turns')
    }
    this.pendingTurnId = id
  }

  private commitTurnId(id: string): void {
    if (this.pendingTurnId !== undefined && this.pendingTurnId !== id) {
      throw new Error('subagent-codex: turn/start response did not match the active turn')
    }
    this.turnId = id
    /** 中文说明：变量 pendingDiagnostic 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pendingDiagnostic = this.pendingDiagnostic
    this.pendingDiagnostic = undefined
    if (pendingDiagnostic !== undefined) {
      this.recordDiagnostic(
        pendingDiagnostic.request,
        pendingDiagnostic.decision,
        pendingDiagnostic.reason,
        pendingDiagnostic.order,
      )
    }
    /** 中文说明：变量 notifications 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const notifications = this.earlyTurnNotifications.splice(0)
    /** 中文说明：该循环依次处理代理事件；循环变量仅在当前循环中有效。 */
    for (const notification of notifications) {
      this.handleNotification(
        notification.method,
        notification.params,
        notification.order,
      )
    }
  }

  /**
   * Validate the request's thread and turn association.
   * @returns `true` when the matching turn is still provisional, so the caller
   * defers its diagnostic until `commitTurnId()`.
   */
  private validateRunIds(
    params: JsonObject,
    nullableTurn = false,
  ): boolean {
    if (params.threadId !== this.threadId) {
      throw new Error('subagent-codex: app-server request referenced another thread')
    }
    if (nullableTurn && params.turnId === null) return false
    /** 中文说明：变量 id 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const id = string(params.turnId, 'server request turn id')
    if (this.turnId === undefined) {
      this.observePendingTurnId(id)
      return true
    }
    if (id !== this.turnId) {
      throw new Error('subagent-codex: app-server request referenced another turn')
    }
    return false
  }

  private recordRequestDiagnostic(
    provisional: boolean,
    request: Parameters<typeof unattendedDiagnostic>[1],
    decision: Parameters<typeof unattendedDiagnostic>[2],
    reason: string,
  ): void {
    /** 中文说明：变量 order 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const order = this.nextObservationOrder()
    if (provisional) {
      this.pendingDiagnostic = {
        order,
        request,
        decision,
        reason,
      }
      return
    }
    this.recordDiagnostic(request, decision, reason, order)
  }

  private recordDiagnostic(
    request: Parameters<typeof unattendedDiagnostic>[1],
    decision: Parameters<typeof unattendedDiagnostic>[2],
    reason: string,
    order = this.nextObservationOrder(),
  ): void {
    if (order < this.diagnosticOrder) return
    this.diagnosticOrder = order
    this.diagnostic = unattendedDiagnostic(
      this.permissionMode,
      request,
      decision,
      reason,
    )
  }

  private recordFailure(facts: CodexWireFailureFacts): void {
    this.failure = facts
  }

  private nextObservationOrder(): number {
    this.observationOrder += 1
    return this.observationOrder
  }

  private recordDeclinedItem(item: JsonObject, order?: number): boolean {
    if (item.type === 'commandExecution' && item.status === 'declined') {
      this.recordDiagnostic(
        'command execution',
        'declined',
        'Codex declined the command under the selected permission mode',
        order,
      )
      return true
    }
    if (item.type === 'fileChange' && item.status === 'declined') {
      this.recordDiagnostic(
        'file change',
        'declined',
        'Codex declined the file change under the selected permission mode',
        order,
      )
      return true
    }
    return false
  }

  private handleServerRequest(method: string, params: JsonObject): Promise<unknown> {
    try {
      switch (method) {
        case 'item/commandExecution/requestApproval':
        {
          /** 中文说明：变量 provisional 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const provisional = this.validateRunIds(params)
          /** 中文说明：变量 decision 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const decision = unattendedDecision(params)
          this.recordRequestDiagnostic(
            provisional,
            'command approval',
            decision === 'cancel' ? 'cancelled' : 'declined',
            'the provider does not grant interactive approval',
          )
          return Promise.resolve({ decision })
        }
        case 'item/fileChange/requestApproval':
        {
          /** 中文说明：变量 provisional 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const provisional = this.validateRunIds(params)
          /** 中文说明：变量 decision 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const decision = unattendedDecision(params)
          this.recordRequestDiagnostic(
            provisional,
            'file approval',
            decision === 'cancel' ? 'cancelled' : 'declined',
            'the provider does not grant interactive approval',
          )
          return Promise.resolve({ decision })
        }
        case 'item/permissions/requestApproval':
          this.recordRequestDiagnostic(
            this.validateRunIds(params),
            'permission grant',
            'denied',
            'the provider grants no additional turn permissions',
          )
          return Promise.resolve({ permissions: {}, scope: 'turn' })
        case 'item/tool/requestUserInput':
          this.recordRequestDiagnostic(
            this.validateRunIds(params),
            'user input',
            'empty response',
            'the provider does not collect interactive answers',
          )
          return Promise.resolve({ answers: {} })
        case 'mcpServer/elicitation/request':
          this.recordRequestDiagnostic(
            this.validateRunIds(params, true),
            'MCP elicitation',
            'declined',
            'the provider does not collect interactive MCP input',
          )
          return Promise.resolve({ action: 'decline', content: null, _meta: null })
        default:
          throw new Error(`subagent-codex: unsupported app-server request ${JSON.stringify(method)}`)
      }
    } catch (error: unknown) {
      /** 中文说明：变量 normalized 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const normalized = thrown(error)
      this.fail(normalized)
      return Promise.reject(normalized)
    }
  }

  private handleNotification(
    method: string,
    params: JsonObject,
    order?: number,
  ): void {
    if (method === 'turn/started') {
      /** 中文说明：变量 threadId 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const threadId = string(params.threadId, 'turn/started thread id')
      if (threadId !== this.threadId) return
      /** 中文说明：变量 turn 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const turn = object(params.turn, 'turn/started turn')
      if (this.turnCompleted !== undefined && this.turnId === undefined) {
        this.observePendingTurnId(string(turn.id, 'turn/started turn id'))
      }
      return
    }
    if (method === 'item/completed') {
      /** 中文说明：变量 threadId 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const threadId = string(params.threadId, 'item/completed thread id')
      if (threadId !== this.threadId) return
      /** 中文说明：变量 id 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const id = string(params.turnId, 'item/completed turn id')
      if (this.turnId === undefined) {
        if (this.turnCompleted !== undefined) {
          this.observePendingTurnId(id)
          this.earlyTurnNotifications.push({
            method,
            params,
            order: this.nextObservationOrder(),
          })
        }
        return
      }
      if (id !== this.turnId) return
      /** 中文说明：变量 item 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const item = object(params.item, 'item/completed item')
      if (this.recordDeclinedItem(item, order)) return
      if (item.type !== 'agentMessage') return
      /** 中文说明：变量 text 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const text = typeof item.text === 'string'
        ? item.text
        : (() => { throw new Error('subagent-codex: app-server returned an invalid agent message') })()
      if (item.phase === 'final_answer') {
        this.lastFinalAnswer = text
      } else if (item.phase === null) {
        this.lastUnphasedAnswer = text
      } else if (item.phase !== 'commentary') {
        throw new Error(`subagent-codex: app-server returned an unknown agent message phase ${JSON.stringify(item.phase)}`)
      }
      return
    }
    if (method !== 'turn/completed') return
    /** 中文说明：变量 threadId 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const threadId = string(params.threadId, 'turn/completed thread id')
    if (threadId !== this.threadId) return
    /** 中文说明：变量 turn 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const turn = object(params.turn, 'turn/completed turn')
    /** 中文说明：变量 id 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const id = string(turn.id, 'turn/completed turn id')
    /** 中文说明：变量 turnCompleted 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const turnCompleted = this.turnCompleted
    if (turnCompleted === undefined) return
    if (this.turnId === undefined) {
      this.observePendingTurnId(id)
      this.earlyTurnNotifications.push({
        method,
        params,
        order: this.nextObservationOrder(),
      })
      return
    }
    if (id !== this.turnId) return
    this.terminalObserved = true
    if (!['completed', 'interrupted', 'failed'].includes(String(turn.status))) {
      throw new Error(`subagent-codex: app-server returned invalid terminal turn status ${String(turn.status)}`)
    }
    turnCompleted.resolve({
      params,
      order: order ?? this.nextObservationOrder(),
    })
  }
}
