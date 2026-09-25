/** 目标视图消费官方投影、激活源及 Remote 动作，不建立第二份目标存储。 */
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { GoalBarInjected, GoalActionResult } from '@deepseek-ai/dsh-client-ui-goal/client'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { GoalView } from '@deepseek-ai/dsh-goal/client'
import type {} from '@deepseek-ai/dsh-qs-composer/client'
import type {} from '@deepseek-ai/dsh-qs-transcript/client'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'qs-ui-goal': keyof typeof import('./locales.ts').zh }
}

/** 创建与显式重新读取采用官方 goals Remote；其余动作来自共享提供者。 */
export interface GoalInjected extends GoalBarInjected {
  readonly hooks: GoalBarInjected['hooks'] & { readonly goalConnected: HostObservable<boolean> }
  /**
   * 创建目标正文，不将正文拼接为斜杠控制命令。
   * @param objective - 用户确认的非空正文。
   * @returns 官方创建结果；目标显示仍等待持久投影。
   */
  readonly onCreate: (objective: string) => Promise<GoalActionResult>
  /**
   * 为用户重新编辑读取最新目标，不自动再次提交。
   * @returns 真实目标视图；undefined 表示已清除。
   */
  readonly onRefresh: () => Promise<RemoteResult<GoalView | undefined>>
}

/** 严格会话槽的目标呈现输入。 */
export type GoalProps = PropsRuntime<'qs.composer.dock'> & InjectFace<GoalInjected> & PropsLocale<'qs-ui-goal'>
