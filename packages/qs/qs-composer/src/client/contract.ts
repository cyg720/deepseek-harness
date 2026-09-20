/** qs-composer 的契约：输入区的共享类型与本地化键。 */
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// 仅类型：引入 qs-shell 声明的 qs.composer 槽，以及 ui-conversation 的会话座席合并
// （useInput / inputActions 挂在 SessionMaybeStandardProps 上）。
import type {} from '@deepseek-ai/dsh-qs-shell/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { QueueRowView } from './handoff.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'qs-composer': QsComposerLocaleKey
  }
}

/** 输入区本地编排快照（可订阅：冻结状态必须能驱动重渲染）。 */
export interface QsComposerSnapshot {
  /** 本地冻结中（创建/交接尚未结束）；此时输入区只读。 */
  readonly frozen: boolean
  /** 未归属草稿（无会话时由 qs-composer 自己持有）。 */
  readonly unownedDraft: string
  /** 未归属草稿因何冻结；无冻结时为 undefined。 */
  readonly freezeReason?: 'sending' | undefined
}

/**
 * `qs.composer` 条目的 inject face。
 *
 * 提交编排放在组件里：`inputActions` 是**会话座席**（session-maybe 标准座席），
 * 只有组件拿得到；apply 层拿不到它，因此 apply 只提供"建会话""取队列""写队列"
 * 这类服务动作，真正的 `setDraft` + `submit` 由组件在 binding 就绪后执行。
 */
export interface QsComposerInjected {
  /** Load the current model from the official directory. */
  readonly loadModel: () => void
  readonly hooks: {
    readonly qsBlocked: HostObservable<string | undefined>
    readonly qsConnected: HostObservable<boolean>
    readonly qsNotice: HostObservable<string | undefined>
    readonly qsModel: HostObservable<string | undefined>
    /** 本地编排快照源，框架绑成 `useQsComposer`。 */
    readonly qsComposer: HostObservable<QsComposerSnapshot>
    /** 当前会话的队列源，框架绑成 `useQsQueue`。 */
    readonly qsQueue: HostObservable<readonly QueueRowView[]>
  }
  /**
   * 新建会话并打开。
   * @param requestedSessionId - 跨页面唯一的预分配 id；结果未知时按同一 id 恢复。
   * @param signal - 取消后禁止打开会话或交接草稿。
   * @returns 已创建并打开的会话 id；失败时为 undefined。
   */
  readonly createSession: (requestedSessionId: string, signal: AbortSignal) => Promise<string | undefined>
  /** 返回当前草稿预分配的会话标识；失败重试复用它。 */
  readonly reserveSessionId: () => string
  /** 写入未归属草稿。 */
  readonly setUnownedDraft: (text: string) => void
  /** 记录/解除本地冻结。 */
  readonly setFrozen: (reason: 'sending' | undefined) => void
  /** 结束当前轮：`ISession.cancel()`；没有会话对象时是空操作。 */
  readonly stop: () => void
  /** 编辑文本队列项；失败保留原项。 */
  readonly editQueueItem: (itemId: string, text: string) => Promise<boolean>
  /** 逐行移除队列项。 */
  readonly removeQueueItem: (itemId: string) => Promise<boolean>
  /** 逐行引导队列项：进入当前轮，不改变待发排序。 */
  readonly steerQueueItem: (itemId: string) => Promise<boolean>
}

/** 输入区条目的完整 props。 */
export type QsComposerProps =
  PropsRuntime<'qs.composer'>
  & InjectFace<QsComposerInjected>
  & PropsLocale<'qs-composer'>

/** qs-composer 的本地化键。 */
export type QsComposerLocaleKey =
  | 'input.placeholder'
  | 'input.send'
  | 'input.stop'
  | 'input.sending'
  | 'input.cancel'
  | 'input.stopNote'
  | 'input.blocked'
  | 'input.suggestion1'
  | 'input.suggestion2'
  | 'input.suggestion3'
  | 'input.model'
  | 'input.empty'
  | 'input.queued'
  | 'input.attachment'
  | 'input.disconnected'
  | 'input.queueEdit'
  | 'input.queueTitle'
  | 'input.queueRemove'
  | 'input.queueSteer'
  | 'input.queueFailed'
  | 'input.createFailed'
