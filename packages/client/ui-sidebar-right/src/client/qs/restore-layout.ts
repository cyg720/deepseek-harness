/** 恢复只重建布局；地址授权和类型解析须由调用方在进入 store 前完成。 */
import {
  createInitialState, getPane, planSettle, replay,
  type FloatRect, type LayoutOp, type LayoutState, type Mint, type PaneId, type TabId, type TabRecord,
} from '@deepseek-ai/dsh-client-ui-dockkit'

/** 已经解析标题、校验资源归属的布局输入，不接受持久化运行时 ID。 */
export interface RestoredLayout {
  readonly docked: 1 | 2
  readonly panes: readonly {
    readonly tabs: readonly Omit<TabRecord, 'id'>[]
    readonly active: number | null
    readonly rect: FloatRect | null
  }[]
  readonly active: number
  readonly sizes: readonly number[]
  readonly expanded: boolean
  readonly mode: 'push' | 'fullscreen'
}

/** 校验索引与数组之间的关系；类型系统不能表达有效的数组下标。 */
function required<T>(value: T | null | undefined): T {
  if (value === undefined || value === null) throw new Error('sidebarRight: restored layout references a missing pane, tab or rectangle')
  return value
}

/**
 * 使用官方布局操作重建身份；空停靠栏遵守官方 settle 规则。
 * @param input - 已校验索引、双列限制、每浮窗单标签及页面唯一性的布局。
 * @param mint - store 所有者提供的连续 ID 分配器。
 * @param seed - 空停靠栏的当前注册默认页。
 * @returns 可一次提交的布局，不包含旧撤销历史。
 */
export function restoreLayout(input: RestoredLayout, mint: Mint, seed: (id: TabId) => TabRecord): LayoutState {
  let layout = createInitialState({ next: mint }, undefined, input.mode)
  const root = getPane(layout, layout.rootId).id
  const panes: PaneId[] = [root]
  const activeTabs: Record<PaneId, TabId | undefined> = {}
  const apply = (...ops: LayoutOp[]): void => { layout = replay(layout, ops) }
  if (input.docked === 2) {
    const sibling = mint('pane'), split = mint('split')
    apply({ type: 'split', paneId: root, axis: 'row', direction: 'after', newPaneId: sibling, newSplitId: split },
      { type: 'resize', splitId: split, sizes: input.sizes })
    panes.push(sibling)
  }
  for (const [position, pane] of input.panes.entries()) {
    const floating = position >= input.docked
    const destination = floating ? root : required(panes[position])
    const ids: TabId[] = []
    for (const tab of pane.tabs) {
      const id = mint('tab')
      ids.push(id)
      apply({ type: 'openTab', paneId: destination, tab: { ...tab, id }, index: getPane(layout, destination).tabs.length })
    }
    if (floating) {
      const id = mint('pane')
      apply({ type: 'float', tabId: required(ids[0]), newPaneId: id, rect: required(pane.rect) })
      panes.push(id)
    }
    activeTabs[required(panes[position])] = pane.active === null ? undefined : required(ids[pane.active])
  }
  // 各浮窗的打开动作会改变焦点；最终统一恢复焦点和层叠次序。
  apply({ type: 'restoreFocus', activePaneId: required(panes[input.active]), floats: panes.slice(input.docked), paneActiveTabs: activeTabs },
    { type: 'setExpanded', expanded: input.expanded })
  return replay(layout, planSettle(layout, mint, input.expanded ? seed : undefined))
}
