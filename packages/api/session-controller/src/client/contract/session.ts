/*
 * ================================ 文件注释 ================================
 * 【文件职责】定义会话对外的"脸"（face）：功能包通过本接口使用会话，
 *   不直接接触具体 Session 类——读侧用 useSession（可观察快照），
 *   写侧只允许调用本文件列出的行为动词。
 * 【技术维度】纯类型模块：ISession 是行为接口，SessionFace 是行为 + 快照
 *   读侧的复合类型；实现类（SessionRuntime）以结构化类型满足它。
 * 【产品维度】把"功能包能对会话做什么"收敛成显式清单：新增能力必须
 *   显式拓宽本接口，同时每个测试夹具都必须 stub 它，防止隐式越权。
 * 【逻辑维度】ProjectionsFace 提供按键投影读取；ISession 提供
 *   prompt/readAttachment/updateQueue/cancel/rename/loadOlder/command；
 *   SessionFace 合并会话快照读侧。
 * 【关键边界】运行时内部入口（历史 staging、wire-frame 分发）留在类上，
 *   不暴露在接口外；prompt 的 mode 只允许 'queue'/'steer' 两值。
 * 【新手阅读建议】从 SessionFace 入手理解读/写两侧的划分。
 * ==========================================================================
 */
/**
 * The outward session face. Feature packages never see the concrete Session
 * class: components read lifecycle state through `useSession` (the
 * ObservableSnapshot half), and orchestration code calls the behavior verbs
 * below — nothing else. Widening this interface is the explicit act of
 * widening what features may do to a session (and what every test fixture
 * must stub); implementation-internal entry points (history staging, wire-frame
 * dispatch) stay on the class, invisible out here.
 */
/*
 * 会话对外的接口面：功能包永远看不到具体的 Session 类——组件通过
 * useSession 读取会话状态（可观察快照那一半），编排代码只调用下方的
 * 行为动词，没有别的入口。拓宽本接口就是显式拓宽"功能包能对会话
 * 做什么"（以及每个测试夹具必须 stub 什么）；运行时内部入口
 * （历史 staging、wire-frame 分发）仍留在类上，对外不可见。
 */
import type { AttachmentIdType, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { PromptContentPart, QueueAction, SessionRequestId } from '../../types.ts'
import type { ClientResult } from './result.ts'
import type { PendingSubmissionImage, SessionSnapshot } from './snapshot.ts'

/**
 * Why a local submission echo left the snapshot: `observed` when its durable
 * `user/message` event or host queue occurrence arrived (with the admitted
 * image references in prompt order), `failed` when the prompt was rejected,
 * threw, or was aborted before acceptance.
 */
export type PendingSubmissionRetirement =
  | { readonly reason: 'observed'; readonly attachments: readonly ImageAttachmentRef[] }
  | { readonly reason: 'failed' }

/** Input registering one local submission echo ahead of its prompt call. */
export interface BeginSubmissionInput {
  /** Prompt text exactly as the upcoming prompt will send it. */
  readonly text: string
  /** Ordered image previews matching the upcoming prompt's image parts. */
  readonly images: readonly PendingSubmissionImage[]
  /** Settlement callback fired exactly once when the echo retires. */
  readonly onRetire?: (retirement: PendingSubmissionRetirement) => void
}

/** One registered submission echo: the identity its prompt must carry, and the pre-prompt escape hatch. */
export interface SubmissionHandle {
  /** The prompt RPC identity; pass it to {@link ISession.prompt}. */
  readonly requestId: SessionRequestId
  /** Retire the echo as failed when the caller cannot reach prompt() (serialization failure); no-op after any other settlement. */
  abandon(): void
}

/** Key-addressed projection read face (the useProjection resolution path; see ProjectionValueStore). */
/*
 * 按投影键寻址的只读面（useProjection 的解析路径；参见 ProjectionValueStore）：
 * 每个键都能拿到一个独立的可观察快照对象。
 */
export interface ProjectionsFace {
  /**
   * The identity-stable bare observable for one projection key (absence is
   * an `undefined` snapshot, never a missing face).
   * @param key - projection key.
   * @returns the key's value face.
   */
  /*
   * 单个投影键的身份稳定裸可观察对象（键不存在时快照为 undefined，
   * 而不是缺少某个"面"）。
   * @param key 投影键。
   * @returns 该键的值面。
   */
  faceOf(key: string): ObservableSnapshot<unknown>
}

/** Identity plus the behavior verbs features may invoke on a session. */
/* 会话身份 + 功能包可对会话调用的行为动词清单。 */
export interface ISession {
  /** The session's host identity (agent id — same axis). */
  /* 会话的 Host 侧身份（即 agent id，同一坐标系）。 */
  readonly sessionId: SessionId
  /** Host-computed projection values by key (the useProjection seat). */
  /* Host 按键计算的投影值（useProjection 的取值位置）。 */
  readonly projections: ProjectionsFace
  /**
   * Register one local submission echo in `snapshot.pendingSubmissions`,
   * synchronously, before the caller serializes and sends the prompt. The
   * echo retires when a durable `user/message` event or queue occurrence
   * carrying the returned identity arrives, or when the identified prompt
   * call fails.
   * @param input - echo content and the optional settlement callback.
   * @returns the minted identity for {@link prompt} plus the pre-prompt abandon path.
   */
  beginSubmission(input: BeginSubmissionInput): SubmissionHandle
  /**
   * Send a prompt into the session.
   * @param content - text plus browser-owned temporary image uploads.
   * @param mode - 'queue' appends a turn; 'steer' interrupts the running one.
   * @param signal - optional caller cancellation for the complete admission round-trip.
   * @param requestId - identity from {@link beginSubmission}; a failed identified prompt retires its echo.
   * @returns acceptance, or the business error (also mirrored into snapshot.promptError).
   */
  /*
   * 向会话发送一条提示词。
   * @param content 文本 + 浏览器侧持有的临时图片上传。
   * @param mode 'queue' 追加一轮；'steer' 打断正在运行的一轮。
   * @returns 是否被接受，或业务错误（同时镜像到 snapshot.promptError）。
   */
  prompt(
    content: PromptContentPart[],
    mode: 'queue' | 'steer',
    signal?: AbortSignal,
    requestId?: SessionRequestId,
  ): Promise<ClientResult<{ accepted: true }>>
  /**
   * Resolve one durable image referenced by this session.
   * @param attachmentId - opaque id found in the folded session log.
   * @returns the authenticated reference and decoded bytes.
   */
  /*
   * 解析本会话引用的一张持久化图片。
   * @param attachmentId 在折叠后的会话日志中找到的不透明 id。
   * @returns 已鉴权的引用 + 解码后的字节。
   */
  readAttachment(
    attachmentId: AttachmentIdType,
  ): Promise<ClientResult<{ attachment: ImageAttachmentRef; data: Uint8Array }>>
  /**
   * Apply one edit, remove, or strict steer action to a still-pending queue occurrence.
   * @param itemId - agent-owned inbox occurrence identity.
   * @param action - requested queue operation.
   * @returns acceptance, or a business/transport error.
   */
  updateQueue(itemId: MessageId, action: QueueAction): Promise<ClientResult<{ accepted: true }>>
  /**
   * Cancel the running turn. Pending queued work remains and resumes in FIFO
   * order after the Host reaches cancellation quiescence.
   * @returns acceptance, or the business error.
   */
  cancel(): Promise<ClientResult<{ accepted: true }>>
  /**
   * Rename this session (explicit user title; pins it against automatic
   * regeneration).
   * @param title - raw title text (the host normalizes acceptance).
   * @returns the normalized accepted title and its event seq, or the business error.
   */
  rename(title: string): Promise<ClientResult<{ title: string; seq: number }>>
  /**
   * Extend the history window backwards (older messages pagination).
   * @returns completion; failures land in snapshot.openState/loadingOlder.
   */
  /*
   * 向后扩展历史窗口（更早消息的分页加载）。
   * @returns 完成信号；失败会落在 snapshot.openState/loadingOlder 中。
   */
  loadOlder(): Promise<void>
  /**
   * Execute one slash-command line against this session's agent — pure
   * admission semantics (the host executor durably logs the lifecycle).
   * @param line - the full command line, leading slash included.
   * @returns the admission result, or the Remote face's error branch.
   */
  /*
   * 对本会话的 agent 执行一条斜杠命令——纯受理语义（Host 执行器会把
   * 生命周期持久化到日志）。
   * @param line 完整命令行，含开头的斜杠。
   * @returns 受理结果，或 Remote 面的错误分支。
   */
  command(line: string): Promise<RemoteResult<{ matched: boolean }>>
}

/**
 * The full outward face: behavior verbs plus the Session lifecycle read side
 * (the `useSession` hook source). This is the type carried by
 * `SessionBinding.session` and the provide channel.
 */
export type SessionFace = ISession & ObservableSnapshot<SessionSnapshot>
