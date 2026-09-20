/**
 * 右栏骨架与空态。
 *
 * 第一优先只提供静态入口与空态，不引入 mock 业务数据；底部说明只写可验证事实
 * （不承诺"工作区资料隔离"这类未实现的能力，只说明当前仅本机保存）。
 */
import { clsx } from 'clsx'
import type { ReactNode } from 'react'
import type { PropsLocale, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { createQsLayoutStore } from './layout-store.ts'
import styles from './inspector.module.css'

/**
 * 右栏条目的完整 props。
 *
 * 折叠状态经 store 座席读取：与顶栏共用同一个 store 句柄，root 作用域下只有一份实例。
 */
export type QsRightPanelProps =
  PropsStore<ReturnType<typeof createQsLayoutStore>>
  & PropsLocale<'qs-shell'>

/**
 * 渲染右栏。
 * @param props - 文案与折叠状态。
 * @returns 右栏节点。
 */
export function QsRightPanel({ t, useStore, actions }: QsRightPanelProps): ReactNode {
  const tabs = ['inspector.workspace', 'inspector.todos', 'inspector.calendar'] as const
  const selected = useStore(s => s.activeRightTab)
  const setSelected = actions.setRightTab
  const hidden = !useStore(s => s.rightOpen)
  return (
    <aside
      className={clsx(styles.panel, hidden && styles.panelHidden)}
      aria-label={t('inspector.title')}
      {...(hidden ? { inert: '' } : {})}
    >
      <div className={styles.head} role="tablist" aria-label={t('inspector.title')}>
        {tabs.map((key, index) => <button key={key} type="button" role="tab" id={`qs-tab-${index}`}
          aria-selected={index === selected} aria-controls="qs-inspector-content" tabIndex={index === selected ? 0 : -1}
          onClick={() => { setSelected(index) }} onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
            event.preventDefault()
            const next = (index + (event.key === 'ArrowRight' ? 1 : 2)) % tabs.length
            setSelected(next)
            event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus()
          }}>{t(key)}</button>)}
      </div>
      <div className={styles.content} role="tabpanel" id="qs-inspector-content" aria-labelledby={`qs-tab-${selected}`} tabIndex={0}>
        <p className={styles.empty}>{t('inspector.empty')}</p>
      </div>
      <div className={styles.bottom}>
        <span>{t('inspector.localOnly')}</span>
      </div>
    </aside>
  )
}
