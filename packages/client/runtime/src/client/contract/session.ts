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
 * class: components read conversation state through `useSession` (the
 * ObservableSnapshot half), and orchestration code calls the behavior verbs
 * below — nothing else. Widening this interface is the explicit act of
 * widening what features may do to a session (and what every test fixture
 * must stub); runtime-internal entry points (history staging, wire-frame
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
import type {
  MessageId, PromptContentPart, QueueAction, RpcResult, SessionId,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ConversationSnapshot } from '../sessions/conversation.ts'
import type { ObservableSnapshot } from './store.ts'

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
   * Send a prompt into the session.
   * @param content - text plus browser-owned temporary image uploads.
   * @param mode - 'queue' appends a turn; 'steer' interrupts the running one.
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
  ): Promise<RpcResult<{ accepted: true }>>
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
  ): Promise<RpcResult<{ attachment: ImageAttachmentRef; data: Uint8Array }>>
  /**
   * Apply one edit, remove, or strict steer action to a still-pending queue occurrence.
   * @param itemId - agent-owned inbox occurrence identity.
   * @param action - requested queue operation.
   * @returns acceptance, or a business/transport error.
   */
  /*
   * 对仍处于待处理状态的队列条目应用编辑、移除或严格 steer 操作。
   * @param itemId agent 拥有的收件箱条目身份。
   * @param action 请求的队列操作。
   * @returns 是否被接受，或业务/传输错误。
   */
  updateQueue(itemId: MessageId, action: QueueAction): Promise<RpcResult<{ accepted: true }>>
  /**
   * Cancel the running turn. Pending queued work remains and resumes in FIFO
   * order after the Host reaches cancellation quiescence.
   * @returns acceptance, or the business error.
   */
  /*
   * 取消正在运行的一轮。待处理的排队工作保留，并在 Host 达到取消静默后
   * 按 FIFO 顺序恢复。
   * @returns 是否被接受，或业务错误。
   */
  cancel(): Promise<RpcResult<{ accepted: true }>>
  /**
   * Rename this session (explicit user title; pins it against automatic
   * regeneration).
   * @param title - raw title text (the host normalizes acceptance).
   * @returns the normalized accepted title and its event seq, or the business error.
   */
  /*
   * 重命名本会话（显式用户标题；固定后不再被自动重新生成）。
   * @param title 原始标题文本（接受与否由 Host 规范化决定）。
   * @returns 规范化后的已接受标题及其事件 seq，或业务错误。
   */
  rename(title: string): Promise<RpcResult<{ title: string; seq: number }>>
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
 * The full outward face: behavior verbs plus the conversation read side
 * (the `useSession` hook source). This is the type carried by
 * `SessionBinding.session` and the provide channel.
 */
/*
 * 完整对外面：行为动词 + 会话读侧（useSession hook 的数据来源）。
 * 这是 SessionBinding.session 与 provide 通道携带的类型。
 */
export type SessionFace = ISession & ObservableSnapshot<ConversationSnapshot>
