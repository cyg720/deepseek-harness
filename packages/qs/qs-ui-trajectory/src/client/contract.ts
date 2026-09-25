/** 轨迹呈现只消费官方投影，不重复定义事件或请求。 */
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime, PropsRenderSlots, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConversationNode, RequestView, PartialAssistant, RunningToolCall, MessageImageLoader, MessageImagesOwnerProps, ConversationPresentation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-qs-composer/client'
import type {} from '@deepseek-ai/dsh-qs-ui-tool/client'
import type { zh } from './locales.ts'
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** 图片由独立附件插件呈现，授权读取归属当前会话。 */
    'qs.conversation.trajectory.images': { kind: 'single'; scope: 'session'; owner: MessageImagesOwnerProps }
  }
  interface LocaleNamespaceMap { 'qs-ui-trajectory': keyof typeof zh }
}
/** 轨迹独占的会话阅读状态；不持有历史正文或附件字节。 */
export interface TrajectoryReading {
  scrollTop: number
  readonly requests: Set<number>
  readonly records: Set<number>
}
/** 会话请求源和分页命令。 */
export interface TrajectoryInjected {
  /** 同一官方会话绑定内保留，释放绑定后可回收。 */
  readonly reading: TrajectoryReading
  readonly hooks: {
    readonly requests: HostObservable<readonly RequestView[]>
    readonly nodes: HostObservable<readonly ConversationNode[]>
    readonly partial: HostObservable<PartialAssistant | null>
    readonly runningCalls: HostObservable<readonly RunningToolCall[]>
    readonly connected: HostObservable<boolean>
  }
  /** 当前会话图片读取器；缓存仍由官方服务持有。 */
  readonly loadImage: MessageImageLoader
  /** 加载更早记录；失败状态由官方会话快照提供。 */
  loadOlder(): Promise<void>
}
/** QS 轨迹阅读座位。 */
export type TrajectoryProps = PropsRuntime<'qs.stage.view'> & InjectFace<TrajectoryInjected> & PropsLocale<'qs-ui-trajectory'> & PropsRenderSlots<'qs.conversation.trajectory.images'>

/** 工具定位入口只操作官方共享阅读状态，视图未装配时不提供死入口。 */
export interface InspectInjected {
  readonly hooks: { readonly available: HostObservable<boolean> }
  /** 激活当前会话的官方 trajectory target。 */
  activate(): void
}
/** 工具卡贡献的定位按钮座位。 */
export type InspectProps = PropsRuntime<'qs.tool.call.actions'> & PropsStore<ConversationPresentation['store']>
  & InjectFace<InspectInjected> & PropsLocale<'qs-ui-trajectory'>
