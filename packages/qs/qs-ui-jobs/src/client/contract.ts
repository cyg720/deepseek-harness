/** 作业视图只消费官方会话镜像与控制状态。 */
import type { SessionControlSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-qs-composer/client'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'qs-ui-jobs': keyof typeof import('./locales.ts').zh }
}

/** 注入面不暴露取消作业或新建控制流。 */
export interface JobsInjected {
  readonly hooks: { readonly qsJobsControl: HostObservable<SessionControlSnapshot> }
  /**
   * 由官方所有者重试终止失败，等待旧流静默后启动替代实例。
   * @returns 替代流已启动；就绪仍以可观察基线为准。
   */
  readonly retry: () => Promise<void>
}

/** 严格会话座席保证作业不会跨会话读取。 */
export type JobsProps = PropsRuntime<'qs.stage.header.actions'> & InjectFace<JobsInjected> & PropsLocale<'qs-ui-jobs'>
