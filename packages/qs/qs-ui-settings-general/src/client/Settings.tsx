/** 设置原型的弹窗与分区导航；原生对话框负责焦点限制和 Escape。 */
import { useCallback, useLayoutEffect, useRef, useState, useEffect } from 'react'
import type { SettingsProps, GeneralProps } from './contract.ts'
import css from './settings.module.css'
/**
 * 呈现设置入口、官方连接状态及独立分区。
 * @param props - 官方事实、槽位及本地化座位。
 * @returns 原型设置弹窗与有序引导。
 */
export function Settings({ useSections, useOnboarding, useConnection, useSettings, useSessions, reconnect, renderSlot, t }: SettingsProps) {
  const [open, setOpen] = useState(false), [selected, setSelected] = useState<string>()
  const [completed, setCompleted] = useState<ReadonlySet<string>>(() => new Set())
  const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null)
  const rows = useSections(value => value), steps = useOnboarding(value => value)
  const connection = useConnection(value => value), settings = useSettings(value => value)
  const blank = useSessions(value => value.phase === 'ready' && (value.current === undefined || value.byId[value.current]?.blank === true))
  const step = blank ? steps.find(entry => !completed.has(entry.id)) : undefined
  const active = rows.find(entry => entry.id === selected)?.id ?? rows[0]?.id
  const close = useCallback(() => { dialog.current?.close() }, [])
  useLayoutEffect(() => { if (open) dialog.current?.showModal() }, [open])
  useEffect(() => { if (!blank) setCompleted(new Set()) }, [blank])
  return <>
    <button ref={trigger} type="button" className="qs-text-button" aria-haspopup="dialog" aria-expanded={open} onClick={() => { setOpen(true) }}>{t('title')}</button>
    <dialog ref={dialog} className={css.dialog} aria-label={t('title')} data-qs-settings onClose={() => {
      setOpen(false); setSelected(undefined); trigger.current?.focus()
    }}>
      {open && <>
        <header><h2>{t('title')}</h2>{renderSlot('qs.settings.action', {})}<button type="button" className="qs-text-button" onClick={close}>{t('close')}</button></header>
        {connection === 'disconnected' ? <p role="status">{t('offline')} <button type="button" className="qs-text-button" onClick={reconnect}>{t('reconnect')}</button></p> : connection === 'connecting' ? <p role="status">{t('connecting')}</p> : null}
        {settings.status === 'loading' || settings.status === 'idle' ? <p role="status">{t('loading')}</p> : null}
        {settings.status === 'unavailable' ? <p role="status">{t('unavailable')}</p> : settings.view?.writable === false ? <p role="status">{t('readonly')}</p> : null}
        {settings.error !== null && <p role="alert">{t('failed')}</p>}
        <nav aria-label={t('title')} className={css.tabs}>{rows.map(row => <button type="button" key={row.id} aria-current={row.id === active ? 'page' : undefined} onClick={() => { setSelected(row.id) }}>{row.label}</button>)}</nav>
        <div className={css.content}>{active === undefined ? <p>{t('empty')}</p> : renderSlot('qs.settings.section', { close }, { only: active })}</div>
      </>}
    </dialog>
    {step !== undefined && !open && renderSlot('qs.settings.onboarding', {
      stepId: step.id, complete: () => { setCompleted(previous => new Set([...previous, step.id])) },
      openSection: (id) => { setSelected(id); setOpen(true) },
    }, { only: step.id })}
  </>
}
/**
 * 通用设置由对应 owner 贡献行，外壳只提供标题与间距。
 * @param props - 分区槽与文案。
 * @returns 通用设置区域。
 */
export function General({ renderSlot, t }: GeneralProps) {
  return <section><h3>{t('general')}</h3><p>{t('preferences')}</p>{renderSlot('qs.settings.general.item', {})}</section>
}
