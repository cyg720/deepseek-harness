/** 交付列表消费官方持久投影和共享打开状态，不从助手正文推断文件。 */
import { useEffect, useState } from 'react'
import type { DeliverablesInjected, DeliverablesPresentation } from '@deepseek-ai/dsh-client-ui-deliverables/client'
import type { InjectFace, PropsLocale, SessionStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import css from './deliverables.module.css'

/** 会话文件预览交给官方资源路由，原生操作仍交给共享控制器。 */
export interface DeliveredInjected extends DeliverablesInjected {
  readonly openFile: (path: string) => void
  readonly fileKey: DeliverablesPresentation['key']
}
/** 选择器结果只含本轮成功产生或声明的路径。 */
export type DeliverablesProps = {
  readonly matched: NonNullable<ReturnType<DeliverablesPresentation['select']>>
} & InjectFace<DeliveredInjected> & Pick<SessionStandardProps, 'sessionId'> & PropsLocale<'qs-ui-deliverables'>
/**
 * 显示变更文件、交付声明与显式本机操作。
 * @param props - 官方选择器、会话座位和共享控制器。
 * @returns 交付列表及可恢复的失败状态。
 */
export function Deliverables({ matched, sessionId, openFile, fileKey, usePresentedHost, usePresentedOpen,
  reloadPresentedHost, openPresented, t }: DeliverablesProps) {
  const host = usePresentedHost(value => value), states = usePresentedOpen(value => value)
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    if (matched.presented.length > 0 && host === null) void reloadPresentedHost()
  }, [matched.presented.length, host, reloadPresentedHost])
  const entries = expanded ? matched.presented : matched.presented.slice(0, 4)
  return <section className={css.root} data-qs-deliverables>
    {matched.produced.length > 0 && <div><h4>{t('produced')}</h4><ul className={css.files}>
      {matched.produced.map(path => <li key={path}><button type="button" title={path} aria-label={t('preview', { name: path })}
        onClick={() => { openFile(path) }}>{path}</button></li>)}
    </ul></div>}
    {matched.presented.length > 0 && <div><h4>{t('presented')}</h4>
      {host === null && <p role="status">{t('loading')}</p>}
      {host === 'error' && <p role="alert">{t('hostError')}<button type="button" onClick={() => { void reloadPresentedHost() }}>{t('retry')}</button></p>}
      {host !== null && host !== 'error' && !host.available && <p role="status">{t('unavailable')}</p>}
      <ul className={css.files}>{entries.map((file) => {
        const phase = states[fileKey(sessionId, file.seq, file.index)]
        const disabled = host === null || host === 'error' || !host.available || phase === 'opening' || phase === 'revealing'
        return <li key={`${file.seq}:${file.index}`} className={css.card}>
          <button type="button" title={file.path} aria-label={t('preview', { name: file.path })} onClick={() => { openFile(file.path) }}>{file.path}</button>
          {file.description === undefined ? null : <p>{file.description}</p>}
          {phase === undefined ? null : <p role="status">{t(phase)}</p>}
          <div className={css.actions}>
            <button type="button" disabled={disabled} onClick={() => { void openPresented(sessionId, file.seq, file.index, 'open') }}>{t('open')}</button>
            <button type="button" disabled={disabled} onClick={() => { void openPresented(sessionId, file.seq, file.index, 'reveal') }}>{t(host !== null && host !== 'error' && host.fileManager === 'directory' ? 'directory' : 'reveal')}</button>
          </div>
        </li>
      })}</ul>
      {matched.presented.length > 4 && <button type="button" aria-expanded={expanded} onClick={() => { setExpanded(value => !value) }}>
        {t(expanded ? 'collapse' : 'all', { count: matched.presented.length })}</button>}
    </div>}
  </section>
}
