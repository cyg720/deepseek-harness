/**
 * Trigger candidate menu: renders the InputTriggerService menu store into the
 * conversation.input.overlay anchor. Closed state renders null (the overlay
 * slot stays mounted); groups render in roster order under localized title
 * rows, pending groups as a loading row; pointer picks route back through
 * the service (combobox pattern — focus never leaves the textarea, so rows
 * are mousedown-handled and the highlight is exposed via
 * aria-activedescendant on the listbox).
 */
/*
 * 文件职责：实现输入触发菜单的 MenuView 组件。
 * 技术维度：React、TypeScript、Cordis 插槽和 CSS Modules。
 * 产品维度：支持用户查看或操作输入触发菜单。
 * 逻辑维度：读取状态，派生显示数据并响应交互。
 * 关键边界：空状态、错误状态和可访问性属性必须一致。
 * 新手阅读建议：先读 Props，再看局部状态和 JSX。
 */
import { Fragment, useEffect, useRef, useSyncExternalStore } from 'react'
import clsx from 'clsx'
import { useAnchoredMaxHeight } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './MenuView.module.css'
import type { MenuViewInjected } from './slots.ts'
import type { MenuKey } from './locales.ts'

/** Full menu props: injected face + the locale seat. */
/* 中文说明：类型或类 MenuViewProps 约束本文件数据或组件职责。 */
export type MenuViewProps = MenuViewInjected & PropsLocale<'slash.menu'>

/** Design cap on the list height (figma SLASH 39:26572 MenuDropdown). */
/* 中文说明：组件局部值 MAX_HEIGHT，由紧邻初始化决定。 */
const MAX_HEIGHT = 320

/** DOM id of one option row (the aria-activedescendant target). */
/* 中文说明：函数 optionId 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function optionId(source: string, index: number): string {
  return `dsh-slash-option-${source}-${index}`
}

/**
 * Render the candidate menu overlay entry.
 * @param props - injected face (the menu store and the pick route); `t` rides the standard locale seat.
 * @returns the dropdown while open; null while closed.
 */
/* 中文说明：函数 MenuView 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function MenuView({ menu, onPick, onDismiss, t }: MenuViewProps) {
  /** 中文说明：组件局部值 state，由紧邻初始化决定。 */
  const state = useSyncExternalStore(
    fn => menu.subscribe(fn),
    () => menu.getSnapshot(),
  )
  /** 中文说明：组件局部值 listRef，由紧邻初始化决定。 */
  const listRef = useRef<HTMLDivElement>(null)
  // The list is bottom-anchored above the composer; clamp the design cap to
  // the space above it, re-measured on every store update (the anchor moves
  // when the composer grows).
  /** 中文说明：组件局部值 maxHeight，由紧邻初始化决定。 */
  const maxHeight = useAnchoredMaxHeight(listRef, MAX_HEIGHT, state)
  /** 中文说明：组件局部值 highlight，由紧邻初始化决定。 */
  const highlight = state.open ? state.highlight : null
  // Focus stays in the textarea (combobox pattern), so the browser never
  // scrolls the active option into view on keyboard moves — do it here.
  useEffect(() => {
    if (highlight === null) return
    document.getElementById(optionId(highlight.source, highlight.index))
      ?.scrollIntoView({ block: 'nearest' })
  }, [highlight])
  // Dismiss on pointer outside the menu AND outside the composer card
  // (clicking the textarea or bottom bar must not close the menu).
  useEffect(() => {
    if (!state.open) return
    /** 中文说明：组件局部值 onPointerDown，由紧邻初始化决定。 */
    const onPointerDown = (ev: PointerEvent): void => {
      if (!(ev.target instanceof Node)) return
      if (listRef.current?.contains(ev.target)) return
      /** 中文说明：组件局部值 composerCard，由紧邻初始化决定。 */
      const composerCard = listRef.current?.closest('[data-composer-card]')
      if (composerCard?.contains(ev.target)) return
      onDismiss()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => { document.removeEventListener('pointerdown', onPointerDown, true) }
  }, [state.open, onDismiss])
  if (!state.open) return null
  return (
    <div
      ref={listRef}
      className={css.menu}
      style={{ maxHeight }}
      role="listbox"
      aria-label={t('suggestions.aria')}
      aria-activedescendant={highlight !== null ? optionId(highlight.source, highlight.index) : undefined}
    >
      <div className={css.viewport}>
        {state.groups.map(group => (group.status === 'ready' && group.items.length === 0)
          ? null
          : (
            <Fragment key={group.source}>
              {/* Source names key the dictionary open-endedly: the lookup chain
                  returns an unknown key verbatim, so an unregistered source
                  shows its raw name — hence the cast past the typed key union. */}
              {group.showGroupTitle === false || group.items.some(item => item.section !== undefined)
                ? null
                : <div className={css.groupTitle} role="presentation" data-source={group.source}>{t(group.source as MenuKey)}</div>}
              {group.status === 'pending'
                ? <div className={css.loading} data-source={group.source}>{t('loading')}</div>
                : group.items.map((item, index) => {
                  /** 中文说明：组件局部值 active，由紧邻初始化决定。 */
                  const active = highlight !== null && highlight.source === group.source && highlight.index === index
                  return (
                    <Fragment key={optionId(group.source, index)}>
                      {item.section !== undefined && item.section !== group.items[index - 1]?.section
                        ? <div className={css.sectionTitle} role="presentation">{item.section}</div>
                        : null}
                      <button
                        id={optionId(group.source, index)}
                        type="button"
                        role="option"
                        aria-selected={active}
                        className={clsx(css.item, active && css.active)}
                        // mousedown, not click: the textarea keeps focus (combobox
                        // pattern) — preventing default stops the focus steal, and the
                        // pick runs before any blur-driven teardown.
                        onMouseDown={(ev) => {
                          ev.preventDefault()
                          onPick(group.source, index)
                        }}
                      >
                        {item.icon !== undefined && <span className={css.itemIcon} aria-hidden>{item.icon}</span>}
                        <span className={css.itemName}>{item.name}</span>
                        {item.description !== undefined && <span className={css.itemDescription}>{item.description}</span>}
                      </button>
                    </Fragment>
                  )
                })}
            </Fragment>
          ))}
      </div>
    </div>
  )
}
