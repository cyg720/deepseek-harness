/**
 * ================================ 文件注释 ================================
 * 【文件职责】斜杠插件的覆盖层槽位契约面：把 'conversation.input.overlay' 槽位
 *             的类型合并与 MenuView 的注入面定义在此。
 * 【技术维度】类型合并（declare module）：槽位由 ui-conversation 的输入条入口
 *             拥有（声明即认领），但 SlotMap 类型合并放本包——依赖方向不允许
 *             反向类型导入，且类型擦除的注册被排除。
 * 【产品维度】输入浮层菜单（MenuView）与弹窗选择壳共享的锚点槽位形态。
 * 【逻辑维度】SlotMap 合并声明槽位（list 类型、会话作用域）→ MenuViewInjected
 *             定义菜单注入面（menu store、onPick、onDismiss）。
 * 【关键边界】文案走标准 locale 席位而非注入面；槽位随输入条在接管时隐藏。
 * 【新手阅读建议】理解"声明在别处、类型合并在本包"的依赖方向设计。
 * ==========================================================================
 */
/**
 * Overlay-slot contract surface of the slash plugin. The
 * 'conversation.input.overlay' slot is OWNED by the ui-conversation composer
 * entry (declaring is claiming: anchor, children declaration, lifecycle),
 * but the SlotMap type merge lives here: the owner package depends on this
 * one, so the dependency direction admits no reverse type import, and a
 * type-erased registration is ruled out. The owner's
 * program picks this merge up transitively through its ui-input-trigger imports.
 */
// Type-only edge: the SlotMap augmentation below merges into this package's interface.
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { MenuState } from '../core/contract.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * The InputBar floating overlay anchor: MenuView (this package) and the
     * popupSelect shell (ui-commands) contribute list entries; each reads its
     * own store and renders null while closed. Declared (children table) by
     * ui-conversation's composer entry; the anchor hides with the input
     * under a takeover.
     */
    'conversation.input.overlay': { kind: 'list'; scope: 'session' }
  }
}

/** Injected business face of the MenuView overlay entry (copy rides the standard locale seat, not this face). */
export interface MenuViewInjected {
  /** The service's menu state store (read-only here; MenuView subscribes). */
  menu: SnapshotStore<MenuState>
  /**
   * Pointer pick routed back through the service pipeline.
   * @param source - source (group) name.
   * @param index - candidate index within the group.
   */
  onPick: (source: string, index: number) => void
  /** Dismiss the menu (external pointer outside the composer area). */
  onDismiss: () => void
}
