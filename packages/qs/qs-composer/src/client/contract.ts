import type { SessionPendingInteraction } from '@deepseek-ai/dsh-client-ui-session/client'
/** qs-composer 的契约：输入区的共享类型与本地化键。 */
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
// 仅类型：引入 qs-shell 声明的 qs.composer 槽，以及 ui-conversation 的会话座席合并
// （useInput / inputActions 挂在 SessionMaybeStandardProps 上）。
import type {} from '@deepseek-ai/dsh-qs-shell/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { QueueRowView } from './handoff.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** 独立模型插件在输入区贡献严格会话选择器。 */
    'qs.composer.model': { kind: 'single'; scope: 'session'; owner: { locked: boolean } }
    /** 阅读区共享官方会话 store；聊天正文由独立转写插件贡献。 */
    'qs.stage.reading': { kind: 'single'; scope: 'session'; owner: { chat: import('react').ReactNode } }
    /** 非聊天视图按官方对应插件独立贡献，使用相同定位请求协议。 */
    'qs.stage.view': { kind: 'list'; scope: 'session'; owner: import('@deepseek-ai/dsh-client-ui-conversation/client').ConvViewOwnerProps }

    /** 欢迎区的工作区入口由对应 ui-workspace 的独立呈现插件提供。 */
    'qs.workspace.hero': { kind: 'single'; scope: 'root'; owner: { children?: never } }
    /** 独立预设插件在空白会话区域贡献选择器，会话呈现不拥有预设逻辑。 */
    'qs.workspace.hero.agentPreset': { kind: 'single'; scope: 'root'; owner: { children?: never } }
    /** 子代理等独立呈现按官方会话快照接管输入；未选中会话时不分派。 */
    'qs.composer.takeover': {
      kind: 'chain'
      scope: 'session'
      owner: import('@deepseek-ai/dsh-client-ui-conversation/client').ComposerChainProps
    }
    /** 目标等独立插件在输入上方贡献会话状态，保持审批座位常驻。 */
    'qs.composer.dock': { kind: 'list'; scope: 'session'; owner: { children?: never } }
    /** 当前会话标题动作，由作业等独立插件贡献。 */
    'qs.stage.header.actions': { kind: 'list'; scope: 'session'; owner: { children?: never } }
    /** 固定会话交互座位，不随阅读视图卸载。 */
    'qs.stage.pending': { kind: 'single'; scope: 'session'; owner: { children?: never } }
    /** 审批和提问复用唯一待回答数据与协议。 */
    'qs.stage.interaction': { kind: 'chain'; scope: 'session'; owner: QsInteractionOwnerProps }
    /** Conversation welcome area, including the unbound session state. */
    'qs.stage.body': { kind: 'single'; scope: 'session-maybe'; owner: { children?: never } }
    /** Session transcript supplied by the Chat presentation plugin. */
    'qs.stage.transcript': { kind: 'single'; scope: 'session'; owner: { children?: never } }
    /** Input view owned by this conversation plugin. */
    /** 命令菜单与弹层由对应独立插件贡献。 */
    'qs.composer.overlay': { kind: 'list'; scope: 'session'; owner: QsCommandOverlayOwner }
    /** 输入视图接收会话或无会话座席；注册替换 QS 输入区，缺失时不提供输入。 */
    'qs.composer': { kind: 'single'; scope: 'session-maybe'; owner: { children?: never } }
  }
  interface LocaleNamespaceMap {
    'qs-conversation': keyof typeof import('./view-locales.ts').zh
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
  readonly freezeReason?: 'sending' | 'command' | 'confirmation' | undefined
}

/**
 * `qs.composer` 条目的 inject face。
 *
 * 提交编排放在组件里：`inputActions` 是**会话座席**（session-maybe 标准座席），
 * 组件在 binding 就绪后写入草稿；submitGesture 使用该会话输入机与共享策略解析投递模式。
 */
export interface QsComposerInjected {
  /**
   * 按官方共享偏好提交当前会话草稿。
   * @param gesture - 普通发送或 Ctrl/Cmd 加速发送。
   */
  readonly submitGesture: (gesture: Parameters<import('@deepseek-ai/dsh-client-ui-conversation/client').ConversationPresentation['submission']['resolve']>[1]) => void
  /** 挂载实际输入时取得仅斜杠策略，卸载释放。 */
  readonly acquireTriggerConsumer?: () => (() => void) | undefined
  /** Load the current model from the official directory. */
  readonly loadModel: () => void
  readonly hooks: {
    /** 发送按钮与普通 Enter 使用官方同一解析结果。 */
    readonly qsSubmitMode: HostObservable<ReturnType<import('@deepseek-ai/dsh-client-ui-conversation/client').ConversationPresentation['submission']['resolve']>>
    /** 独立插件正在准备当前会话时，保留首次发送交接但尚不提交。 */
    readonly qsPreparation: HostObservable<import('./preparation.ts').QsSendPreparationEntry | undefined>
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
  /**
   * 为一个弹层取得独立冻结原因，释放函数幂等且仅释放本次持有者。
   * @param reason - 命令弹层或确认界面。
   * @returns 在关闭、失败或卸载时调用的释放动作。
   */
  readonly acquireFreeze: (reason: 'command' | 'confirmation') => () => void
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
  & PropsRenderSlots<'qs.composer.overlay' | 'qs.composer.model'>

/** qs-composer 的本地化键。 */
export type QsComposerLocaleKey =
  | 'settings.enter.title' | 'settings.enter.description' | 'settings.enter.queue' | 'settings.enter.steer'
  | 'context.unavailable'
  | 'context.reading'
  | 'context.used'
  | 'context.stale'
  | 'context.noBreakdown'
  | 'context.system'
  | 'context.tools'
  | 'context.messages'
  | 'context.heuristic'
  | 'input.structuredDraft'
  | 'input.placeholder'
  | 'input.send' | 'input.sendQueue' | 'input.sendSteer'
  | 'input.childParentRequired' | 'input.stop'
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

/** 交互卡片位的选举输入：宿主显式传入选择器需要的每个字段。 */
export interface QsInteractionOwnerProps {
  /** 当前会话身份；无绑定时为 undefined。 */
  readonly sessionId: string | undefined
  /** 当前会话待答复的交互；无则为 undefined。 */
  readonly pendingInteraction: SessionPendingInteraction | undefined
}

/** 输入区只转交手势，候选控制器仍由官方插件拥有。 */
export interface QsCommandInputBridge {
  /** 同步当前光标，组合输入期间暂停候选匹配。 */
  readonly track: (caret: number, composing: boolean) => void
  /** 返回 consumed/pick-highlighted 时禁止普通发送。 */
  readonly arbitrate: (key: import('@deepseek-ai/dsh-client-ui-conversation/client').ArbitrateKey,
    composing: boolean) => import('@deepseek-ai/dsh-client-ui-conversation/client').ArbitrateOutcome
  /** 空格认领命令成功时由输入区阻止原生空格。 */
  readonly space: () => boolean
}

/** 菜单和弹层共享可见输入及独立冻结取得动作。 */
export interface QsCommandOverlayOwner {
  readonly inputElement: { readonly current: HTMLTextAreaElement | null }
  readonly frozen: boolean
  readonly composing: { readonly current: boolean }
  /** 安装当前输入的手势适配器；释放只移除同一实例。 */
  readonly bindCommandInput: (bridge: QsCommandInputBridge) => () => void
  readonly acquireFreeze: QsComposerInjected['acquireFreeze']
}
