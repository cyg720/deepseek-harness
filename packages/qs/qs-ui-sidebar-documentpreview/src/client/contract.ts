/** QS 文档子槽保留官方文档内容及标签钩子语义，正文注册单独持有生命周期。 */
import type { PropsRuntime, SlotHookFactory } from '@deepseek-ai/dsh-client-ui-slots'
import type { UseSidebarRightTabInfo } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** 六类 QS 正文按官方实现身份分派。 */
    'qs.sidebar.document': {
      kind: 'keyed'
      scope: 'session'
      owner: SlotMap['sidebar.right.tab.document']['owner']
      hookContext: UseSidebarRightTabInfo
      inject: { hooks: { tabInfo: SlotHookFactory<'qs.sidebar.document', UseSidebarRightTabInfo> } }
    }
  }
}
/** 子正文消费共享文件内容，不执行第二套读取。 */
export type DocumentProps = PropsRuntime<'qs.sidebar.document'>
/**
 * 传递宿主当前标签钩子。
 * @param _standard - 标准座位能力。
 * @param hook - 官方标签记录的读取钩子。
 * @returns 同一个标签钩子。
 */
export const tabInfoFactory: SlotHookFactory<'qs.sidebar.document', UseSidebarRightTabInfo> = (_standard, hook) => hook
