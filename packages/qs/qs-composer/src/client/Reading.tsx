/** 阅读区只切换呈现；审批、提问与输入由主区常驻兄弟座位持有。 */
import { useEffect, useId, useState, type KeyboardEvent } from 'react'
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore, HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConversationPresentation, ViewTab } from '@deepseek-ai/dsh-client-ui-conversation/client'
import css from './stage.module.css'

/** 已装配 QS 视图名录及官方 target 激活。 */
export interface ReadingInjected {
  readonly hooks: { readonly readingViews: HostObservable<readonly ViewTab[]> }
  /**
   * 激活选中的官方 target，不修改输入草稿。
   * @param view - 当前 QS 已实现的视图标识。
   */
  activate(view: string): void
}
/** 会话状态由官方句柄绑定，视图正文保持独立槽注册。 */
export type ReadingProps = PropsRuntime<'qs.stage.reading'> & PropsStore<ConversationPresentation['store']>
  & PropsRenderSlots<'qs.stage.view'> & PropsLocale<'qs-conversation'> & InjectFace<ReadingInjected>

/**
 * 渲染原型的对话/轨迹视图入口；已卸载视图回落聊天而不覆盖保存的偏好。
 * @param props - 共享状态、当前会话和独立视图名录。
 * @returns 视图标签及当前阅读内容。
 */
export function Reading({ chat, useStore, actions, useReadingViews, activate, renderSlot, t }: ReadingProps) {
  const views = useReadingViews(value => value)
  const preferred = useStore(state => state.view)
  const request = useStore(state => state.viewRequest)
  const active = views.find(view => view.id === preferred)?.id ?? 'chat'
  const identity = useId()
  const tabs = [{ id: 'chat', label: t('view.chat') }, ...views]
  const [focused, setFocused] = useState(active)
  const focusId = tabs.some(view => view.id === focused) ? focused : active
  const panelId = `${identity}-panel`
  // 原型采用手动激活：方向键只移动焦点，Enter/空格经原生按钮激活。
  const moveFocus = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    let next: number
    switch (event.key) {
      case 'ArrowRight': next = (index + 1) % tabs.length; break
      case 'ArrowLeft': next = (index + tabs.length - 1) % tabs.length; break
      case 'Home': next = 0; break
      case 'End': next = tabs.length - 1; break
      default: return
    }
    event.preventDefault()
    // 标签条由本组件独占，所有直接子元素均为当前 tabs 的按钮。
    const tablist = event.currentTarget.parentElement as HTMLDivElement
    const button = tablist.children.item(next) as HTMLButtonElement
    button.focus()
  }
  useEffect(() => { activate(active) }, [activate, active])
  const select = (id: string): void => { activate(id); actions.setView(id) }
  const openView = (id: string, focus: string): void => { activate(id); actions.openView(id, focus) }
  return <div data-qs-reading={active}>
    {views.length > 0 && <div className={css.viewTabs} role="tablist" aria-label={t('view.label')}>
      {tabs.map((view, index) => <button key={view.id} type="button" role="tab"
        id={`${identity}-tab-${view.id}`} aria-controls={panelId} tabIndex={focusId === view.id ? 0 : -1}
        aria-selected={active === view.id} onFocus={() => { setFocused(view.id) }}
        onKeyDown={(event) => { moveFocus(event, index) }} onClick={() => { select(view.id) }}>{view.label}</button>)}
    </div>}
    <div id={panelId} role={views.length > 0 ? 'tabpanel' : undefined}
      aria-labelledby={views.length > 0 ? `${identity}-tab-${active}` : undefined} tabIndex={0}>
      {active === 'chat' ? chat : renderSlot('qs.stage.view', { viewRequest: request, openView, completeViewRequest: actions.completeViewRequest }, { only: active })}
    </div>
  </div>
}
