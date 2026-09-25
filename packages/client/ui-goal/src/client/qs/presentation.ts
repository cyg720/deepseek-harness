/** 官方与奇术目标视图共享的呈现能力；不增加目标执行器或投影注册。 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { GoalBarInjected } from '../slots.ts'

/** 按会话绑定原有目标动作和观察期间有效的激活订阅。 */
export interface GoalPresentation {
  /**
   * 创建视图注入面；动作省略 expectedRef 时，在调用时读取官方投影 CAS ref。
   * @param sessionId - 已绑定的会话标识；不存在时抛错。
   * @returns 原有四个动作和激活状态源，只有订阅后才读取远端并监听事件。
   */
  bind(sessionId: SessionId): GoalBarInjected
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** 官方 ui-goal 唯一提供者；视图不复制目标状态或注册历史 Definition。 */
    goalPresentation: GoalPresentation
  }
}
