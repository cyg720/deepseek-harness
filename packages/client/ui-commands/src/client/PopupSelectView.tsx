/**
 * Official popupSelect shell: renders one session's PopupSelectController
 * store into the conversation.input.overlay anchor. Unlike the slash menu
 * (combobox — textarea keeps focus), this shell HOLDS focus while open: the
 * inner search input takes focus, plain typing filters the loaded options
 * locally, Enter/↑↓ drive the filtered highlight (scrolled into view), Escape
 * dismisses back to the composer, and ←→ keep the search input's native
 * caret. Any pointer interaction outside the box dismisses (the click's own
 * target takes focus). Closed state renders null; the overlay slot stays
 * mounted. The card height clamps to the space above the composer.
 */
/**
 * 文件职责：实现命令弹层界面的 PopupSelectView 组件。
 * 技术维度：React、TypeScript、Cordis 插槽和 CSS Modules。
 * 产品维度：向用户展示并操作命令弹层相关状态。
 * 逻辑维度：读取属性与状态，派生展示数据并响应交互。
 * 关键边界：异步状态、可访问性标签和空数据分支必须保持一致。
 * 新手阅读建议：先读 Props，再看局部状态、effect 和 JSX。
 */
import { useEffect, useRef } from 'react'
import { useSyncExternalStore } from 'react'
import clsx from 'clsx'
import { IconCheckOutline16, RiskConfirmation, useAnchoredMaxHeight } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { filterOptions } from './popup.ts'
import type { PopupSelectController } from './popup.ts'
import css from './PopupSelectView.module.css'

/** Design cap on the card height (same MenuDropdown family as the slash menu). */
/** 中文说明：当前组件的局部值 MAX_HEIGHT，由紧邻初始化决定。 */
const MAX_HEIGHT = 320

/** Injected business face of the popupSelect overlay entry. */
/** 中文说明：类型或类 PopupSelectInjected 约束本文件的数据或组件职责。 */
export interface PopupSelectInjected {
  /** The session's shell controller (state store + verbs; the view never touches the open-context type). */
  popup: PopupSelectController
}

/** Full shell props: injected face + the locale seat. */
/** 中文说明：类型或类 PopupSelectViewProps 约束本文件的数据或组件职责。 */
export type PopupSelectViewProps = PopupSelectInjected & PropsLocale<'command'>

/**
 * Render the popupSelect shell overlay entry.
 * @param props - injected face: the session's shell controller; `t` rides the standard locale seat.
 * @returns the select card while open; null while closed.
 */
/** 中文说明：函数 PopupSelectView 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
export function PopupSelectView({ popup, t }: PopupSelectViewProps) {
  /** 中文说明：当前组件的局部值 state，由紧邻初始化决定。 */
  const state = useSyncExternalStore(
    fn => popup.state.subscribe(fn),
    () => popup.state.getSnapshot(),
  )
  /** 中文说明：当前组件的局部值 cardRef，由紧邻初始化决定。 */
  const cardRef = useRef<HTMLDivElement>(null)
  /** 中文说明：当前组件的局部值 searchRef，由紧邻初始化决定。 */
  const searchRef = useRef<HTMLInputElement>(null)
  // The card is bottom-anchored above the composer; clamp the design cap to
  // the space above it, re-measured on every store update.
  /** 中文说明：当前组件的局部值 maxHeight，由紧邻初始化决定。 */
  const maxHeight = useAnchoredMaxHeight(cardRef, MAX_HEIGHT, state)
  /** 中文说明：当前组件的局部值 active，由紧邻初始化决定。 */
  const active = state.open ? state.active : null

  // The search input keeps focus while arrows move a virtual highlight, so
  // the browser never scrolls the active row into view — do it here.
  useEffect(() => {
    if (active === null) return
    cardRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  // Focus ownership: the search input grabs on open, and ANY outside
  // pointer interaction dismisses —
  // capture phase so a click landing anywhere else (textarea included)
  // closes the shell before its own handlers run; that click's target then
  // takes focus naturally, so no focusComposer here.
  useEffect(() => {
    if (!state.open || state.confirming !== null) return
    /** 中文说明：当前组件的局部值 onPointerDown，由紧邻初始化决定。 */
    const onPointerDown = (ev: PointerEvent): void => {
      if (cardRef.current !== null && ev.target instanceof Node && cardRef.current.contains(ev.target)) return
      popup.dismiss()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => { document.removeEventListener('pointerdown', onPointerDown, true) }
  }, [state.open, state.confirming, popup])

  // Focus the search input after it mounts (separate effect so the ref is populated).
  useEffect(() => {
    if (state.open && state.confirming === null) searchRef.current?.focus()
  }, [state.open, state.confirming])

  if (!state.open) return null

  /** 中文说明：当前组件的局部值 rows，由紧邻初始化决定。 */
  const rows = filterOptions(state.options, state.search)
  /** 中文说明：当前组件的局部值 confirmation，由紧邻初始化决定。 */
  const confirmation = state.confirming?.confirmation

  /** 中文说明：当前组件的局部值 onKeyDown，由紧邻初始化决定。 */
  const onKeyDown = (ev: React.KeyboardEvent<HTMLDivElement>): void => {
    // ArrowLeft/ArrowRight fall through on purpose: the search input keeps
    // its native caret movement.
    switch (ev.key) {
      case 'ArrowDown':
        ev.preventDefault()
        popup.move(1)
        return
      case 'ArrowUp':
        ev.preventDefault()
        popup.move(-1)
        return
      case 'Enter':
        ev.preventDefault()
        void popup.select(state.active)
        return
      case 'Escape':
        ev.preventDefault()
        popup.dismiss({ focusComposer: true })
        return
      default:
    }
  }

  return (
    <>
      {state.confirming === null && (
        <div
          ref={cardRef}
          className={css.card}
          style={{ maxHeight }}
          aria-label={t('overlay.aria', { command: String(state.command) })}
          onKeyDown={onKeyDown}
        >
          <input
            ref={searchRef}
            className={css.search}
            type="text"
            placeholder={t('search.placeholder')}
            aria-label={t('search.aria')}
            value={state.search}
            readOnly={state.submitting}
            onChange={(ev) => { popup.setSearch(ev.currentTarget.value) }}
          />
          {state.error !== null && (
            <div className={css.error} role="alert">
              <span className={css.errorText}>{state.error}</span>
              {state.status === 'failed' && (
                <button type="button" className={css.retry} onClick={() => { popup.retry() }}>{t('retry')}</button>
              )}
            </div>
          )}
          {state.status === 'pending' && <div className={css.status}>{t('status.loading')}</div>}
          {state.submitting && <div className={css.status}>{t('status.applying')}</div>}
          {state.status === 'ready' && rows.length === 0 && <div className={css.status}>{t('status.empty')}</div>}
          {state.status === 'ready' && (
            <div role="listbox" aria-label={t('listbox.aria', { command: String(state.command) })} className={css.viewport}>
              {rows.map((option, index) => (
                <div
                  key={option.id}
                  role="option"
                  aria-selected={index === state.active}
                  className={clsx(css.row, index === state.active && css.rowActive)}
                  // mousedown would race the document capture listener; the shell
                  // owns focus anyway, so a plain click (inside the card → no
                  // dismiss) works.
                  onClick={() => { void popup.select(index) }}
                  onMouseEnter={() => { popup.highlight(index) }}
                >
                  <span className={css.label}>{option.label}</span>
                  {option.detail !== undefined && <span className={css.detail}>{option.detail}</span>}
                  {option.active === true && <span className={css.check}><IconCheckOutline16 /></span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {confirmation !== undefined && (
        <RiskConfirmation
          open
          title={confirmation.title}
          description={confirmation.description}
          acknowledgeLabel={confirmation.acknowledgeLabel}
          cancelLabel={confirmation.cancelLabel}
          confirmLabel={confirmation.confirmLabel}
          acknowledged={state.acknowledged}
          onAcknowledgedChange={(value) => { popup.acknowledge(value) }}
          onCancel={() => { popup.cancelConfirmation() }}
          onConfirm={() => { void popup.confirm() }}
        />
      )}
    </>
  )
}
