/** 欢迎区：无会话时的品牌问候、输入提示与资料范围说明。 */
import type { ReactNode } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { QsIcon } from './Icon.tsx'
import styles from './stage.module.css'

/** 欢迎区 props：只用到 locale 座席。 */
export type QsWelcomePaneProps = PropsLocale<'qs-shell'>

/**
 * 渲染欢迎区。
 * @param props - 语言座席。
 * @returns 欢迎区节点。
 */
export function QsWelcomePane({ t }: QsWelcomePaneProps): ReactNode {
  const [first, second] = t('welcome.title').split('\n')
  return (
    <>
      <span className={styles.welcomeSymbol}><QsIcon name="spark" /></span>
      <div className={`qs-eyebrow ${styles.welcomeEyebrow}`}>{t('welcome.eyebrow')}</div>
      <h1 className={styles.welcomeTitle}>
        {first}
        <br />
        <em>{second ?? ''}</em>
      </h1>
      <p className={styles.welcomeLead}>{t('welcome.lead')}</p>
      <p className={styles.welcomeTip}>
        <QsIcon name="shield" size="xs" />
        {t('welcome.tip')}
      </p>
    </>
  )
}
