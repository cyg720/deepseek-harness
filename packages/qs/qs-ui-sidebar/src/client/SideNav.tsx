/**
 * 左导航骨架。
 *
 * 归属划分：导航骨架、工具入口空态与用户区属于本插件；**会话列表与新建会话**
 * 属于 `qs.nav` 槽（由 qs-sessions 贡献），外壳只负责摆放位置与呈现容器。
 */
import { clsx } from 'clsx'
import { useRef, useState, type ReactNode } from 'react'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { QsIcon } from './Icon.tsx'
import styles from './nav.module.css'

/** 左导航输入。 */
export interface QsSideNavProps {
  readonly t: TranslateNS<'qs-ui-sidebar'>
  readonly renderSlot: PropsRenderSlots<'qs.nav' | 'qs.sidebar.settings'>['renderSlot']
  /** 折叠时宽度归零并移出可访问树。 */
  readonly hidden: boolean
  readonly user: string | undefined
}

/**
 * 渲染左导航骨架。
 * @param props - 文案、槽渲染器与折叠状态。
 * @returns 左导航节点。
 */
export function QsSideNav({ t, renderSlot, hidden, user }: QsSideNavProps): ReactNode {
  const dialog = useRef<HTMLDialogElement>(null)
  const keys = ['nav.agents', 'nav.plugins', 'nav.rag', 'nav.skills', 'nav.apps', 'nav.terminals'] as const
  const [selected, setSelected] = useState<typeof keys[number]>('nav.apps')
  return (
    <aside
      className={clsx(styles.nav, hidden && styles.navHidden)}
      aria-label={t('brand.name')}
      {...(hidden ? { inert: '' } : {})}
    >
      <div className={styles.workspacePicker}>
        <span className={styles.workspaceAvatar}>{t('brand.name').slice(0, 1)}</span>
        <span className={styles.workspaceName}>{t('platform.label')}</span>
        <QsIcon name="chevron" size="xs" />
      </div>
      <div className={styles.navBody}>{renderSlot('qs.nav', {})}</div>
      <div className={styles.navTools}>
        {keys.map(key => <button type="button" key={key} className="qs-text-button" onClick={() => { setSelected(key); dialog.current?.showModal() }}><QsIcon name="grid" size="xs" />{t(key)}</button>)}
      </div>
      <dialog ref={dialog} className="qs-dialog" aria-label={t(selected)}>
        <h2>{t(selected)}</h2>
        {/* W11 本期只保留说明；此入口不创建第三方授权或连接。 */}
        {selected === 'nav.apps' ? <div data-qs-integrations-deferred>
          <p>{t('integrations.deferred')}</p><p>{t('integrations.scope')}</p>
        </div> : <p>{t('nav.empty')}</p>}
        <button type="button" className="qs-btn" onClick={() => { dialog.current?.close() }}>{t('nav.back')}</button>
      </dialog>
      <div className={styles.navBottom}>
        {/* 设置壳独立装卸，侧栏不接管配置状态。 */}
        {renderSlot('qs.sidebar.settings', {})}
        <span className={styles.avatar}>{(user ?? t('brand.name')).slice(0, 1).toUpperCase()}</span>
        <span className={styles.profileTrigger}>
          <span className={styles.profileText}>
            <strong>{user ?? t('brand.name')}</strong>
            <small>{t('platform.label')}</small>
          </span>
        </span>
      </div>
    </aside>
  )
}
