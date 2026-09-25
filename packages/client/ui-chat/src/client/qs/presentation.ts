/** 奇术转写与官方 Chat 共享显示偏好，不另建设置控制器。 */
import type { RefObject } from 'react'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { TranscriptViewMode } from '../../chat-settings.ts'
/** 已有官方 Chat 所有者公开的显示偏好。 */
export interface ChatPresentation {
  /**
   * 复用不依赖服务实例的官方 Hook，可直接传递；消费者必须遵守 React Hook 调用规则。
   * @param hidden - 是否隐藏子树。
   * @param reveal - 查找命中或焦点保护要求展开时调用。
   * @returns 稳定子树根节点的引用。
   */
  readonly useSearchableHidden: (hidden: boolean, reveal: () => void) => RefObject<HTMLDivElement>
  /** 普通或紧凑显示的实时偏好源。 */
  readonly transcriptView: ObservableSnapshot<TranscriptViewMode>
  /**
   * 更新官方共享显示偏好并通过原控制器持久化。
   * @param mode - 普通或紧凑模式。
   */
  setTranscriptView(mode: TranscriptViewMode): void
}
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** 官方与替代转写共同消费的偏好入口。 */
    chatPresentation: ChatPresentation
  }
}
