/**
 * 顶栏：品牌、平台标签、面板开关、开发者界面切换、当前用户与登出。
 *
 * 作为 `qs.chrome` 槽的条目渲染：布局状态经 store 座席共享（同一个 store 句柄在
 * root 作用域只有一份实例）；登出与界面切换走本条目自己的 inject face。
 *
 * 开发者入口按部署配置显示：`showOfficialUiEntry` 为假时按钮**完全不出现**；
 * 本地冻结（首次创建/交接未完成）期间禁用并显示原因。控制器自身也会拒绝越权动作，
 * 因此这里隐藏按钮只是呈现层的收敛，不是权限判断。
 */
import type { ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { QsChromeInjected, QsShellLocaleKey } from './contract.ts'
import { createQsLayoutStore } from './layout-store.ts'
import { QsIcon } from './Icon.tsx'
import styles from './shell.module.css'

/** 顶栏条目的完整 props。 */
export type QsTopBarProps =
  PropsRuntime<'qs.chrome'>
  & PropsStore<ReturnType<typeof createQsLayoutStore>>
  & InjectFace<QsChromeInjected>
  & PropsLocale<'qs-shell'>

/**
 * 渲染顶栏。
 * @param props - store、inject 与 locale 三份共享面。
 * @returns 顶栏节点。
 */
export function QsTopBar(props: QsTopBarProps): ReactNode {
  const { t, useStore, actions, useQsAuth, useQsUiMode, signOut, switchToOfficial } = props
  const leftOpen = useStore(s => s.leftOpen)
  const rightOpen = useStore(s => s.rightOpen)
  const user = useQsAuth === undefined ? undefined : useQsAuth(s => s.user)
  const showEntry = useQsUiMode(s => s.showOfficialUiEntry)
  const frozen = useQsUiMode(s => s.freeze !== undefined)
  const userLabel = user ?? t('brand.name')
  const switchLabel: QsShellLocaleKey = frozen ? 'switch.frozen' : 'switch.toOfficial'

  return (
    <>
      <div className={styles.topbarLeft}>
        <div className="qs-brand">
          <span className={`qs-logo-mark ${styles.logoMark}`}><QsIcon name="spark" /></span>
          <div>
            <strong>{t('brand.name')}</strong>
            <small>{t('brand.tagline')}</small>
          </div>
        </div>
        <span className={styles.topbarDivider} />
        <span className={styles.platformLabel}>{t('platform.label')}</span>
        <button
          type="button"
          className="qs-icon-button"
          aria-expanded={leftOpen}
          aria-label={leftOpen ? t('nav.collapse') : t('nav.expand')}
          title={leftOpen ? t('nav.collapse') : t('nav.expand')}
          onClick={actions.toggleLeft}
        >
          <QsIcon name="panel" />
        </button>
      </div>
      <div className={styles.topbarRight}>
        {showEntry ? (
          <button
            type="button"
            className="qs-text-button"
            data-qs-switch-official
            disabled={frozen}
            title={t(switchLabel)}
            onClick={switchToOfficial}
          >
            <QsIcon name="grid" size="xs" />
            {t(switchLabel)}
          </button>
        ) : null}
        <span className={styles.topbarStatus}>
          <QsIcon name="spark" size="xs" />
          {userLabel}
        </span>
        <button type="button" className="qs-text-button" onClick={() => { actions.reset(); signOut() }}>
          {t('user.signOut')}
        </button>
        <button
          type="button"
          className="qs-icon-button"
          aria-expanded={rightOpen}
          aria-label={rightOpen ? t('inspector.collapse') : t('inspector.expand')}
          title={rightOpen ? t('inspector.collapse') : t('inspector.expand')}
          onClick={actions.toggleRight}
        >
          <QsIcon name="right" />
        </button>
      </div>
    </>
  )
}
