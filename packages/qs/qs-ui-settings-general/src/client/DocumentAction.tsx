/** 本机配置文件入口只使用官方 hasDocument 和无路径打开操作。 */
import { useEffect, useRef, useState } from 'react'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsMirrorSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
/** 本地文件打开能力不暴露磁盘路径。 */
export interface DocumentInjected {
  readonly hooks: { readonly settings: HostObservable<SettingsMirrorSnapshot> }
  /** @returns Host 是否成功打开其拥有的配置文件。 */
  openDocument(): Promise<boolean>
}
/** 配置文件操作的完整呈现座位。 */
export type DocumentProps = PropsRuntime<'qs.settings.action'> & InjectFace<DocumentInjected> & PropsLocale<'qs-ui-settings-general'>
/**
 * 文件提供者确认可用时显示入口，异步结果仅属于当前实例。
 * @param props - 镜像、打开操作与文案。
 * @returns 配置文件按钮或空呈现。
 */
export function DocumentAction({ useSettings, openDocument, t }: DocumentProps) {
  const settings = useSettings(value => value)
  const [pending, setPending] = useState(false), [failed, setFailed] = useState(false)
  const lifecycle = useRef({ active: false, pending: false })
  useEffect(() => { const owner = lifecycle.current; owner.active = true; return () => { owner.active = false } }, [])
  if (settings.status !== 'ready' || settings.view?.hasDocument !== true) return null
  const open = async (): Promise<void> => {
    const owner = lifecycle.current
    if (owner.pending) return
    owner.pending = true; setPending(true); setFailed(false)
    let success = false
    try { success = await openDocument() } catch { /* 传输失败与 Host 拒绝均只显示本地化错误。 */ }
    if (!owner.active) return
    owner.pending = false; setPending(false); setFailed(!success)
  }
  return <div>{failed && <span role="alert">{t('documentFailed')}</span>}<button type="button" className="qs-text-button" disabled={pending} onClick={() => { void open() }}>{t('document')}</button></div>
}
