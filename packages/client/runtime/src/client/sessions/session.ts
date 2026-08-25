/**
 * ================================ 文件注释 ================================
 * 【文件职责】Session：拥有一个会话的事件窗口、派生会话状态与可观察快照。
 *   创建后保持驻留，以便在屏幕外继续消费 mux 帧；React 绑定在数据层之外。
 * 【技术维度】事件折叠 + Notifier 快照模式：窗口事件被折叠进会话对话
 *   状态机（ConversationNodeAssembler）；快照是唯一读 API；历史分页、
 *   重连重建、队列镜像、投影存储各自成体系。
 * 【产品维度】会话是聊天交互的核心对象：发送/插话、取消、重命名、命令、
 *   附件读取、历史翻页都从这里发起，同时持续向 UI 发布最新快照。
 * 【逻辑维度】字段区定义全部私有状态（窗口、游标、队列镜像、投影存储、
 *   作用域 ctx）；操作区（prompt/cancel/rename/command/readAttachment/
 *   updateQueue）；窗口区（open/loadOlder/resync/stitching 等）。
 * 【关键边界】blank 位只在"首条被接受"时翻转为 false（受理证明已入日志）；
 *   重连世代号使过期 open 不落地；pending 等待只以列表成员关系表达结算。
 * 【新手阅读建议】先读 conversation.ts 的快照类型，再看本类折叠与发布。
 * ==========================================================================
 */
// Sessions remain resident after creation so they continue consuming mux frames off-screen.
// 会话创建后保持驻留，以便在屏幕外继续消费 mux 帧。

import type { Context } from '@deepseek-ai/cordis'
import type { AttachmentIdType, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type {
  HistoryEntry, IApiClient, MessageId, MuxFrame, PromptContentPart, QueueAction, RpcError,
  RpcId, RpcResponse, RpcResult, SessionId, SubagentAddress, ToolEventView,
} from '@deepseek-ai/dsh-api-remotes/client'
// Value import from the inline-safe wire layer (not the connection plugin):
// plugin-to-plugin value imports are a bundle purity error.
// 从内联安全的 wire 层做值导入（而非 connection 插件）：插件到插件的值导入
// 是捆绑纯净性错误。
import { transportError } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { SessionFace } from '../contract/session.ts'
import { ConversationNodeAssembler } from './conversation-assembler.ts'
import type { ConversationRuntime } from './conversation-assembler.ts'
import type { ConversationEventInput, ConversationPublication } from '../contract/conversation.ts'
import type {
  ChatSnapshot, ComposerPhase, ConversationSnapshot, OpenState, PromptError,
} from './conversation.ts'
import { EMPTY_CHAT_SNAPSHOT } from './conversation.ts'
import type { PendingInteraction } from './pending.ts'
import { PendingWait } from './pending.ts'
import { Notifier } from './notifier.ts'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionRemotes } from './remotes.ts'
import { ProjectionValueStore } from './projection-store.ts'
import type { ProjectionsBaseline } from './projection-store.ts'
import { resolvedClientTimeZone } from '../time-zone.ts'
import { SessionQueueMirror } from './queue-mirror.ts'

/** Messages requested per history page. */
/* 每页历史请求的消息数。 */
export const PAGE_MESSAGES = 50

/** Manager-owned observers of a Session object's local state edges. */
/* 管理器拥有的、观察 Session 对象本地状态边界的钩子。 */
export interface SessionOptions {
  /** Catalog-discovered address selecting non-activating subagent transport. */
  /* 目录发现的地址，选择非激活的子代理传输。 */
  address?: SubagentAddress
  /** Whether the exact direct parent Agent was live at the latest catalog read. */
  /* 最近一次目录读取时精确直接父 Agent 是否存活。 */
  parentAvailable?: boolean
  /**
   * First ACCEPTED prompt on a blank session (fires at most once, on the
   * prompt RPC's success response): the manager mirrors the blank→false flip
   * into its list row so the session surfaces without waiting for a host
   * frame. Acceptance is the flip point because it proves the user message
   * is in the host log; a rejected first prompt keeps the session blank
   * (hidden, still reusable by connectWorkspace).
   */
  /*
   * 空白会话上的首条被接受提示词（最多触发一次，在 prompt RPC 成功响应
   * 时）：管理器把 blank -> false 翻转镜像进其列表行，使会话不必等 Host
   * 帧即浮出。受理是翻转点，因为它证明用户消息已在 Host 日志；被拒绝的
   * 首条提示词保持会话空白（隐藏，仍可被 connectWorkspace 复用）。
   */
  onEngaged?(session: Session): void
  /**
   * Manager-owned projection value store to adopt (frames route through the
   * manager and values outlive instantiation); omitted, the Session owns a
   * private store (bare object-layer construction).
   */
  /*
   * 要采纳的管理器自有投影值存储（帧经管理器路由，值比实例更长寿）；
   * 省略时 Session 自持私有存储（裸对象层构造）。
   */
  projections?: ProjectionValueStore
  /** Runtime registries used by this Session-owned Conversation assembler. */
  /* 本会话拥有的会话装配器使用的运行时注册表。 */
  conversation?: ConversationRuntime
}

/**
 * Owns a session's event window, derived conversation state, and observable
 * snapshot. React bindings remain outside this data layer. Features see only
 * the {@link SessionFace} slice (ISession verbs + the snapshot source); the
 * remaining public members are manager/runtime entry points.
 */
/*
 * 拥有会话的事件窗口、派生会话状态与可观察快照。React 绑定留在该数据层
 * 之外。功能包只看到 SessionFace 切片（ISession 动词 + 快照源）；其余
 * 公开成员是管理器/运行时入口。
 */
export class Session implements SessionFace {
  // ---- Window and derived state (all private; the snapshot is the only read API) ----
  // ---- 窗口与派生状态（全部私有；快照是唯一读 API） ----
  private events: SessionEvent[] = [] // 连续窗口内的原始事件（按 seq 升序）
  /** Wire views aligned with `events` by index (envelope-level annotations; undefined = no view).
   *  Kept parallel rather than merged so `events` stays the raw log slice (model-visible ⟺ logged). */
  /* 与 events 按下标对齐的 wire 视图（信封级注解；undefined = 无视图）。
   *  保持平行数组而非合并，使 events 保持原始日志切片（模型可见 ⟺ 已记录）。 */
  private views: (ToolEventView | undefined)[] = []
  private baseSeq = 0 // 窗口首事件的 seq（分页边界）
  private hasMore = false // 是否还有更早的历史可翻
  private openState: OpenState = 'cold'
  private openError: RpcError | null = null
  private openPromise: Promise<void> | null = null // 进行中的 open（幂等共享）
  /** Bumped by resync to invalidate an in-flight doOpen: a reconnect must rebuild, never adopt
   *  a pre-disconnect open whose history request is already doomed. Stale doOpen
   *  passes drop all writes once the generation moves on. */
  /* 由 resync 递增以使进行中的 doOpen 失效：重连必须重建，绝不采纳断连前
   *  其历史请求已注定失败的开窗。世代前进后，过期的 doOpen 阶段丢弃全部写。 */
  private openGeneration = 0
  private loadingOlder = false // 正在翻更早的历史
  private pending = new Map<string, PendingInteraction>() // 待处理交互表（键 = PendingWait.key）
  private pendingRev = 0 // pending 列表修订号
  private pendingCache: { rev: number; value: PendingInteraction[] } | null = null // pending 列表缓存
  /** Authoritative stream-only inbox snapshot; pending work never hits history. */
  /* 权威的仅流收件箱快照；待处理工作绝不进入历史。 */
  private readonly queueMirror = new SessionQueueMirror()
  /** Session-owned business Context engine over the contiguous raw window. */
  /* 覆盖连续原始窗口的会话自有业务上下文引擎。 */
  private readonly conversation: ConversationNodeAssembler
  private running = false // 是否有运行中的轮次
  private address: SubagentAddress | undefined
  private parentAvailable = false
  /**
   * Sticky send marker, private input of the composerPhase derivation: set
   * synchronously before prompt()'s first await, never reset — the blank →
   * engaging edge of the phase machine (see ComposerPhase).
   */
  /*
   * 粘性发送标记，composerPhase 推导的私有输入：在 prompt() 首次 await 前
   * 同步置位，永不重置——阶段机的 blank -> engaging 边（见 ComposerPhase）。
   */
  private promptAttempted = false
  /** A first accepted prompt stays in the engaging phase until its turn is observable. */
  /* 首条被接受提示词在轮次可见前保持 engaging 阶段。 */
  private firstPromptPendingTurn = false
  /** Empty-log mirror (see ConversationSnapshot.blank); unknown bare sessions begin conservatively blank. */
  /* 空日志镜像（见 ConversationSnapshot.blank）；未知裸会话保守地从空白开始。 */
  private blankBit = true
  private removed = false // host/session-removed 后置位
  private promptError: PromptError | null = null
  private lastAgentError: string | null = null
  /** Live events buffered during open/resync and stitched by sequence once history lands. */
  /* open/resync 期间缓冲的实时事件；历史落地后按序列缝合。 */
  private liveBuffer: { event: SessionEvent; view: ToolEventView | undefined }[] = []
  /** Gap repair in flight; live events detour to the buffer until the tail page lands. */
  /* 间隙修复进行中；实时事件绕道缓冲，直到尾部页落地。 */
  private stitching = false
  /** subscribed.lastSeq baseline (gap detection; null when no subscribed frame arrived — degrade to the liveBuffer dedup path). */
  /* subscribed.lastSeq 基线（间隙检测；无订阅帧到达时为 null——降级到 liveBuffer 去重路径）。 */
  private subscribedLastSeq: number | null = null

  /**
   * Per-session projection value store (push model; see the session-projection
   * subsystem page, docs/subsystems/session-projection.md): finished whole
   * values computed on the host, seeded by the tail page's
   * projections block and updated by `session/projection` frames under the
   * one higher-seq-wins rule. Keys are read via `projections.faceOf(key)`
   * (the useProjection resolution face); the conversation snapshot never
   * carries projection values, and no client-side domain folding exists.
   * Manager-owned when constructed through SessionManager (frames route and
   * the store outlives instantiation, the title-snapshot precedent); a bare
   * construction gets a private store.
   */
  /*
   * 按会话的投影值存储（推送模型；见 docs/subsystems/session-projection.md）：
   * Host 计算的完整值，由尾部页 projections 块播种、由 session/projection
   * 帧更新，遵循单一"更高 seq 胜"规则。键经 projections.faceOf(key) 读取
   * （useProjection 解析面）；会话快照绝不携带投影值，也无客户端域折叠。
   * 经 SessionManager 构造时为管理器所有（帧路由且存储比实例长寿——
   * 标题快照先例）；裸构造得到私有存储。
   */
  readonly projections: ProjectionValueStore

  private snapshotCache: ConversationSnapshot // 快照缓存
  private readonly notifier: Notifier
  /**
   * Agent-scoped cordis context, bound once by SessionRuntime when it
   * mints the scope (the client mirror of the host Agent's loopCtx). The
   * Session dispatches its own scoped events through it; undefined means
   * unbound (bare object-layer construction) or already pruned — both skip
   * dispatch-dependent behavior rather than fail.
   */
  /*
   * Agent 作用域化的 Cordis 上下文，由 SessionRuntime 铸造作用域时绑定一次
   * （Host Agent loopCtx 的客户端镜像）。Session 通过它分发自己的作用域
   * 事件；undefined 表示未绑定（裸对象层构造）或已被裁剪——两者都跳过
   * 依赖分发的行为而非失败。
   */
  private actx: Context | undefined

  /**
   * @param sessionId - Host session identity (client sessions are always Host-born).
   * @param api - shared wire client.
   * @param remote - generated Remote namespaces this session calls.
   * @param options - optional manager-owned state observers.
   */
  /*
   * @param sessionId Host 会话身份（客户端会话总是 Host 出生）。
   * @param api 共享的线上客户端。
   * @param remote 本会话调用的生成远程命名空间。
   * @param options 可选的管理器自有状态观察者。
   */
  constructor(
    readonly sessionId: SessionId,
    private readonly api: IApiClient,
    private readonly remote: SessionRemotes,
    private readonly options: SessionOptions = {},
  ) {
    this.projections = options.projections ?? new ProjectionValueStore()
    this.address = options.address
    this.parentAvailable = options.parentAvailable ?? false
    this.conversation = options.conversation === undefined
      ? new ConversationNodeAssembler(
        { entries: () => [], fallbackEntry: () => undefined },
        { entries: () => [] },
      )
      : new ConversationNodeAssembler(options.conversation.events, options.conversation.views)
    this.notifier = new Notifier(() => {
      this.conversation.flush() // 冲刷待处理定义变更
      this.snapshotCache = this.buildSnapshot() // 重建快照缓存
    })
    this.snapshotCache = this.buildSnapshot()
  }

  /**
   * Bind the Agent-scoped context minted by SessionRuntime (single write;
   * a second bind is a wiring error and throws). Direction stays one-way at
   * this binding boundary: consumers still reach the Session via `sessions.sessionOf`,
   * while the Session holds its own dispatch point (host Agent.loopCtx
   * mirror).
   * @param actx - the agent's scoped context.
   */
  /*
   * 绑定 SessionRuntime 铸造的 Agent 作用域上下文（单次写；二次绑定是接线
   * 错误并抛错）。此绑定边界方向保持单向：消费方仍经 sessions.sessionOf
   * 到达 Session，而 Session 持有自己的分发点（Host Agent.loopCtx 镜像）。
   * @param actx agent 的作用域上下文。
   */
  bindScope(actx: Context): void {
    if (this.actx !== undefined) throw new Error(`session ${this.sessionId} already has a bound scope`)
    this.actx = actx
  }

  /** Release the bound scope at prune time (a later rebind accompanies a freshly minted scope). */
  /* 在裁剪时释放已绑定作用域（之后的重新绑定伴随新铸造的作用域）。 */
  unbindScope(): void {
    this.actx = undefined
  }

  // ---- Operations ----
  // ---- 操作区 ----

  /**
   * Send (queue/steer passed through 1:1); failures land in the snapshot's promptError.
   * @param content - text plus browser-owned temporary image uploads.
   * @param mode - queue appends after the current turn; steer interrupts it.
   * @returns the prompt result (also mirrored into promptError on failure).
   */
  /*
   * 发送提示词（queue/steer 1:1 透传）；失败落入快照的 promptError。
   * @param content 文本 + 浏览器侧持有的临时图片上传。
   * @param mode queue 在当前轮之后追加；steer 打断它。
   * @returns 提示词结果（失败时也镜像进 promptError）。
   */
  async prompt(
    content: PromptContentPart[],
    mode: 'queue' | 'steer',
    signal?: AbortSignal,
  ): Promise<RpcResult<{ accepted: true }>> {
    this.promptError = null
    this.lastAgentError = null
    // Synchronous, before the first await: the blank → engaging edge must be
    // visible on the session area's very first frame when a caller sends
    // ahead of navigation (first-send flow).
    // 同步、在首次 await 前：当调用方在导航前发送（首次发送流程）时，
    // blank -> engaging 边必须在会话区的第一帧就可见。
    this.promptAttempted = true
    if (this.blankBit) this.firstPromptPendingTurn = true
    this.notifier.markDirty()
    let result: RpcResult<{ accepted: true }>
    try {
      if (this.address === undefined) {
        result = (await this.api.sessions.prompt({
          sessionId: this.sessionId,
          mode,
          content,
          clientTimeZone: resolvedClientTimeZone(),
        }, signal)).result
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
        if (content.some(part => part.type === 'image')) {
          result = {
            ok: false,
            error: {
              code: 'attachment-error',
              message: 'Image input is unavailable for subagent continuations.',
              details: { reason: 'SUBAGENT_IMAGE_UNSUPPORTED' },
            },
          }
        } else {
          const routed = (await this.api.subagents.prompt({
            ...this.address,
            content: content.flatMap(part => part.type === 'text'
              ? [{ type: 'text' as const, text: part.text }]
              : []),
            clientTimeZone: resolvedClientTimeZone(),
          }, signal)).result
          result = routed.ok ? { ok: true, value: { accepted: true } } : routed
        }
      }
    } catch (error) {
      result = transportError(error)
    }
    if (!result.ok) {
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
    // blank 位在"受理"而非"尝试"时翻转：被接受的提示词会在 Host 上开启
    // 对话首轮（Host 判据——已记录的 turn/start 是事实而非乐观；独立命令
    // 与投影事件绝不翻转它），而被拒绝的首条提示词必须保持会话空白——
    // 客户端空白镜像只会下降，因此在失败时提前翻转会永久浮出会话，并
    // 相对 Host 权威剥夺其 connectWorkspace 复用资格。
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
   */
  /*
   * 把本会话引用的一张图片解析为浏览器可消费的字节。
   * @param attachmentId 在折叠会话日志中找到的不透明 id。
   * @returns 已鉴权引用 + 解码后的字节。
   */
  async readAttachment(
    attachmentId: AttachmentIdType,
  ): Promise<RpcResult<{ attachment: ImageAttachmentRef; data: Uint8Array }>> {
    try {
      const result = (await this.api.sessions.attachment({
        sessionId: this.sessionId,
        attachmentId,
      })).result
      if (!result.ok) return result
      const binary = atob(result.value.data) // base64 -> 二进制字符串
      const data = Uint8Array.from(binary, char => char.charCodeAt(0))
      return { ok: true, value: { attachment: result.value.attachment, data } }
    } catch (error) {
      return transportError(error)
    }
  }

  /** Apply one operation to a still-pending queue occurrence. */
  /* 对仍待处理的队列条目应用一个操作。 */
  async updateQueue(itemId: MessageId, action: QueueAction): Promise<RpcResult<{ accepted: true }>> {
    try {
      return (await this.api.sessions.updateQueue({ sessionId: this.sessionId, itemId, action })).result
    } catch (error) {
      return transportError(error)
    }
  }

  /**
   * Stop the active turn while the Host preserves pending inbox work; failures
   * land in promptError (same error-strip display slot). A continuable
   * subagent address routes through `subagent.interrupt`, whose durable
   * parent-address authority works without a live parent Agent; a one-shot
   * address stays uncancellable (the UI offers no stop action, so this arm is
   * defensive).
   * @returns the cancel result.
   */
  /*
   * 停止活跃轮次，同时 Host 保留待处理收件箱工作；失败落入 promptError
   * （同一错误条展示位）。可续接的子代理地址经 subagent.interrupt 路由，
   * 其持久父地址权威在父 Agent 不存活时仍有效；一次性地址保持不可取消
   * （UI 不提供停止动作，因此此臂是防御性的）。
   * @returns 取消结果。
   */
  async cancel(): Promise<RpcResult<{ accepted: true }>> {
    const address = this.address
    if (address !== undefined && address.mode === 'one-shot') {
      const result: RpcResult<{ accepted: true }> = {
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
    let result: RpcResult<{ accepted: true }>
    try {
      result = address !== undefined
        ? (await this.api.subagents.interrupt(address)).result
        : (await this.api.sessions.cancel({ sessionId: this.sessionId })).result
    } catch (error) {
      result = transportError(error)
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
   * waiting for the mux frame.
   * @param title - raw title text (the host normalizes acceptance).
   * @returns the rename result (normalized accepted title + title event seq).
   */
  /*
   * 重命名：契约 session.rename 1:1。成功后按存储的"更高 seq 胜"规则，
   * 用响应的 {title, seq} 结算 title 投影单元（之后到达的推送帧是无操作
   * 重放），使列表行与任何 useProjection('title') 读取器无需等 mux 帧。
   * @param title 原始标题文本（Host 规范化接受与否）。
   * @returns 重命名结果（规范化标题 + 标题事件 seq）。
   */
  async rename(title: string): Promise<RpcResult<{ title: string; seq: number }>> {
    try {
      const { result } = await this.api.sessions.rename({ sessionId: this.sessionId, title })
      if (result.ok) this.projections.apply('title', result.value.title, result.value.seq)
      return result
    } catch (error) {
      return transportError(error)
    }
  }

  /**
   * Execute one slash-command line against this session's agent — pure
   * admission semantics (the host executor durably logs the lifecycle;
   * outcomes render as flow nodes, never as a response echo).
   * @param line - the full command line, leading slash included.
   * @returns the admission result, or the error branch on transport failure.
   */
  /*
   * 对本会话 agent 执行一条斜杠命令——纯受理语义（Host 执行器持久记录
   * 生命周期；结果渲染为流节点，绝不作响应回显）。
   * @param line 完整命令行，含开头的斜杠。
   * @returns 受理结果，或传输失败的错误分支。
   */
  async command(line: string): Promise<RemoteResult<{ matched: boolean }>> {
    const result = await this.remote.commands.execute(this.sessionId, line, [])
    if (!result.ok) return result
    return { ok: true, value: { matched: result.value !== undefined } }
  }

  /** First open: pull the tail page (idempotent — in-flight/already-open returns the existing promise). */
  /* 首次打开：拉取尾部页（幂等——进行中/已打开时返回既有 promise）。 */
  open(): Promise<void> {
    if (this.openState === 'open') return Promise.resolve()
    if (this.openPromise !== null) return this.openPromise
    const promise = this.doOpen(this.openGeneration).finally(() => {
      // Identity-guarded: a superseded open must not null out the promise resync just started.
      // 身份守卫：被取代的 open 不得清空 resync 刚启动的 promise。
      if (this.openPromise === promise) this.openPromise = null
    })
    this.openPromise = promise
    return promise
  }

  /** Page up: pull one earlier page with the window's first seq as beforeSeq and prepend. */
  /* 向上翻页：以窗口首 seq 作为 beforeSeq 拉取更早一页并前插。 */
  async loadOlder(): Promise<void> {
    if (this.openState !== 'open' || !this.hasMore || this.loadingOlder) return
    this.loadingOlder = true
    this.notifier.markDirty()
    try {
      const { result } = await this.history({ beforeSeq: this.baseSeq, maxMessages: PAGE_MESSAGES })
      if (!result.ok) return // keep the window as-is; do not overwrite openError (open already succeeded)
      // 窗口保持原样；不覆盖 openError（open 已成功）
      const older = result.value.events
      if (older.length === 0) {
        this.hasMore = result.value.hasMore
        this.conversation.prepend([], this.hasMore)
        return
      }
      const tail = older[older.length - 1]
      if (tail === undefined || tail.event.seq + 1 !== this.baseSeq) {
        // Continuity assertion: on violation drop the page fail-soft rather than render an out-of-order stream.
        // 连续性断言：违反时软失败地丢弃该页，而不是渲染乱序流。
        console.error(`[web-runtime] history page discontinuous: tail seq ${tail?.event.seq} vs baseSeq ${this.baseSeq}`)
        this.hasMore = false
        this.conversation.prepend([], false)
        return
      }
      this.events = [...older.map(e => e.event), ...this.events]
      this.views = [...older.map(e => e.view), ...this.views]
      /* v8 ignore next -- the ?? arm needs older[0] undefined, but the empty-page branch above already returned. */
      this.baseSeq = older[0]?.event.seq ?? this.baseSeq
      this.hasMore = result.value.hasMore
      this.conversation.prepend(older.map(conversationInput), this.hasMore)
    } catch (error) {
      console.error('[web-runtime] loadOlder failed:', error)
    } finally {
      this.loadingOlder = false
      this.notifier.markDirty()
    }
  }

  /** Reconnect rebuild (manager calls this on onConnected for instances that were opened):
   *  reset the window and rerun open; pending waits for the baseline replay. Invalidates any
   *  in-flight open first — its history request rode the dead connection and must not settle
   *  the fresh generation into 'error'. */
  /*
   * 重连重建（管理器在 onConnected 时为已打开的实例调用）：重置窗口并
   * 重跑 open；pending 等待基线重放。先使任何进行中的 open 失效——其历史
   * 请求骑乘了已死连接，不得把新世代结算成 error。
   */
  async resync(): Promise<void> {
    // The queue mirror is NOT cleared here: onConnected (which drives resync)
    // races the mux frames — the fresh generation's baseline may have landed
    // already, and the host never resends it. The mirror re-baselines on the
    // session/subscribed frame instead (same stream as the queue snapshot
    // that follows it, so ordering is guaranteed).
    // 队列镜像在这里不清空：onConnected（驱动 resync）与 mux 帧竞争——
    // 新世代的基线可能已落地，且 Host 不会重发。镜像改在
    // session/subscribed 帧上重新基线（与紧随其后的队列快照同一条流，
    // 顺序有保证）。
    if (this.openState === 'cold') return // never opened: no window to rebuild (doOpen flips to 'loading' synchronously, so cold implies no in-flight open)
    // 从未打开：无可重建窗口（doOpen 同步翻转为 loading，因此 cold 意味着
    // 无进行中的 open）
    this.openGeneration++
    this.openPromise = null
    this.openState = 'cold'
    this.openError = null
    this.events = []
    this.views = []
    this.baseSeq = 0
    // Superseded, not settled: the baseline replay re-sends still-pending requested frames verbatim
    // (same rpcId), re-minting fresh waits; a stale reference's respond() still reaches the host.
    // 被取代而非结算：基线重放逐字重发仍待处理的被请求帧（同一 rpcId），
    // 重新铸造新等待；过期引用的 respond() 仍能到达 Host。
    this.pending.clear()
    this.pendingRev++
    this.subscribedLastSeq = null
    this.liveBuffer = []
    this.notifier.markDirty()
    await this.open()
  }

  // ---- Subscription API (useSyncExternalStore direct wiring) ----
  // ---- 订阅 API（useSyncExternalStore 直接接线） ----

  /**
   * uSES subscription entry.
   * @param listener - change callback.
   * @returns the unsubscribe function.
   */
  /*
   * uSES 订阅入口。
   * @param listener 变更回调。
   * @returns 取消订阅函数。
   */
  subscribe(listener: () => void): () => void {
    return this.notifier.subscribe(listener)
  }

  /**
   * Cached conversation snapshot (rebuilt lazily when dirty with no listeners).
   * @returns the cached reference (stable until the next flush).
   */
  /*
   * 缓存的会话快照（脏且无监听器时懒重建）。
   * @returns 缓存引用（直到下次冲刷前稳定）。
   */
  getSnapshot(): ConversationSnapshot {
    this.notifier.ensureFresh()
    return this.snapshotCache
  }

  // ---- Manager-only entry points (@internal; never called by the UI) ----
  // ---- 仅管理器的入口点（@internal；UI 绝不调用） ----

  /**
   * Mux frame arrival (the dispatch switch).
   * @param rpcId - the frame envelope id (the respond backfill key for requested frames).
   * @param frame - the routed frame.
   */
  /*
   * mux 帧到达（分发开关）。
   * @param rpcId 帧信封 id（被请求帧的 respond 回填键）。
   * @param frame 被路由的帧。
   */
  handleMuxEnvelope(rpcId: RpcId, frame: MuxFrame): void {
    switch (frame.type) {
      case 'session/event': {
        this.acceptLiveEvent(frame.event, frame.view)
        return
      }
      case 'session/queue': {
        this.queueMirror.replace(frame.items)
        this.notifier.markDirty()
        return
      }
      case 'session/subscribed': {
        this.subscribedLastSeq = frame.lastSeq
        // New mux-generation baseline: the host pushes this session's queue
        // snapshot AFTER the subscribed frame on the same stream, so the
        // stale mirror clears here — race-free against onConnected/resync
        // timing (clearing there could wipe a baseline that already landed).
        // 新 mux 世代基线：Host 在同一流上、subscribed 帧之后推送本会话的
        // 队列快照，因此在这里清除过期镜像——与 onConnected/resync 时序
        // 无竞争（在那里清除可能抹掉已落地的基线）。
        if (this.queueMirror.reset()) this.notifier.markDirty()
        return
      }
      case 'approval/requested': {
        const { type: _type, sessionId: _sid, ...payload } = frame
        this.mint(new PendingWait('approval', rpcId, this.sessionId, payload, m => this.api.respond(m)))
        this.notifier.markDirty()
        return
      }
      case 'approval/resolved': {
        for (const item of this.pending.values()) {
          if (item.kind === 'approval' && item.payload.approvalId === frame.approvalId) this.settle(item)
        }
        this.notifier.markDirty()
        return
      }
      case 'question/requested': {
        const { type: _type, sessionId: _sid, ...payload } = frame
        this.mint(new PendingWait('question', rpcId, this.sessionId, payload, m => this.api.respond(m)))
        this.notifier.markDirty()
        return
      }
      case 'question/resolved': {
        const item = this.pending.get(`q:${frame.questionRpcId}`)
        if (item !== undefined) this.settle(item)
        this.notifier.markDirty()
        return
      }
      default:
        return // stream/error never reaches Session (Controller converges it); unknown frames ignored (documented default)
        // stream/error 从不到达 Session（Controller 收敛它们）；未知帧被忽略（有文档默认）
    }
  }

  /**
   * Running-bit relay from the host stream (list entry and snapshot stay consistent).
   * @param running - the new running state.
   */
  /*
   * 来自 Host 流的运行位中继（列表条目与快照保持一致）。
   * @param running 新的运行状态。
   */
  handleRunning(running: boolean): void {
    // Turn-start conversion: a blank session never runs, so the first
    // running:true proves another side's first message landed.
    // 轮次开始换算：空白会话从不运行，因此首个 running:true 证明另一侧
    // 的首条消息已落地。
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
   * @param parentAvailable - latest exact-parent availability hint.
   */
  /*
   * 安装或清除目录发现的传输地址。地址变化时通过新历史路由重建已打开
   * 的窗口。
   * @param address 直接父/子地址；普通传输为 undefined。
   * @param parentAvailable 最新精确父可用性提示。
   */
  configureSubagent(address: SubagentAddress | undefined, parentAvailable = false): void {
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
   */
  /*
   * 只更新目录刷新带来的父可用性提示。
   * @param available 精确直接父是否存活。
   */
  handleSubagentParentAvailable(available: boolean): void {
    if (this.parentAvailable === available) return
    this.parentAvailable = available
    this.notifier.markDirty()
  }

  /**
   * Blank-bit relay from the authoritative summary source (list baseline and
   * the session-added frame). Monotone: once any signal (local first send,
   * running flip, an earlier summary) cleared it, a stale true never
   * re-blanks.
   * @param blank - the summary's derived empty-log bit.
   */
  /*
   * 来自权威概要源（列表基线与 session-added 帧）的空白位中继。单调：
   * 一旦任何信号（本地首次发送、运行翻转、更早概要）清除它，陈旧的 true
   * 绝不再置空。
   * @param blank 概要推导的空日志位。
   */
  handleBlank(blank: boolean): void {
    if (blank === this.blankBit) return
    if (blank && (this.promptAttempted || this.running)) return // 已有活动信号则忽略陈旧 true
    this.blankBit = blank
    this.notifier.markDirty()
  }

  /** host/session-removed relay: flag the snapshot (instance survives — resident-instance rule). */
  /* host/session-removed 中继：给快照置位（实例存活——驻留实例规则）。 */
  handleRemoved(): void {
    this.removed = true
    this.notifier.markDirty()
  }

  /**
   * host/agent-error relay: the only outlet for live failures with no turn position.
   * @param message - the stringified error.
   */
  /*
   * host/agent-error 中继：无轮次位置的实时失败的唯一出口。
   * @param message 字符串化的错误。
   */
  handleAgentError(message: string): void {
    this.lastAgentError = message
    this.notifier.markDirty()
  }

  /** No-op because session instances remain resident. */
  /* 空操作：会话实例保持驻留。 */
  dispose(): void {}

  /** Rebuild the current window after a low-frequency Definition or view registration change. */
  /* 低频定义或视图注册变化后重建当前窗口。 */
  rebuildConversationRegistry(): void {
    this.scheduleConversation(this.conversation.rebuildRegistry())
  }

  // ---- Private ----
  // ---- 私有 ----

  /** Requested-frame arrival: the wait enters the pending map under its own key. */
  /* 被请求帧到达：等待以其自身键进入 pending 表。 */
  private mint(wait: PendingInteraction): void {
    this.pending.set(wait.key, wait)
    this.pendingRev++
  }

  /** Authoritative resolved-frame settlement: mark, then drop from the pending map. */
  /* 权威已解析帧的结算：标记，然后从 pending 表移除。 */
  private settle(wait: PendingInteraction): void {
    wait.markSettled()
    this.pending.delete(wait.key)
    this.pendingRev++
  }

  /** @param generation - openGeneration at launch; every await re-checks it and a stale pass
   *  drops all writes (resync superseded this open — its outcome belongs to a dead connection). */
  /* @param generation 启动时的 openGeneration；每次 await 后复查，过期阶段丢弃全部写
   *  （resync 已取代此 open——其结果属于已死连接）。 */
  private async doOpen(generation: number): Promise<void> {
    this.openState = 'loading'
    this.openError = null
    this.notifier.markDirty()
    try {
      let { result } = await this.history({ maxMessages: PAGE_MESSAGES })
      if (generation !== this.openGeneration) return
      if (!result.ok) {
        this.openState = 'error'
        this.openError = result.error
        return
      }
      this.installWindow(result.value.events, result.value.hasMore, result.value.projections)
      // Gap detection: baseline past the window tail and liveBuffer did not cover it -> pull the tail page once more.
      // 间隙检测：基线越过窗口尾部且 liveBuffer 未覆盖 -> 再拉一次尾部页。
      const tailSeq = this.windowTailSeq()
      if (this.subscribedLastSeq !== null && tailSeq !== null && this.subscribedLastSeq > tailSeq) {
        result = (await this.history({ maxMessages: PAGE_MESSAGES })).result
        if (generation !== this.openGeneration) return
        if (result.ok) this.installWindow(result.value.events, result.value.hasMore, result.value.projections)
      }
      this.openState = 'open'
    } catch (error) {
      if (generation !== this.openGeneration) return
      this.openState = 'error'
      const folded = transportError<never>(error)
      /* v8 ignore next -- the `? null` arm is unreachable: transportError always returns ok:false. */
      this.openError = folded.ok ? null : folded.error
    } finally {
      if (generation === this.openGeneration) this.notifier.markDirty()
    }
  }

  /** Install the history window + stitch the liveBuffer (seq is the sole dedup key).
   *  Stitching MUST NOT route through acceptLiveEvent: openState is still 'loading' here
   *  (doOpen flips it after install), so recursing would push every buffered event straight
   *  back into liveBuffer where nothing ever drains it — a silent drop loop.
   *  A carried projections block seeds the value store (higher seq wins, so a stale
   *  baseline cannot overwrite a newer push frame); the window events themselves are
   *  never folded — the host is the only computation site. */
  /*
   * 安装历史窗口并缝合 liveBuffer（seq 是唯一去重键）。
   * 缝合绝不能经 acceptLiveEvent 路由：这里 openState 仍是 loading
   * （doOpen 在 install 后才翻转），递归会把每个缓冲事件直接推回
   * liveBuffer，而那里永远无人排空——一个静默丢弃环。
   * 携带的 projections 块播种值存储（更高 seq 胜，因此陈旧基线不能覆盖
   * 更新的推送帧）；窗口事件本身从不折叠——Host 是唯一计算点。
   */
  private installWindow(entries: HistoryEntry[], hasMore: boolean, projections?: ProjectionsBaseline): void {
    this.events = entries.map(e => e.event)
    this.views = entries.map(e => e.view)
    this.baseSeq = this.events[0]?.seq ?? 0
    this.hasMore = hasMore
    if (this.events.some(event => event.type === 'turn/start')) this.firstPromptPendingTurn = false
    this.conversation.replaceWindow(entries.map(conversationInput), hasMore)
    if (projections !== undefined) this.projections.seed(projections)
    const buffered = this.liveBuffer
    this.liveBuffer = []
    for (const item of buffered) this.appendLive(item.event, item.view)
    this.notifier.markDirty()
  }

  /** Seq-guarded append shared by stitching and the open-state live path. */
  /* 缝合与打开态实时路径共享的 seq 守卫追加。 */
  private appendLive(event: SessionEvent, view?: ToolEventView): ConversationPublication {
    const tailSeq = this.windowTailSeq()
    if (tailSeq !== null && event.seq <= tailSeq) return 'none' // replay overlap, drop
    // 重放重叠，丢弃
    this.events.push(event)
    this.views.push(view)
    if (event.type === 'turn/start') this.firstPromptPendingTurn = false
    const queueChanged = this.queueMirror.acceptDurable(event)
    const publication = this.conversation.append({ event, view })
    return queueChanged ? 'immediate' : publication
  }

  /** Land a live session/event (open/repair in flight -> buffer; overlapping seq -> drop;
   *  a seq gap -> buffer + tail-page repull instead of appending a hole (a gap is an
   *  expected reconnect-window artifact, repaired by refetch). The window stays one contiguous
   *  raw range, which lets Conversation Definitions correlate every recorded event between its
   *  ends and lets a compaction checkpoint resolve its cited summary event. */
  /*
   * 落地一个实时 session/event（open/修复进行中 -> 缓冲；重叠 seq -> 丢弃；
   * seq 间隙 -> 缓冲 + 重拉尾部页，而不是补一个洞（间隙是预期中的重连
   * 窗口产物，由重新拉取修复）。窗口保持一个连续原始区间，使会话定义能
   * 关联其两端之间的每个记录事件，并使压缩检查点能解析其引用的摘要事件。
   */
  private acceptLiveEvent(event: SessionEvent, view?: ToolEventView): void {
    if (this.openState === 'loading' || this.stitching) {
      this.liveBuffer.push({ event, view })
      return
    }
    if (this.openState !== 'open') return // cold/error: no window upkeep (history fully backfills on open)
    // cold/error：不维护窗口（open 时历史完整回填）
    const tailSeq = this.windowTailSeq()
    if (tailSeq !== null && event.seq > tailSeq + 1) {
      this.liveBuffer.push({ event, view })
      void this.repairGap()
      return
    }
    this.scheduleConversation(this.appendLive(event, view))
  }

  /** Route assembler cadence into the Session's existing microtask/RAF notifier. */
  /* 把装配器节奏路由进 Session 既有的微任务/RAF 通知器。 */
  private scheduleConversation(publication: ConversationPublication): void {
    if (publication === 'immediate') this.notifier.markDirty()
    else if (publication === 'animation-frame') this.notifier.markFrameDirty()
  }

  /** Resync-lite: repull the tail page and stitch the liveBuffer through the shared
   *  installWindow path. No openState transition — the UI keeps the current window (no loading
   *  flash); events arriving meanwhile detour to liveBuffer via the stitching flag. */
  /*
   * 轻量重同步：重拉尾部页并通过共享 installWindow 路径缝合 liveBuffer。
   * 无 openState 转换——UI 保持当前窗口（无 loading 闪烁）；其间到达的
   * 事件经 stitching 标志绕道 liveBuffer。
   */
  private async repairGap(): Promise<void> {
    /* v8 ignore next -- re-entry guard: acceptLiveEvent already detours to liveBuffer while stitching, so no second call reaches here. */
    if (this.stitching) return
    this.stitching = true
    const generation = this.openGeneration
    try {
      const { result } = await this.history({ maxMessages: PAGE_MESSAGES })
      // Failure or superseded by a full resync: drop — the resync path rebuilds and clears the buffer itself.
      // 失败或已被完整 resync 取代：丢弃——resync 路径自己重建并清空缓冲。
      if (result.ok && generation === this.openGeneration && this.openState === 'open') {
        this.installWindow(result.value.events, result.value.hasMore, result.value.projections)
      }
    } catch (error) {
      console.error('[web-runtime] gap repair failed:', error)
    } finally {
      this.stitching = false
    }
  }

  /** 取窗口尾事件的 seq；窗口为空时为 null。 */
  private windowTailSeq(): number | null {
    const tail = this.events[this.events.length - 1]
    return tail === undefined ? null : tail.seq
  }

  /** 组装对外快照：pending 列表缓存 + 会话对话快照 + 各镜像字段。 */
  private buildSnapshot(): ConversationSnapshot {
    if (this.pendingCache === null || this.pendingCache.rev !== this.pendingRev) {
      this.pendingCache = { rev: this.pendingRev, value: [...this.pending.values()] }
    }
    const chat = (this.conversation.snapshot('chat') as ChatSnapshot | undefined) ?? EMPTY_CHAT_SNAPSHOT
    const legacy = chat.legacy
    return {
      sessionId: this.sessionId,
      views: this.conversation,
      chat,
      nodes: legacy.nodes,
      turnTimings: legacy.turnTimings,
      turnEnds: legacy.turnEnds,
      partial: legacy.partial,
      runningCalls: legacy.runningCalls,
      pending: this.pendingCache.value,
      queue: this.queueMirror.snapshot(),
      running: this.running,
      subagent: this.address === undefined
        ? null
        : { address: this.address, parentAvailable: this.parentAvailable },
      composerPhase: derivePhase(
        hasVisibleConversationContent(chat)
          || (!this.blankBit && !this.firstPromptPendingTurn)
          || this.running
          || this.pendingCache.value.length > 0,
        this.promptAttempted,
      ),
      removed: this.removed,
      openState: this.openState,
      openError: this.openError,
      hasMore: this.hasMore,
      loadingOlder: this.loadingOlder,
      promptError: this.promptError,
      blank: this.blankBit,
      lastAgentError: this.lastAgentError,
    }
  }

  /** Select ordinary or addressed history transport from the stored browser fact. */
  private history(payload: { beforeSeq?: number; maxMessages?: number }): Promise<RpcResponse<{
    events: HistoryEntry[]
    hasMore: boolean
    projections?: ProjectionsBaseline
  }>> {
    return this.address === undefined
      ? this.api.sessions.history({ sessionId: this.sessionId, ...payload })
      : this.api.subagents.history({ ...this.address, ...payload })
  }
}

/** Convert one wire history row into the assembler's transport-neutral input. */
function conversationInput(entry: HistoryEntry): ConversationEventInput {
  return { event: entry.event, view: entry.view }
}

/** A generic command row alone remains control-plane content; every other visible Chat Node activates the conversation. */
function hasVisibleConversationContent(chat: ChatSnapshot): boolean {
  return chat.order.some(key => chat.nodes.get(key)?.kind !== 'command')
}

/**
 * The composerPhase judgment — the single site that knows the predicate
 * (consumers switch on the result, never re-derive). A failed first prompt
 * stays engaging until an authoritative accepted-turn, running, or pending
 * signal arrives (retry semantics — see ComposerPhase).
 * @param hasContent - authoritative non-blank activity beyond a pending first
 *   prompt, visible non-command Chat content, a running turn, or a pending interaction.
 * @param promptAttempted - a prompt was initiated on this session object.
 * @returns the derived phase.
 */
function derivePhase(hasContent: boolean, promptAttempted: boolean): ComposerPhase {
  if (hasContent) return 'active'
  return promptAttempted ? 'engaging' : 'blank'
}
