/** QS 右栏保持官方 session、标签身份与 hook 上下文，内容插件仅替换呈现。 */
import type { HookContextOf, HostObservable, SlotHookFactory } from '@deepseek-ai/dsh-client-ui-slots'
import type { QsInspectorOwnerProps } from '@deepseek-ai/dsh-qs-shell/client'
import type { SidebarRightTabInjected, SidebarRightTabMenuOwnerProps, SidebarRightGuideBox, UseSidebarRightTabInfo } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** 右栏 session 宿主，注册者接收外壳几何意图及 sessionId，负责绑定唯一官方导航状态；无贡献时不显示会话面板。 */
    'qs.sidebar.right.session': { kind: 'single'; scope: 'session'; owner: QsInspectorOwnerProps }
    /** 按官方类型 definition.id 注册正文，接收 useTabInfo 读取身份、可见性、导航和生命周期；缺失注册显示不支持说明。 */
    'qs.sidebar.right.tab': { kind: 'keyed'; scope: 'session'; hookContext: HookContextOf<'sidebar.right.pane.tab'>; inject: SidebarRightTabInjected }
    /** 按与正文相同的 definition.id 注册动态标题；接收同一标签 hook，缺失时使用官方 record.title。 */
    'qs.sidebar.right.tab.title': { kind: 'keyed'; scope: 'session'; hookContext: HookContextOf<'sidebar.right.pane.tab.title'>; inject: SidebarRightTabInjected }
    /** 替换当前 guide 正文的 chain；接收其 useTabInfo，所有选择器拒绝或无贡献时保留注册表入口向导。 */
    'qs.sidebar.right.guide': { kind: 'chain'; scope: 'session'; hookContext: UseSidebarRightTabInfo; inject: { hooks: { tabInfo: SlotHookFactory<'qs.sidebar.right.guide', UseSidebarRightTabInfo> } } }
    /** 按独立 id 贡献标签菜单项，接收 tab 和 dismiss；执行动作后必须 dismiss，无贡献只保留 docking 布局动作。 */
    'qs.sidebar.right.menu': { kind: 'list'; scope: 'session'; owner: SidebarRightTabMenuOwnerProps }
  }
}
/** 向导读取注册表，不复制类型定义或创建业务服务。 */
export interface QsGuideInjected {
  readonly hooks: {
    readonly guideEntries: HostObservable<readonly SidebarRightGuideBox[]>
    readonly bodyKeys: HostObservable<readonly string[]>
  }
  readonly definitionId: (kind: string) => string | undefined
}
