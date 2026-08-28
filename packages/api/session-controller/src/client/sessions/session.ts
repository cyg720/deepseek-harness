// Sessions remain resident after creation so their open Remote sources keep running off-screen.

/**
 * 文件职责：实现 api/session-controller 中 session 模块的职责，并向相邻模块提供可复用能力。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：支撑 DeepSeek Harness 的 api/session-controller 能力，使上层功能能够稳定组合和扩展。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { AttachmentIdType, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { SubagentAddress } from '@deepseek-ai/dsh-subagent/client'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  SessionEventStream,
  sessionStreamFailure,
} from '../transport.ts'
import type { SessionJournalChange } from '../transport.ts'
import type {
  PromptContentPart,
  QueueAction,
  SessionAddress,
  SessionControlFrame,
  SessionQueuedItem,
  SessionRequestId,
  SessionError,
} from '../../types.ts'
import type { ClientFailure, ClientResult } from '../contract/result.ts'
import { transportResult } from '../contract/result.ts'
import type {
  BeginSubmissionInput, PendingSubmissionRetirement, SessionFace, SubmissionHandle,
} from '../contract/session.ts'
import type {
  OpenState, PendingSubmission, PromptError, SessionSnapshot,
} from '../contract/snapshot.ts'
import { MutableSessionEventSource } from '../contract/events.ts'
import type {
  SessionEventLikeEntry, SessionLiveEventEntry,
} from '../contract/events.ts'
import { Notifier } from './notifier.ts'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionRemotes } from './remotes.ts'
import { ProjectionValueStore } from './projection-store.ts'
import type { ProjectionsBaseline } from './projection-store.ts'
import { resolvedClientTimeZone } from '../time-zone.ts'
import { SessionQueueMirror } from './queue-mirror.ts'

/** Messages requested per history page.
 * @remarks 中文说明：常量说明：PAGE_MESSAGES 用于处理 PAGE_MESSAGES 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const PAGE_MESSAGES = 50

/** Manager-owned observers of a Session object's local state edges. */
export interface SessionOptions {
  /** Catalog-discovered address selecting non-activating subagent transport. */
  address?: SubagentAddress
  /** Whether the exact direct parent Agent was live at the latest catalog read; absent before that read. */
  parentAvailable?: boolean
  /**
   * First ACCEPTED prompt on a blank session (fires at most once, on the
   * prompt RPC's success response): the manager mirrors the blank→false flip
   * into its list row so the session surfaces without waiting for a host
   * frame. Acceptance is the flip point because it proves the user message
   * is in the host log; a rejected first prompt keeps the session blank
   * (hidden, still reusable by connectWorkspace).
   * @remarks 中文说明：功能说明：响应 Engaged 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：session（Session）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 onEngaged(session)，并按返回类型处理结果。
   */
  onEngaged?(session: Session): void
  /**
   * Manager-owned projection value store to adopt (frames route through the
   * manager and values outlive instantiation); omitted, the Session owns a
   * private store (bare object-layer construction).
   */
  projections?: ProjectionValueStore
}

/**
 * Owns a session's event window, lifecycle state, and observable
 * snapshot. React bindings remain outside this data layer. Features see only
 * the {@link SessionFace} slice (ISession verbs + the snapshot source); the
 * remaining public members are Session Controller internals.
 * @remarks 中文说明：类说明：Session 用于集中封装 处理 Session 相关状态与行为。；核心功能：通过成员字段保存状态，
 * 并由公开方法提供受类型约束的操作入口。；使用场景：由 api/session-controller 在对应插件或业务生命周期内创建和调用。
 */
export class Session implements SessionFace {
  // ---- Window and derived state (all private; the snapshot is the only read API) ----
  /**
   * 变量说明：baseSeq 用于处理 baseSeq 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private baseSeq = 0
  /**
   * 变量说明：hasMore 用于判断是否包含 More 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private hasMore = false
  /**
   * 变量说明：openState 用于打开 State 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private openState: OpenState = 'cold'
  /**
   * 变量说明：openError 用于打开 Error 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private openError: ClientFailure | null = null
  /**
   * 变量说明：openPromise 用于打开 Promise 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private openPromise: Promise<void> | null = null
  /** Bumped by stream replacement to invalidate an in-flight doOpen. Stale
   *  passes drop all writes once the generation moves on.
   * @remarks 中文说明：变量说明：openGeneration 用于打开 Generation 相关数据，作用于成员；
   * 其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。 */
  private openGeneration = 0
  /**
   * 变量说明：loadingOlder 用于处理 loadingOlder 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  private loadingOlder = false
  /** Authoritative stream-only inbox snapshot; pending work never hits history.
   * @remarks 中文说明：常量说明：queueMirror 用于处理 queueMirror 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。 */
  private readonly queueMirror = new SessionQueueMirror()
  /**
   * 变量说明：running 用于处理 running 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private running = false
  /**
   * 变量说明：address 用于处理 address 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private address: SubagentAddress | undefined
  /**
   * 变量说明：parentAvailable 用于处理 parentAvailable 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  private parentAvailable: boolean | undefined
  /**
   * Sticky send marker, private input of the composerPhase derivation: set
   * synchronously before prompt()'s first await, never reset — the blank →
   * engaging edge of the phase machine (see ComposerPhase).
   * @remarks 中文说明：变量说明：promptAttempted 用于处理 promptAttempted 相关数据，作用于成员；
   * 其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private promptAttempted = false
  /** A first accepted prompt stays in the engaging phase until its turn is observable.
   * @remarks 中文说明：变量说明：firstPromptPendingTurn 用于处理 firstPromptPendingTurn
   * 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。 */
  private firstPromptPendingTurn = false
  /** Empty-log mirror (see ConversationSnapshot.blank); unknown bare sessions begin conservatively blank.
   * @remarks 中文说明：变量说明：blankBit 用于处理 blankBit 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。 */
  private blankBit = true
  /**
   * 变量说明：removed 用于处理 removed 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private removed = false
  /**
   * 变量说明：promptError 用于处理 promptError 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  private promptError: PromptError | null = null
  /**
   * 变量说明：lastAgentError 用于处理 lastAgentError 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  private lastAgentError: string | null = null
  /** Local submission echoes, insertion-ordered (see SessionSnapshot.pendingSubmissions).
   * @remarks 中文说明：变量说明：pendingSubmissions 用于处理 pendingSubmissions 相关数据，作用于成员；
   * 其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。 */
  private pendingSubmissions: readonly PendingSubmission[] = []
  /** Per-echo settlement state; `retiring` latches the first observation so a
   *  queue frame and its durable event cannot both retire one echo.
   * @remarks 中文说明：常量说明：submissionSettlements 用于处理 submissionSettlements 相关数据，
   * 作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
  private readonly submissionSettlements = new Map<SessionRequestId, {
    readonly onRetire?: ((retirement: PendingSubmissionRetirement) => void) | undefined
    retiring: boolean
  }>()
  /** Owns the addressed page/follow lifecycle while this Session is open.
   * @remarks 中文说明：变量说明：events 用于处理 events 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。 */
  private events: SessionEventStream | undefined

  /**
   * Per-session projection value store (push model; see the session-projection
   * subsystem page, docs/subsystems/session-projection.md): finished whole
   * values computed on the Host, seeded by the tail page's
   * projections block and updated by Session Controller control frames under the
   * one higher-seq-wins rule. Keys are read via `projections.faceOf(key)`
   * (the useProjection resolution face); the conversation snapshot never
   * carries projection values, and no client-side domain folding exists.
   * Manager-owned when constructed through SessionManager (frames route and
   * the store outlives instantiation, the title-snapshot precedent); a bare
   * construction gets a private store.
   * @remarks 中文说明：常量说明：projections 用于处理 projections 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  readonly projections: ProjectionValueStore

  /** Contiguous history and live tail consumed by Conversation assembly.
   * @remarks 中文说明：常量说明：eventSource 用于处理 eventSource 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。 */
  readonly eventSource = new MutableSessionEventSource()
  /**
   * 变量说明：snapshotCache 用于处理 snapshotCache 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  private snapshotCache: SessionSnapshot
  /**
   * 常量说明：notifier 用于处理 notifier 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly notifier: Notifier
  /**
   * Agent-scoped cordis context, bound once by ClientSessions when it
   * mints the scope (the client mirror of the host Agent's loopCtx). The
   * Session dispatches its own scoped events through it; undefined means
   * unbound (bare object-layer construction) or already pruned — both skip
   * dispatch-dependent behavior rather than fail.
   * @remarks 中文说明：变量说明：actx 用于处理 actx 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  private actx: Context | undefined

  /**
   * @param sessionId - Host session identity (client sessions are always Host-born).
   * @param remote - generated Remote namespaces this session calls.
   * @param options - optional manager-owned state observers.
   * @remarks 中文说明：功能说明：处理 Session 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：sessionId（SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：remote（SessionRemotes）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：options（SessionOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；返回值：当前类实例；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：通过 new Session(sessionId, remote,
   * options) 创建实例，并在所属生命周期内使用。
   */
  constructor(
    readonly sessionId: SessionId,
    private readonly remote: SessionRemotes,
    private readonly options: SessionOptions = {},
  ) {
    this.projections = options.projections ?? new ProjectionValueStore()
    this.address = options.address
    this.parentAvailable = options.parentAvailable
    this.notifier = new Notifier(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
        this.snapshotCache = this.buildSnapshot()
      })
    this.snapshotCache = this.buildSnapshot()
  }

  /**
   * Bind the Agent-scoped context minted by ClientSessions (single write;
   * a second bind is a wiring error and throws). Direction stays one-way at
   * this binding boundary: consumers still reach the Session via `sessions.sessionOf`,
   * while the Session holds its own dispatch point (host Agent.loopCtx
   * mirror).
   * @param actx - the agent's scoped context.
   * @remarks 中文说明：功能说明：处理 bindScope 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：actx（Context）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 bindScope(actx)，并按返回类型处理结果。
   */
  bindScope(actx: Context): void {
    if (this.actx !== undefined) throw new Error(`session ${this.sessionId} already has a bound scope`)
    this.actx = actx
  }

  /** Release the bound scope at prune time (a later rebind accompanies a freshly minted scope).
   * @remarks 中文说明：功能说明：处理 unbindScope 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 unbindScope()，并按返回类型处理结果。 */
  unbindScope(): void {
    this.actx = undefined
  }

  // ---- Operations ----

  /**
   * Register one local submission echo (see the ISession declaration).
   * Synchronous through markDirty: the echo is in the very next snapshot, so
   * the conversation can paint it before the caller starts serializing.
   * @param input - echo content and the optional settlement callback.
   * @returns the minted identity for {@link prompt} plus the pre-prompt abandon path.
   * @remarks 中文说明：功能说明：处理 beginSubmission 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：input（BeginSubmissionInput）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：SubmissionHandle；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * beginSubmission(input)，并按返回类型处理结果。
   */
  beginSubmission(input: BeginSubmissionInput): SubmissionHandle {
    /**
     * 常量说明：requestId 用于处理 requestId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const requestId = randomUUID() as SessionRequestId
    this.pendingSubmissions = [...this.pendingSubmissions, {
      requestId,
      time: Date.now(),
      text: input.text,
      images: input.images,
    }]
    this.submissionSettlements.set(requestId, { onRetire: input.onRetire, retiring: false })
    // The blank → engaging edge flips here, ahead of prompt(): the composer
    // docks and the echo renders on the click's own frame.
    this.promptAttempted = true
    this.notifier.markDirty()
    return { requestId, abandon: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { this.retireFailedSubmission(requestId) } }
  }

  /**
   * Send (queue/steer passed through 1:1); failures land in the snapshot's promptError.
   * @param content - text plus browser-owned temporary image uploads.
   * @param mode - queue appends after the current turn; steer interrupts it.
   * @param signal - optional caller cancellation for the complete admission round-trip.
   * @param requestId - identity from {@link beginSubmission}; a failed identified prompt retires its echo.
   * @returns the prompt result (also mirrored into promptError on failure).
   * @remarks 中文说明：功能说明：处理 prompt 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：content（PromptContentPart[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：mode（'queue' | 'steer'）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：signal（AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；
   * 参数说明：requestId（SessionRequestId）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<ClientResult<{ accepted: true }>>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 prompt(content, mode, signal, requestId)，并按返回类型处理结果。
   */
  async prompt(
    content: PromptContentPart[],
    mode: 'queue' | 'steer',
    signal?: AbortSignal,
    requestId?: SessionRequestId,
  ): Promise<ClientResult<{ accepted: true }>> {
    this.promptError = null
    this.lastAgentError = null
    // Synchronous, before the first await: the blank → engaging edge must be
    // visible on the session area's very first frame when a caller sends
    // ahead of navigation (first-send flow).
    this.promptAttempted = true
    if (this.blankBit) this.firstPromptPendingTurn = true
    this.notifier.markDirty()
    /**
     * 变量说明：result 用于处理 result 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let result: ClientResult<{ accepted: true }>
    try {
      if (this.address === undefined) {
        /**
         * 常量说明：clientTimeZone 用于处理 clientTimeZone 相关数据，作用于当前作用域；初始化后不可重新赋值，
         * 但对象内部是否可变仍由其类型决定。
         */
        const clientTimeZone = resolvedClientTimeZone()
        result = toSessionResult(await this.remote.session.prompt({
          requestId: requestId ?? randomUUID() as SessionRequestId,
          sessionId: this.sessionId,
          mode,
          content,
          clientTimeZone,
        }, signal))
      } else if (this.address.mode === 'one-shot') {
        result = {
          ok: false,
          error: {
            code: 'subagent-not-resumable',
            message: 'one-shot subagent conversations are read-only',
            details: { childSessionId: this.address.childSessionId },
          },
        }
      } else {
        if (content.some(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：part（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(part)，并按返回类型处理结果。
 */ part => part.type === 'image')) {
          result = {
            ok: false,
            error: {
              code: 'attachment-error',
              message: 'Image input is unavailable for subagent continuations.',
              details: { reason: 'SUBAGENT_IMAGE_UNSUPPORTED' },
            },
          }
        } else {
          /**
           * 常量说明：routed 用于处理 routed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
           */
          const routed = toSessionResult(await this.remote.subagents.prompt({
            requestId: randomUUID() as SessionRequestId,
            parentSessionId: this.address.parentSessionId,
            childSessionId: this.address.childSessionId,
            mode: this.address.mode,
            content: content.flatMap(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：part（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(part)，并按返回类型处理结果。
 */ part => part.type === 'text'
                ? [{ type: 'text' as const, text: part.text }]
                : []),
            clientTimeZone: resolvedClientTimeZone(),
          }, signal))
          result = routed.ok ? { ok: true, value: { accepted: true } } : routed
        }
      }
    } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error) {
      result = transportResult(error)
    }
    if (!result.ok) {
      if (requestId !== undefined) this.retireFailedSubmission(requestId)
      this.promptError = { op: 'send', error: result.error }
      this.notifier.markDirty()
      return result
    }
    // Blank flips on ACCEPTANCE, not attempt: an accepted prompt starts the
    // conversation's first turn on the host (the host criterion — a logged
    // turn/start — is fact, not optimism; standalone command and projection
    // events never flip it), while a rejected first prompt must keep the
    // session blank — the client-side blank mirror only ever lowers, so
    // flipping early on a failure would surface the session forever and
    // strip its connectWorkspace reuse eligibility against the host's
    // authority.
    if (this.blankBit) {
      this.blankBit = false
      this.options.onEngaged?.(this)
      this.notifier.markDirty()
    }
    return result
  }

  /**
   * Resolve one image referenced by this session into browser-consumable bytes.
   * @param attachmentId - opaque id found in the folded session log.
   * @returns the authenticated reference and decoded bytes.
   * @remarks 中文说明：功能说明：读取 Attachment 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：attachmentId（AttachmentIdType）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<ClientResult<{ attachment: ImageAttachmentRef; data:
   * Uint8Arr…；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * readAttachment(attachmentId)，并按返回类型处理结果。
   */
  async readAttachment(
    attachmentId: AttachmentIdType,
  ): Promise<ClientResult<{ attachment: ImageAttachmentRef; data: Uint8Array }>> {
    try {
      /**
       * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const result = await this.remote.session.attachment({
        sessionId: this.sessionId,
        attachmentId,
      })
      if (!result.ok) return toSessionResult(result)
      /**
       * 常量说明：binary 用于处理 binary 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const binary = atob(result.value.data)
      /**
       * 常量说明：data 用于处理 data 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const data = Uint8Array.from(binary, /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：char（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(char)，并按返回类型处理结果。
 */ char => char.charCodeAt(0))
      return { ok: true, value: { attachment: result.value.attachment, data } }
    } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error) {
      return transportResult(error)
    }
  }

  /** Apply one operation to a still-pending queue occurrence.
   * @remarks 中文说明：功能说明：更新 Queue 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：itemId（MessageId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：action（QueueAction）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<ClientResult<{ accepted: true }>>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 updateQueue(itemId, action)，并按返回类型处理结果。 */
  async updateQueue(itemId: MessageId, action: QueueAction): Promise<ClientResult<{ accepted: true }>> {
    try {
      return toSessionResult(await this.remote.session.updateQueue({ sessionId: this.sessionId, itemId, action }))
    } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error) {
      return transportResult(error)
    }
  }

  /**
   * Stop the active turn while the Host preserves pending inbox work; failures
   * land in promptError (same error-strip display slot). A continuable
   * subagent address routes through `subagents.interruptByParent`, whose durable
   * parent-address authority works without a live parent Agent; a one-shot
   * address stays uncancellable (the UI offers no stop action, so this arm is
   * defensive).
   * @returns the cancel result.
   * @remarks 中文说明：功能说明：处理 cancel 相关流程；使用场景由所在模块及调用位置决定。；
   * 返回值：Promise<ClientResult<{ accepted: true }>>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 cancel()，并按返回类型处理结果。
   */
  async cancel(): Promise<ClientResult<{ accepted: true }>> {
    /**
     * 常量说明：address 用于处理 address 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const address = this.address
    if (address !== undefined && address.mode === 'one-shot') {
      /**
       * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const result: ClientResult<{ accepted: true }> = {
        ok: false,
        error: {
          code: 'subagent-delivery-unavailable',
          message: 'subagent activation cancellation is unavailable',
          details: { childSessionId: address.childSessionId },
        },
      }
      this.promptError = { op: 'stop', error: result.error }
      this.notifier.markDirty()
      return result
    }
    /**
     * 变量说明：result 用于处理 result 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let result: ClientResult<{ accepted: true }>
    try {
      result = address !== undefined
        ? toSessionResult(await this.remote.subagents.interruptByParent(
          address.childSessionId,
          address.parentSessionId,
          address.mode,
        ))
        : toSessionResult(await this.remote.session.cancel({ sessionId: this.sessionId }))
    } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error) {
      result = transportResult(error)
    }
    if (!result.ok) {
      this.promptError = { op: 'stop', error: result.error }
      this.notifier.markDirty()
    }
    return result
  }

  /**
   * Rename: contract session.rename 1:1. On success settle the 'title'
   * projection cell from the response's `{title, seq}` under the store's
   * higher-seq-wins rule (the push frame arriving later is a no-op replay),
   * so the list row and any useProjection('title') reader update without
   * waiting for the control-stream projection update.
   * @param title - raw title text (the host normalizes acceptance).
   * @returns the rename result (normalized accepted title + title event seq).
   * @remarks 中文说明：功能说明：处理 rename 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：title（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<ClientResult<{ title: string; seq: number }>>；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 rename(title)，并按返回类型处理结果。
   */
  async rename(title: string): Promise<ClientResult<{ title: string; seq: number }>> {
    try {
      /**
       * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const result = toSessionResult(await this.remote.session.rename({ sessionId: this.sessionId, title }))
      if (result.ok) this.projections.apply('title', result.value.title, result.value.seq)
      return result
    } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error) {
      return transportResult(error)
    }
  }

  /**
   * Execute one slash-command line against this session's agent — pure
   * admission semantics (the host executor durably logs the lifecycle;
   * outcomes render as flow nodes, never as a response echo).
   * @param line - the full command line, leading slash included.
   * @returns the admission result, or the error branch on transport failure.
   * @remarks 中文说明：功能说明：处理 command 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：line（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<RemoteResult<{ matched: boolean }>>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * ；使用示例：典型用法：在完成前置校验后调用 command(line)，并按返回类型处理结果。
   */
  async command(line: string): Promise<RemoteResult<{ matched: boolean }>> {
    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = await this.remote.commands.execute(this.sessionId, line, [])
    if (!result.ok) return result
    return { ok: true, value: { matched: result.value !== undefined } }
  }

  /** First open: pull the tail page (idempotent — in-flight/already-open returns the existing promise).
   * @remarks 中文说明：功能说明：打开 open 相关流程；使用场景由所在模块及调用位置决定。；返回值：Promise<void>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 open()，并按返回类型处理结果。 */
  open(): Promise<void> {
    if (this.openState === 'open') return Promise.resolve()
    if (this.openPromise !== null) return this.openPromise
    /**
     * 常量说明：promise 用于处理 promise 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const promise = this.doOpen(this.openGeneration).finally(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
      // Identity-guarded: a superseded open must not null out the promise resync just started.
        if (this.openPromise === promise) this.openPromise = null
      })
    this.openPromise = promise
    return promise
  }

  /** Page up: pull one earlier page with the window's first seq as beforeSeq and prepend.
   * @remarks 中文说明：功能说明：加载 Older 相关流程；使用场景由所在模块及调用位置决定。；返回值：Promise<void>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 loadOlder()，并按返回类型处理结果。 */
  async loadOlder(): Promise<void> {
    if (this.openState !== 'open' || !this.hasMore || this.loadingOlder) return
    /**
     * 常量说明：events 用于处理 events 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const events = this.events
    if (events === undefined) return
    this.loadingOlder = true
    this.notifier.markDirty()
    try {
      await events.prepend({ beforeSeq: this.baseSeq, maxMessages: PAGE_MESSAGES })
    } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error) {
      if (sessionStreamFailure(error) === undefined) {
        console.error('[session-controller] loadOlder failed:', error)
      }
    } finally {
      this.loadingOlder = false
      this.notifier.markDirty()
    }
  }

  /** Rebuild an opened history source after address replacement.
   *  Invalidates any in-flight open first; queue state belongs to the independently
   *  reconnecting control stream and remains untouched.
   * @remarks 中文说明：功能说明：处理 resync 相关流程；使用场景由所在模块及调用位置决定。；返回值：Promise<void>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 resync()，并按返回类型处理结果。 */
  async resync(): Promise<void> {
    if (this.openState === 'cold') return // never opened: no window to rebuild (doOpen flips to 'loading' synchronously, so cold implies no in-flight open)
    this.openGeneration++
    /**
     * 常量说明：events 用于处理 events 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const events = this.events
    this.events = undefined
    await events?.dispose()
    this.openPromise = null
    this.openState = 'cold'
    this.openError = null
    this.baseSeq = 0
    this.notifier.markDirty()
    await this.open()
  }

  // ---- Subscription API (useSyncExternalStore direct wiring) ----

  /**
   * uSES subscription entry.
   * @param listener - change callback.
   * @returns the unsubscribe function.
   * @remarks 中文说明：功能说明：处理 subscribe 相关流程；使用场景由所在模块及调用位置决定。；参数说明：listener（()
   * => void）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。；返回值：() => void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 subscribe(listener)，并按返回类型处理结果。
   */
  subscribe(listener: () => void): () => void {
    return this.notifier.subscribe(listener)
  }

  /**
   * Cached Session snapshot (rebuilt lazily when dirty with no listeners).
   * @returns the cached reference (stable until the next flush).
   * @remarks 中文说明：功能说明：获取 Snapshot 相关流程；使用场景由所在模块及调用位置决定。；
   * 返回值：SessionSnapshot；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * getSnapshot()，并按返回类型处理结果。
   */
  getSnapshot(): SessionSnapshot {
    this.notifier.ensureFresh()
    return this.snapshotCache
  }

  // ---- Manager-only entry points (@internal; never called by the UI) ----

  /**
   * Replace every transient control value for this Session from one stream baseline.
   * @param queue - complete pending queue for this Session.
   * @remarks 中文说明：功能说明：处理 replaceControl 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：queue（readonly SessionQueuedItem[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * replaceControl(queue)，并按返回类型处理结果。
   */
  replaceControl(queue: readonly SessionQueuedItem[]): void {
    this.queueMirror.replace(queue)
    this.observeSubmissionQueue(queue)
    this.notifier.markDirty()
  }

  /**
   * Apply one Session-addressed live control update.
   * @param frame - queue replacement addressed to this Session.
   * @remarks 中文说明：功能说明：处理 Control Frame 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：frame（Extract<SessionControlFrame, { type: 'queue' }>）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 handleControlFrame(frame)，并按返回类型处理结果。
   */
  handleControlFrame(frame: Extract<SessionControlFrame, { type: 'queue' }>): void {
    this.queueMirror.replace(frame.items)
    this.observeSubmissionQueue(frame.items)
    this.notifier.markDirty()
  }

  /**
   * Running-bit relay from the host stream (list entry and snapshot stay consistent).
   * @param running - the new running state.
   * @remarks 中文说明：功能说明：处理 Running 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：running（boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 handleRunning(running)，并按返回类型处理结果。
   */
  handleRunning(running: boolean): void {
    // Turn-start conversion: a blank session never runs, so the first
    // running:true proves another side's first message landed.
    if (running && this.blankBit) {
      this.blankBit = false
      this.notifier.markDirty()
    }
    if (running) this.firstPromptPendingTurn = false
    if (this.running === running) return
    this.running = running
    this.notifier.markDirty()
  }

  /**
   * Install or clear the catalog-discovered transport address. A changed
   * address rebuilds an already-open window through its new history route.
   * @param address - direct parent/child address, or undefined for ordinary transport.
   * @param parentAvailable - latest exact-parent availability hint, or undefined before a catalog read.
   * @remarks 中文说明：功能说明：处理 configureSubagent 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：address（SubagentAddress | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：parentAvailable（boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * configureSubagent(address, parentAvailable)，并按返回类型处理结果。
   */
  configureSubagent(address: SubagentAddress | undefined, parentAvailable?: boolean): void {
    /**
     * 常量说明：same 用于处理 same 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const same = this.address?.parentSessionId === address?.parentSessionId
      && this.address?.childSessionId === address?.childSessionId
      && this.address?.mode === address?.mode
    this.address = address
    this.parentAvailable = parentAvailable
    if (!same && this.openState !== 'cold') void this.resync()
    else this.notifier.markDirty()
  }

  /**
   * Update only the parent availability hint from a catalog refresh.
   * @param available - whether the exact direct parent is live.
   * @remarks 中文说明：功能说明：处理 Subagent Parent Available 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：available（boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * handleSubagentParentAvailable(available)，并按返回类型处理结果。
   */
  handleSubagentParentAvailable(available: boolean): void {
    if (this.parentAvailable === available) return
    this.parentAvailable = available
    this.notifier.markDirty()
  }

  /**
   * Blank-bit relay from the authoritative summary source (`session.list` and
   * `api-session/added`). Monotone: once any signal (local first send,
   * running flip, an earlier summary) cleared it, a stale true never
   * re-blanks.
   * @param blank - the summary's derived empty-log bit.
   * @remarks 中文说明：功能说明：处理 Blank 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：blank（boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 handleBlank(blank)，并按返回类型处理结果。
   */
  handleBlank(blank: boolean): void {
    if (blank === this.blankBit) return
    if (blank && (this.promptAttempted || this.running)) return
    this.blankBit = blank
    this.notifier.markDirty()
  }

  /** `api-session/removed` relay: flag the snapshot while retaining the resident instance.
   * @remarks 中文说明：功能说明：处理 Removed 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 handleRemoved()，
   * 并按返回类型处理结果。 */
  handleRemoved(): void {
    this.removed = true
    this.notifier.markDirty()
  }

  /**
   * `api-session/error` relay: the outlet for live failures with no turn position.
   * @param message - the stringified error.
   * @remarks 中文说明：功能说明：处理 Agent Error 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：message（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 handleAgentError(message)，并按返回类型处理结果。
   */
  handleAgentError(message: string): void {
    this.lastAgentError = message
    this.notifier.markDirty()
  }

  /**
   * Stop the Session's live Remote source.
   * @returns when the Remote iterator has completed teardown.
   * @remarks 中文说明：功能说明：处理 dispose 相关流程；使用场景由所在模块及调用位置决定。；返回值：Promise<void>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 dispose()，并按返回类型处理结果。
   */
  async dispose(): Promise<void> {
    // Unsettled echoes retire as failed so their owners can restore or
    // release browser resources; echoes already scheduled as observed keep
    // that settlement.
    for (const /*
     * 变量说明：requestId 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */ requestId of [...this.submissionSettlements.keys()]) {
      this.retireFailedSubmission(requestId)
    }
    this.openGeneration++
    /**
     * 常量说明：events 用于处理 events 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const events = this.events
    this.events = undefined
    await events?.dispose()
  }

  // ---- Private ----

  /** @param generation - openGeneration at launch; stale passes cannot publish after replacement.
   * @remarks 中文说明：功能说明：处理 doOpen 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：generation（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<void>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 doOpen(generation)，
   * 并按返回类型处理结果。 */
  private async doOpen(generation: number): Promise<void> {
    this.openState = 'loading'
    this.openError = null
    this.notifier.markDirty()
    /**
     * 常量说明：events 用于处理 events 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const events = new SessionEventStream(this.remote, this.sessionAddress(), {
      publish: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：change（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(change)，并按返回类型处理结果。
 */ (change) => {
        if (generation !== this.openGeneration || this.events !== events) return
        this.acceptEventChange(change)
      },
      failed: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：error（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(error)，并按返回类型处理结果。
 */ (error) => {
        this.failEventStream(events, generation, error)
      },
    })
    this.events = events
    try {
      await events.open({ maxMessages: PAGE_MESSAGES })
      if (generation !== this.openGeneration || this.events !== events) return
      this.openState = 'open'
    } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error) {
      if (generation !== this.openGeneration || this.events !== events) return
      this.events = undefined
      this.openState = 'error'
      this.openError = openFailure(error)
    } finally {
      if (generation === this.openGeneration) this.notifier.markDirty()
    }
  }

  /** Apply one contiguous journal update already reconciled by the Remote stream.
   * @remarks 中文说明：功能说明：处理 acceptEventChange 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：change（SessionJournalChange）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 acceptEventChange(change)，
   * 并按返回类型处理结果。 */
  private acceptEventChange(change: SessionJournalChange): void {
    switch (change.type) {
      case 'replace':
        this.installWindow(change.entries, change.hasMore, change.page.projections)
        return
      case 'prepend':
        this.prependWindow(change.entries, change.hasMore)
        return
      case 'append':
        if (this.appendLive(change.entry)) this.notifier.markDirty()
    }
  }

  /** Replace the complete contiguous window and apply page-owned projection metadata.
   * @remarks 中文说明：功能说明：处理 installWindow 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：entries（readonly SessionEventLikeEntry[]）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；参数说明：hasMore（boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：projections（ProjectionsBaseline）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * installWindow(entries, hasMore, projections)，并按返回类型处理结果。 */
  private installWindow(entries: readonly SessionEventLikeEntry[], hasMore: boolean, projections?: ProjectionsBaseline): void {
    this.baseSeq = entries[0]?.event.seq ?? 0
    this.hasMore = hasMore
    if (entries.some(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：entry（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(entry)，并按返回类型处理结果。
 */ entry => entry.event.type === 'turn/start')) this.firstPromptPendingTurn = false
    if (projections !== undefined) this.projections.seed(projections)
    this.eventSource.replace(entries, hasMore)
    for (const /*
     * 变量说明：entry 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */ entry of entries) this.observeSubmissionEvent(entry.event)
    this.notifier.markDirty()
  }

  /** Prepend one stream-validated history page.
   * @remarks 中文说明：功能说明：处理 prependWindow 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：entries（readonly SessionEventLikeEntry[]）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；参数说明：hasMore（boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * prependWindow(entries, hasMore)，并按返回类型处理结果。 */
  private prependWindow(entries: readonly SessionEventLikeEntry[], hasMore: boolean): void {
    this.baseSeq = entries[0]?.event.seq ?? this.baseSeq
    this.hasMore = hasMore
    this.eventSource.prepend(entries, hasMore)
  }

  /** Append one stream-validated live event.
   * @remarks 中文说明：功能说明：处理 appendLive 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：entry（SessionLiveEventEntry）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：boolean；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * appendLive(entry)，并按返回类型处理结果。 */
  private appendLive(entry: SessionLiveEventEntry): boolean {
    /**
     * 常量说明：event 用于处理 event 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const event = entry.event
    /**
     * 常量说明：awaitingFirstTurn 用于处理 awaitingFirstTurn 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const awaitingFirstTurn = this.firstPromptPendingTurn
    if (event.type === 'turn/start') this.firstPromptPendingTurn = false
    /**
     * 常量说明：queueChanged 用于处理 queueChanged 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const queueChanged = this.queueMirror.acceptDurable(event)
    this.eventSource.append(entry)
    // After the feed append: the conversation assembly's animation frame is
    // registered by the feed subscribers above, so the echo-retirement frame
    // scheduled here always runs after the durable node became renderable.
    this.observeSubmissionEvent(event)
    return queueChanged || awaitingFirstTurn !== this.firstPromptPendingTurn
  }

  /** Retire the matching echo when a durable browser-prompt `user/message` becomes visible.
   * @remarks 中文说明：功能说明：处理 observeSubmissionEvent 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：event（{ readonly type: string; readonly data?: unknown
   * }）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 observeSubmissionEvent(event)，并按返回类型处理结果。 */
  private observeSubmissionEvent(event: { readonly type: string; readonly data?: unknown }): void {
    if (this.submissionSettlements.size === 0 || event.type !== 'user/message') return
    // Structural read: window entries may be compact history records, so the
    // fields are narrowed rather than trusted (same posture as Conversation
    // assembly matchers).
    /**
     * 常量说明：data 用于处理 data 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const data = event.data as { readonly source?: unknown; readonly content?: unknown } | undefined
    /**
     * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const source = data?.source as { readonly kind?: unknown; readonly rpcId?: unknown } | undefined
    if (source?.kind !== 'user' || typeof source.rpcId !== 'string') return
    this.scheduleObservedRetirement(source.rpcId as SessionRequestId, imageRefsIn(data?.content))
  }

  /** Retire echoes whose prompts landed in the host inbox instead of the log (running-turn submissions).
   * @remarks 中文说明：功能说明：处理 observeSubmissionQueue 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：items（readonly SessionQueuedItem[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * observeSubmissionQueue(items)，并按返回类型处理结果。 */
  private observeSubmissionQueue(items: readonly SessionQueuedItem[]): void {
    if (this.submissionSettlements.size === 0) return
    for (const /*
     * 变量说明：item 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */ item of items) {
      if (item.rpcId !== undefined) {
        this.scheduleObservedRetirement(item.rpcId, imageRefsIn(item.message.content))
      }
    }
  }

  /**
   * Latch one observed settlement and remove the echo an animation frame
   * later. The delay keeps the echo in the snapshot until the frame in which
   * the durable node (whose assembly frame was registered first) is
   * renderable; the render-time rpcId dedupe hides the one-frame overlap.
   * @remarks 中文说明：功能说明：处理 scheduleObservedRetirement 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：requestId（SessionRequestId）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；
   * 参数说明：attachments（readonly ImageAttachmentRef[]）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 scheduleObservedRetirement(requestId, attachments)，
   * 并按返回类型处理结果。
   */
  private scheduleObservedRetirement(
    requestId: SessionRequestId,
    attachments: readonly ImageAttachmentRef[],
  ): void {
    /**
     * 常量说明：settlement 用于处理 settlement 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const settlement = this.submissionSettlements.get(requestId)
    if (settlement === undefined || settlement.retiring) return
    settlement.retiring = true
    scheduleFrame(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { this.finishSubmission(requestId, { reason: 'observed', attachments }) })
  }

  /** Remove one unsettled echo immediately (prompt rejection, abort, or disposal).
   * @remarks 中文说明：功能说明：处理 retireFailedSubmission 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：requestId（SessionRequestId）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * retireFailedSubmission(requestId)，并按返回类型处理结果。 */
  private retireFailedSubmission(requestId: SessionRequestId): void {
    /**
     * 常量说明：settlement 用于处理 settlement 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const settlement = this.submissionSettlements.get(requestId)
    if (settlement === undefined || settlement.retiring) return
    settlement.retiring = true
    this.finishSubmission(requestId, { reason: 'failed' })
  }

  /** Single removal point: drop the echo, publish, then notify the owner.
   * @remarks 中文说明：功能说明：处理 finishSubmission 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：requestId（SessionRequestId）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；
   * 参数说明：retirement（PendingSubmissionRetirement）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 finishSubmission(requestId, retirement)，并按返回类型处理结果。 */
  private finishSubmission(requestId: SessionRequestId, retirement: PendingSubmissionRetirement): void {
    /**
     * 常量说明：settlement 用于处理 settlement 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const settlement = this.submissionSettlements.get(requestId)
    /* v8 ignore next -- retiring latches before every schedule, so one settlement never finishes twice. */
    if (settlement === undefined) return
    this.submissionSettlements.delete(requestId)
    this.pendingSubmissions = this.pendingSubmissions.filter(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：echo（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(echo)，并按返回类型处理结果。
 */ echo => echo.requestId !== requestId)
    this.notifier.markDirty()
    settlement.onRetire?.(retirement)
  }

  /** Publish a terminal background failure only while this stream still owns the Session.
   * @remarks 中文说明：功能说明：处理 failEventStream 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：events（SessionEventStream）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：generation（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：error（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 failEventStream(events, generation,
   * error)，并按返回类型处理结果。 */
  private failEventStream(events: SessionEventStream, generation: number, error: unknown): void {
    if (generation !== this.openGeneration || this.events !== events) return
    this.openGeneration++
    this.events = undefined
    this.openPromise = null
    this.openState = 'error'
    this.openError = openFailure(error)
    void events.dispose()
    this.notifier.markDirty()
  }

  /**
   * 功能说明：构建 Snapshot 相关流程；使用场景由所在模块及调用位置决定。
   * @returns SessionSnapshot；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 buildSnapshot()，并按返回类型处理结果。
   */
  private buildSnapshot(): SessionSnapshot {
    return {
      sessionId: this.sessionId,
      queue: this.queueMirror.snapshot(),
      pendingSubmissions: this.pendingSubmissions,
      running: this.running,
      subagent: this.address === undefined
        ? null
        : {
          address: this.address,
          ...(this.parentAvailable === undefined ? {} : { parentAvailable: this.parentAvailable }),
        },
      removed: this.removed,
      openState: this.openState,
      openError: this.openError,
      hasMore: this.hasMore,
      loadingOlder: this.loadingOlder,
      promptError: this.promptError,
      blank: this.blankBit,
      lastAgentError: this.lastAgentError,
      promptAttempted: this.promptAttempted,
      awaitingFirstTurn: this.firstPromptPendingTurn,
    }
  }

  /**
   * 功能说明：处理 sessionAddress 相关流程；使用场景由所在模块及调用位置决定。
   * @returns SessionAddress；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 sessionAddress()，并按返回类型处理结果。
   */
  private sessionAddress(): SessionAddress {
    return this.address === undefined
      ? { kind: 'session', sessionId: this.sessionId }
      : { kind: 'subagent', ...this.address }
  }
}

/** Run one callback on the next animation frame, or a macrotask where no frame clock exists.
 * @remarks 中文说明：功能说明：处理 scheduleFrame 相关流程；使用场景由所在模块及调用位置决定。；参数说明：fn（() =>
 * void）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 scheduleFrame(fn)，并按返回类型处理结果。 */
function scheduleFrame(fn: () => void): void {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { fn() })
  else setTimeout(fn, 0)
}

/** Image attachment references in one structurally-read content block list, in block order.
 * @remarks 中文说明：功能说明：处理 imageRefsIn 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：content（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：readonly
 * ImageAttachmentRef[]；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * imageRefsIn(content)，并按返回类型处理结果。 */
function imageRefsIn(content: unknown): readonly ImageAttachmentRef[] {
  if (!Array.isArray(content)) return []
  /**
   * 常量说明：refs 用于处理 refs 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const refs: ImageAttachmentRef[] = []
  for (const /*
   * 变量说明：block 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */ block of content) {
    if (typeof block !== 'object' || block === null) continue
    /**
     * 常量说明：candidate 用于处理 candidate 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const candidate = block as { readonly type?: unknown; readonly attachment?: unknown }
    if (candidate.type === 'image' && typeof candidate.attachment === 'object' && candidate.attachment !== null) {
      refs.push(candidate.attachment as ImageAttachmentRef)
    }
  }
  return refs
}

/** Convert a terminal Session stream failure to the Client error vocabulary.
 * @remarks 中文说明：功能说明：打开 Failure 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：error（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：ClientFailure；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 openFailure(error)，
 * 并按返回类型处理结果。 */
function openFailure(error: unknown): ClientFailure {
  /**
   * 常量说明：failure 用于处理 failure 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const failure = sessionStreamFailure(error)
  if (failure !== undefined) return failure as SessionError
  /**
   * 常量说明：folded 用于处理 folded 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const folded = transportResult<never>(error)
  /* v8 ignore next -- transportResult never returns an ok result. */
  if (folded.ok) throw new Error('transportResult returned an unexpected success')
  return folded.error
}
/** Narrow a generated Session Remote failure to its service-owned error vocabulary.
 * @remarks 中文说明：功能说明：处理 toSessionResult 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：result（RemoteResult<T>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：ClientResult<T>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * toSessionResult(result)，并按返回类型处理结果。 */
function toSessionResult<T>(result: RemoteResult<T>): ClientResult<T> {
  return result.ok ? result : { ok: false, error: result.error as SessionError }
}
