/** 官方与奇术阅读视图共享状态；不创建第二份草稿或视图选择。 */
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ConversationStore } from '../contract/slots.ts'
import type { BusyEnterBehavior, ComposerSubmitGesture, InputSubmitMode } from '../contract/composer-submission.ts'
import type { ViewTab } from '../contract/views.ts'

/** 官方会话呈现所有者提供的共享句柄与 target 激活入口。 */
export interface ConversationPresentation {
  /** 呈现注册使用该句柄，由槽运行时按会话复用实例。 */
  readonly store: ConversationStore
  /** 官方已注册视图的本地化名录；QS 仍须过滤未实现的呈现。 */
  readonly views: ObservableSnapshot<readonly ViewTab[]>
  /** 复用官方唯一发送策略，替代呈现不得另建偏好存储或手写手势判定。 */
  readonly submission: {
    /**
     * 用官方队列编排将待发消息引导至当前轮。
     * @param sessionId - 已绑定且允许引导的会话。
     */
    steerQueue(sessionId: SessionId): void
    /** 与官方输入条、设置行相同的实时偏好源。 */
    readonly busyEnter: ObservableSnapshot<BusyEnterBehavior>
    /**
     * 更新与官方设置行相同的偏好。
     * @param behavior - 忙碌时默认排队或引导。
     */
    setBusyEnter(behavior: BusyEnterBehavior): void
    /**
     * 用当前偏好解析发送意图，最终投递窗口仍由 Host 决定。
     * @param running - 当前会话是否忙碌。
     * @param gesture - 普通发送或快捷键反向发送。
     * @param steeringAvailable - 当前会话是否支持引导。
     * @returns 本次显式投递模式。
     */
    resolve(running: boolean, gesture: ComposerSubmitGesture, steeringAvailable: boolean): InputSubmitMode
  }
  /**
   * 激活已有 target；选择和定位请求仍通过共享 store 动作提交。
   * @param sessionId - 目标会话。
   * @param preferred - 已注册视图标识，null 按官方规则解析默认视图。
   */
  activate(sessionId: SessionId, preferred: string | null): void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** 与官方会话座位共同拥有的阅读状态入口。 */
    conversationPresentation: ConversationPresentation
  }
}
