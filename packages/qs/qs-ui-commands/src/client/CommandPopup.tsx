/** 命令选项视图只订阅官方状态；执行、确认和草稿消费由官方控制器负责。 */
import { useEffect, useId, useRef, useSyncExternalStore } from 'react'
import type { PopupSelectController } from '@deepseek-ai/dsh-client-ui-commands/client'
import type { RiskConfirmationProps } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { QsCommandOverlayOwner } from '@deepseek-ai/dsh-qs-composer/client'
import css from './popup.module.css'

/** 官方会话控制器与该会话的焦点绑定。 */
export interface CommandPopupInjected {
  readonly popup: PopupSelectController
  readonly bindFocus: (focus: () => void) => () => void
}
/** 槽提供的输入宿主、控制器与本地化文案。 */
export type CommandPopupProps = CommandPopupInjected & QsCommandOverlayOwner & PropsLocale<'qs-ui-commands'>

/** 原生模态保留在 QS 根内，继承主题；确认状态仍由官方控制器持有。 */
function CommandRiskDialog({ title, description, acknowledgeLabel, cancelLabel, closeLabel, confirmLabel,
  acknowledged, onAcknowledgedChange, onCancel, onConfirm,
}: Omit<RiskConfirmationProps, 'open' | 'disabled'>) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId(), descriptionId = useId()
  useEffect(() => {
    // 此组件始终渲染 dialog，挂载 effect 执行时 ref 已绑定。
    const element = dialog.current as HTMLDialogElement
    element.showModal()
    return () => { element.close() }
  }, [])
  return <dialog ref={dialog} className={`qs-dialog ${css.confirmation}`} aria-labelledby={titleId}
    aria-describedby={descriptionId} data-qs-command-confirmation
    onCancel={(event) => { event.preventDefault(); onCancel() }}>
    <div className="qs-modal-head"><h2 id={titleId}>{title}</h2>
      <button type="button" className="qs-text-button" aria-label={closeLabel} onClick={onCancel}>×</button></div>
    <div className="qs-modal-body">
      <p id={descriptionId}>{description}</p>
      <label className={css.acknowledgement}><input type="checkbox" autoFocus checked={acknowledged}
        onChange={(event) => { onAcknowledgedChange(event.currentTarget.checked) }} />{acknowledgeLabel}</label>
      <div className="qs-modal-actions">
        <button type="button" className="qs-btn" onClick={onCancel}>{cancelLabel}</button>
        <button type="button" className="qs-btn qs-btn-primary" disabled={!acknowledged} onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </div>
  </dialog>
}

/**
 * 呈现命令选项和风险确认；卸载撤销迟到请求的消费与焦点写入权。
 * @param props - 同一会话的官方控制器和输入宿主。
 * @returns 已打开的选项卡或风险确认框，关闭时为空。
 */
export function CommandPopup({ popup, bindFocus, inputElement, acquireFreeze, t }: CommandPopupProps) {
  const state = useSyncExternalStore(callback => popup.state.subscribe(callback), () => popup.state.getSnapshot())
  const card = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const composing = useRef(false)
  useEffect(() => {
    const release = bindFocus(() => { inputElement.current?.focus() })
    return () => { release(); popup.dismiss() }
  }, [bindFocus, inputElement, popup])
  const reason = state.confirming !== null ? 'confirmation' : state.open ? 'command' : null
  useEffect(() => {
    if (reason !== null) return acquireFreeze(reason)
  }, [acquireFreeze, reason])
  useEffect(() => {
    if (state.open && state.confirming === null) search.current?.focus()
  }, [state.open, state.confirming])
  useEffect(() => {
    if (!state.open || state.confirming !== null) return
    const dismissOutside = (event: PointerEvent): void => {
      if (event.target instanceof Node && card.current?.contains(event.target)) return
      popup.dismiss()
    }
    document.addEventListener('pointerdown', dismissOutside, true)
    return () => { document.removeEventListener('pointerdown', dismissOutside, true) }
  }, [state.open, state.confirming, popup])
  useEffect(() => {
    // 仅滚动选项容器，避免 scrollIntoView 连带滚动聊天历史和输入区。
    const row = card.current?.querySelector<HTMLElement>('[aria-selected="true"]')
    const list = row?.parentElement
    if (row && list) {
      if (row.offsetTop < list.scrollTop) list.scrollTop = row.offsetTop
      else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) {
        list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight
      }
    }
  }, [state.active, state.search, state.options, state.confirming])
  if (!state.open) return null
  const confirmation = state.confirming?.confirmation
  if (confirmation !== undefined) return <CommandRiskDialog {...confirmation} closeLabel={t('close')}
    acknowledged={state.acknowledged} onAcknowledgedChange={(value) => { popup.acknowledge(value) }}
    onCancel={() => { popup.cancelConfirmation() }} onConfirm={() => { void popup.confirm() }} />
  // 与官方控制器的文字匹配保持一致；功能包之间不导入运行时实现。
  const query = state.search.trim().toLowerCase()
  const rows = query === '' ? state.options : state.options.filter(option =>
    option.label.toLowerCase().includes(query) || (option.detail?.toLowerCase().includes(query) ?? false))
  return <div ref={card} className={css.card} data-qs-command-popup role="region" aria-label={t('title')}
    onKeyDown={(event) => {
      // 中文输入法确认候选不能同时提交命令选项。
      if (composing.current || event.nativeEvent.isComposing) return
      // 按钮保留原生 Enter 激活，不能误选搜索框的旧高亮项。
      if (event.key === 'Enter' && event.target !== search.current) return
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); popup.move(event.key === 'ArrowDown' ? 1 : -1)
      } else if (event.key === 'Enter') {
        event.preventDefault(); void popup.select(state.active)
      } else if (event.key === 'Escape') {
        event.preventDefault(); popup.dismiss({ focusComposer: true })
      }
    }}>
    <div className={css.heading}><strong>{t('title')} /{state.command}</strong>
      <button type="button" onClick={() => { popup.dismiss({ focusComposer: true }) }}>{t('close')}</button></div>
    <input ref={search} aria-label={t('search')} value={state.search} readOnly={state.submitting}
      onChange={(event) => { popup.setSearch(event.currentTarget.value) }}
      onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }} />
    {state.error !== null && <div role="alert">{state.error}
      {state.status === 'failed' && <button type="button" onClick={() => { popup.retry() }}>{t('retry')}</button>}</div>}
    {state.status === 'pending' && <div role="status">{t('loading')}</div>}
    {state.submitting && <div role="status">{t('applying')}</div>}
    {state.status === 'ready' && rows.length === 0 && <div role="status">{t('empty')}</div>}
    {state.status === 'ready' && <div className={css.list} role="listbox" aria-label={t('title')}>
      {rows.map((option, index) => <button type="button" role="option" key={option.id}
        aria-selected={index === state.active} disabled={state.submitting}
        onMouseEnter={() => { popup.highlight(index) }} onClick={() => { void popup.select(index) }}>
        <span>{option.label}{option.active === true && <span aria-label={t('current')}> ✓</span>}</span>
        {option.detail !== undefined && <small>{option.detail}</small>}
      </button>)}
    </div>}
  </div>
}
