/**
 * Fresh-process SDK subagent client. Drives one child DeepSeek Harness
 * runtime over stdio JSON-RPC through `@deepseek-ai/dsh-sdk-client` and owns
 * cancellation and quiescent disposal. It publishes after the child
 * handshake, maps child failures to stop reasons, and tears down to
 * quiescence. The SDK client spawns the child rather than using
 * `ctx.subprocess` — the subprocess seam's documented exception for
 * SDK-managed transports — so this driver applies the seam's shared env scrub.
 *
 * @module @deepseek-ai/dsh-subagent-dsh-sdk/run
 */
/*
 * 文件职责：实现 run.ts 覆盖的子代理启动、协议、继承与生命周期行为。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、进程协议或同进程代理驱动。
 * 产品维度：保障 Agent 能可靠委派任务、继承上下文并收集子代理结果。
 * 逻辑维度：准备代理配置，启动或连接子代理，转发事件，再处理结果、取消与清理。
 * 关键边界：异步状态不等于单次任务结果；外部输出不可信；清理必须等待子代理完全停止。
 * 新手阅读建议：先看公开配置和测试夹具，再读启动/事件流程，最后关注继承、取消与失败路径。
 */

import { randomUUID } from 'node:crypto'
import {
  DeepSeekHarness,
  type DeepSeekHarnessOptions,
  type HarnessNotification,
  JsonRpcResponseError,
  SdkProtocolError,
  TransportClosedError,
} from '@deepseek-ai/dsh-sdk-client'
import type { ContentBlock, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent, type TurnEndReason } from '@deepseek-ai/dsh-session'
import type { SubagentResult, SubagentRun, SubagentStartRequest, SubagentStopReason } from '@deepseek-ai/dsh-subagent'
import { AssistantOutputFold, settleRunResult, subprocessRunHandle } from '@deepseek-ai/dsh-subagent'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'

/** Resolved spawn spec for an SDK runtime child process (no defaults — see Config). */
/* 中文说明：interface SdkRunSpec 定义本模块所需的数据或行为，用于表达子代理场景。 */
export interface SdkRunSpec {
  /** Explicit dsh CLI module; omission resolves the SDK client's same-version dependency. */
  dshBin?: string
  /** Named child profile. */
  profile: string
  /** Ordered per-launch profile patch files. */
  patches: string[]
  /** Absolute isolated Harness home for the nested runtime. */
  dshHome: string
  /**
   * Absolute working directory for the child process AND the workspace cwd
   * of its SDK session. The provider resolves it before this spec exists:
   * config override, else the delegating parent session's workspace.
   */
  cwd: string
  /** Provider route the child runtime initializes with. */
  provider: string
  /** Model the child runtime initializes with. */
  model: string
  /** Optional adapter-owned reasoning effort sent in the child runtime's initialize handshake. */
  reasoningEffort?: ReasoningEffortId
  /** Optional per-request output-token cap sent in the child runtime's initialize handshake. */
  maxTokens?: number
  /**
   * Extra environment variables to ADD for the child (e.g. the child
   * runtime's own `DEEPSEEK_API_KEY`). Merged after
   * the seam's `scrubbedParentEnv()` base, so an explicit credential or
   * current `DSH_*` fact survives while ambient namesakes never leak.
   */
  env: Record<string, string>
  /** Bound (ms) on the protocol `shutdown` exchange during dispose. */
  shutdownTimeoutMs: number
  /** Grace period (ms) for the child's EOF-driven quiesce on dispose. */
  disposeEofGraceMs: number
  /** Termination confirmation window (ms), including forced exit on every platform. */
  disposeGraceMs: number
  /**
   * Host sink for startup, published-run, or shutdown failures. Model-visible
   * text uses fixed safe facts, while this callback retains the original Error.
   * A throw from the sink itself is contained.
   */
  onError?: (error: Error, stopReason: SubagentStopReason) => void
}

/** EOF grace for child flush and nested-process teardown; wider than the signal grace below. */
/* 中文说明：常量 DEFAULT_DISPOSE_EOF_GRACE_MS 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
export const DEFAULT_DISPOSE_EOF_GRACE_MS = 6_000

/** Default POSIX grace between SIGTERM and SIGKILL on dispose (the `disposeGraceMs` config). */
/* 中文说明：常量 DEFAULT_DISPOSE_GRACE_MS 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
export const DEFAULT_DISPOSE_GRACE_MS = 3_000

/** Default bound on the protocol `shutdown` exchange during dispose. */
/* 中文说明：常量 DEFAULT_SHUTDOWN_TIMEOUT_MS 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 1_000

type SdkFailureStage = 'initialize' | 'session-run' | 'shutdown'

type SdkFailureCategory =
  | 'configuration'
  | 'protocol'
  | 'transport'
  | 'child-error'
  | 'child-disposed'
  | 'child-unknown'
  | 'missing-terminal'
  | 'unknown'

interface SdkFailureFacts {
  readonly stage: SdkFailureStage
  readonly category: SdkFailureCategory
}

/** Fixed safe failure text derived only from provider-owned structured facts. */
function failureDiagnostic(facts: SdkFailureFacts): string {
  const fields = [
    'provider: DSH SDK',
    `stage: ${facts.stage}`,
    `category: ${facts.category}`,
  ]
  return `Subagent failure (${fields.join('; ')})`
}

class SdkRunFailure extends Error {
  constructor(readonly facts: SdkFailureFacts, cause: unknown) {
    super(`subagent-dsh-sdk: ${failureDiagnostic(facts)}`, { cause })
    this.name = 'SdkRunFailure'
  }
}

/** Runtime constructor seam replaced only by package-local fake-runtime tests. */
export const internals: { createHarness(options: DeepSeekHarnessOptions): DeepSeekHarness } = {
  createHarness: options => new DeepSeekHarness(options),
}

/**
 * Hide a pre-spawn workspace/configuration failure behind fixed safe facts.
 * @param cause - original Host failure retained on the Error cause chain.
 * @returns an Error whose message contains only the fixed DSH SDK failure line.
 */
export function sdkConfigurationFailure(cause: unknown): Error {
  return new SdkRunFailure({ stage: 'initialize', category: 'configuration' }, cause)
}

/** Classify one SDK rejection without reading its message or stderr tail. */
function sdkFailure(error: unknown, stage: SdkFailureStage): SdkRunFailure {
  const facts: SdkFailureFacts = error instanceof TransportClosedError
    ? { stage, category: 'transport' }
    : error instanceof SdkProtocolError || error instanceof JsonRpcResponseError
      ? { stage, category: 'protocol' }
      : { stage, category: 'unknown' }
  return new SdkRunFailure(facts, error)
}

/**
 * Map one child terminal reason to its complete shared result outcome.
 * @param reason - the owned child run's final durable turn reason, or
 * `undefined` when it settled without running a turn.
 * @returns the shared stop reason and any additional safe diagnostic.
 */
export function sdkChildOutcome(
  reason: TurnEndReason | undefined,
): Pick<SubagentResult, 'stopReason' | 'diagnostic'> {
  switch (reason?.kind) {
    case 'completed':
      return { stopReason: 'completed' }
    case 'max-tokens':
      return { stopReason: 'max-tokens' }
    case 'aborted':
      return reason.reason.kind === 'disposed'
        ? {
          stopReason: 'aborted',
          diagnostic: failureDiagnostic({ stage: 'session-run', category: 'child-disposed' }),
        }
        : { stopReason: 'aborted' }
    case 'blocked':
      return { stopReason: 'refusal' }
    case 'error':
      return {
        stopReason: 'error',
        diagnostic: failureDiagnostic({ stage: 'session-run', category: 'child-error' }),
      }
    case 'interrupted':
      return { stopReason: 'error' }
    case undefined:
      return {
        stopReason: 'error',
        diagnostic: failureDiagnostic({ stage: 'session-run', category: 'missing-terminal' }),
      }
    default:
      return {
        stopReason: 'error',
        diagnostic: failureDiagnostic({ stage: 'session-run', category: 'child-unknown' }),
      }
  }
}

/** Normalize an unknown thrown value to an Error (the catch binding is `unknown`). */
/* 中文说明：函数 toError 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function toError(value: unknown): Error {
  // The catch only sees rejections from the SDK client, which are always
  // `Error`s; the `String(value)` arm is a defensive fallback for a non-Error
  // throw that the typed surfaces cannot produce.
  /* v8 ignore next */
  return value instanceof Error ? value : new Error(String(value))
}

/** Report an original Host failure without letting the observation sink replace it. */
function reportFailure(spec: SdkRunSpec, error: unknown): void {
  try {
    spec.onError?.(toError(error), 'error')
  } catch {
    // Host diagnostic logging cannot replace the child failure.
  }
}

/** Map an SDK-owned failed-start aggregate into safe initialize/shutdown lines. */
function sdkStartupFailure(spec: SdkRunSpec, error: unknown): Error {
  if (!(error instanceof AggregateError) || error.errors.length < 2) {
    reportFailure(spec, error)
    return sdkFailure(error, 'initialize')
  }
  const initializeError: unknown = error.errors[0]
  const cleanupError: unknown = error.errors[1]
  reportFailure(spec, initializeError)
  reportFailure(spec, cleanupError)
  const initializeFailure = sdkFailure(initializeError, 'initialize')
  const cleanupFailure = new SdkRunFailure({ stage: 'shutdown', category: 'unknown' }, cleanupError)
  return new AggregateError(
    [initializeFailure, cleanupFailure],
    `${initializeFailure.message}; ${cleanupFailure.message}`,
  )
}

/**
 * Start and publish one SDK runtime child after its `initialize` handshake.
 * Child failures resolve through the run result. Startup rejects with fixed
 * safe facts after SDK-owned cleanup; successful cleanup proves process reap.
 * Cleanup failure preserves initialize plus shutdown for an ordinary failure,
 * or shutdown alone after cancellation, without claiming quiescence. Disposal
 * shuts the runtime down and reaps it.
 * @param request - the start request; its signal is the cancellation channel.
 * @param spec - the resolved spawn spec: profile/patches/home/cwd, the child's
 * provider/model/reasoning route, output cap, env, timeouts, and the optional
 * error sink.
 * @returns the ready run handle for the child subprocess.
 */
/*
 * 中文说明：函数 startSdkRun 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param request 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param spec 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export async function startSdkRun(request: SubagentStartRequest, spec: SdkRunSpec): Promise<SubagentRun> {
  if (request.signal.aborted) throw new Error('subagent request was aborted before the SDK child started')
  // The run id lives in the parent namespace; the child runtime's session id
  // (minted below, private to the wire) exists only inside the child process.
  /** 中文说明：变量 id 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const id = SessionId(randomUUID())

  const harness = internals.createHarness({
    ...spec.dshBin === undefined ? {} : { dshBin: spec.dshBin },
    profile: spec.profile,
    patches: spec.patches,
    dshHome: spec.dshHome,
    processCwd: spec.cwd,
    env: { ...scrubbedParentEnv(), ...spec.env },
    shutdownTimeoutMs: spec.shutdownTimeoutMs,
    disposeEofGraceMs: spec.disposeEofGraceMs,
    disposeGraceMs: spec.disposeGraceMs,
    cwd: spec.cwd,
    provider: spec.provider,
    model: spec.model,
    ...spec.reasoningEffort === undefined ? {} : { reasoningEffort: spec.reasoningEffort },
    ...spec.maxTokens === undefined ? {} : { maxTokens: spec.maxTokens },
  })

  // Cancellation settles the result without waiting for a cooperative child.
  /** 中文说明：变量 flags 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const flags = { cancelled: false }
  /** 中文说明：函数值 signalCancelSettled 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  let signalCancelSettled!: () => void
  /** 中文说明：函数值 cancelSettled 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const cancelSettled = new Promise<void>((resolve) => { signalCancelSettled = resolve })
  /** 中文说明：函数值 requestCancel 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const requestCancel = (): void => {
    if (flags.cancelled) return
    flags.cancelled = true
    signalCancelSettled()
  }
  /** 中文说明：函数值 onAbort 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const onAbort = (): void => { requestCancel() }
  request.signal.addEventListener('abort', onAbort, { once: true })
  const cancelledStartup = new Error('subagent cancelled before the SDK child initialized')

  // Establish the child handshake before publishing a handle. Any failure
  // owns the still-private process and reaps it before rejecting.
  try {
    await Promise.race([
      harness.start(),
      cancelSettled.then((): never => { throw cancelledStartup }),
    ])
    // Defensive: an abort() is a macrotask and no user callback runs inside
    // the microtask drain between handshake fulfillment and this continuation,
    // so current callback ordering cannot schedule the recheck; it guards future reentrancy.
    /* v8 ignore next */
    if (flags.cancelled) throw cancelledStartup
  } catch (error: unknown) {
    request.signal.removeEventListener('abort', onAbort)
    if (error !== cancelledStartup) {
      throw sdkStartupFailure(spec, error)
    }
    try {
      await harness.close()
    } catch (cleanupError: unknown) {
      reportFailure(spec, cleanupError)
      const cleanupFailure = new SdkRunFailure({ stage: 'shutdown', category: 'unknown' }, cleanupError)
      // Preserve failed cleanup as a failed Job; settleStart treats only an
      // aborted non-AggregateError rejection as a cleanly killed startup.
      throw new AggregateError([cleanupFailure], cleanupFailure.message)
    }
    throw new Error('subagent request was aborted before the SDK child started')
  }

  /** 中文说明：变量 childSessionId 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const childSessionId = `session-${randomUUID().replaceAll('-', '')}`
  // The child's final answer under the seam's canonical selection rule
  // (`AssistantOutputFold`); a partial answer survives cancel and error paths.
  /** 中文说明：变量 fold 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const fold = new AssistantOutputFold()
  /** 中文说明：函数值 observe 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const observe = (notification: HarnessNotification): void => {
    if (notification.method !== 'session.event' || notification.params.sessionId !== childSessionId) return
    fold.push(notification.params.event as SessionEvent)
  }
  /** 中文说明：函数值 collectOutput 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const collectOutput = (): ContentBlock[] => fold.collect() ?? []
  const teardown = async (): Promise<void> => {
    try {
      await harness.close()
    } catch (error: unknown) {
      reportFailure(spec, error)
      throw new SdkRunFailure({ stage: 'shutdown', category: 'unknown' }, error)
    }
  }

  // Race the child turn against local cancellation; the shared settlement
  // flattens failures under the seam's never-reject contract.
  let diagnostic: string | undefined
  const result: Promise<SubagentResult> = settleRunResult({
    attempt: async () => {
      try {
        const turn = await Promise.race([
          harness.session(childSessionId).run(request.prompt, { onNotification: observe }),
          cancelSettled.then(() => 'cancelled' as const),
        ])
        if (turn === 'cancelled') return { output: collectOutput(), stopReason: 'aborted' }
        const lastEnd = turn.events.findLast(
          (event): event is Extract<SessionEvent, { type: 'turn/end' }> => event.type === 'turn/end',
        )
        const outcome = sdkChildOutcome(lastEnd?.data.reason)
        diagnostic = outcome.diagnostic
        return {
          output: collectOutput(),
          ...outcome,
        }
      } catch (error: unknown) {
        diagnostic = failureDiagnostic(sdkFailure(error, 'session-run').facts)
        throw error
      }
    },
    collectOutput,
    collectDiagnostic: () => diagnostic,
    cancelled: () => flags.cancelled,
    onError: spec.onError,
    signal: request.signal,
    onAbort,
  })

  // There is no wire-level prompt cancel: dispose settles the result locally,
  // then the bounded shutdown request + dispose ladder tears the child down.
  return subprocessRunHandle({
    id,
    result,
    signal: request.signal,
    onAbort,
    requestCancel,
    teardown,
  })
}
