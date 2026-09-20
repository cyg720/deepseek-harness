/**
 * 主区外框。
 *
 * 声明并渲染三个子槽：`qs.stage.body`（欢迎区，session-maybe）、
 * `qs.stage.transcript`（严格 session）、`qs.composer`（输入区，session-maybe）。
 *
 * 严格 `session` 槽在无绑定时**抛 SlotAssemblyError**，因此这里先读 `useSessions`
 * 的当前会话，无会话时根本不渲染转写槽——这是分区渲染，不是兜底。
 */
import type { ReactNode } from 'react'
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { QsShellTranslate } from './AppShell.tsx'
import { QsIcon } from './Icon.tsx'
import styles from './stage.module.css'

/** 主区需要展示的副本。 */
export interface QsStageCopy {
  readonly notice: string
  readonly demoOnly: string
}

/** 主区输入。 */
export interface QsStageProps {
  readonly t: QsShellTranslate
  readonly renderSlot: PropsRenderSlots<'qs.stage.body' | 'qs.stage.transcript' | 'qs.composer'>['renderSlot']
  readonly useSessions: PropsRuntime<'qs.stage'>['useSessions']
}

/**
 * 渲染主区外框。
 * @param props - 文案、子槽渲染器与全局会话座席。
 * @returns 主区节点。
 */
export function QsStage({ t, renderSlot, useSessions }: QsStageProps): ReactNode {
  const currentTitle = useSessions(s => (s.current === undefined ? undefined : s.byId[s.current]?.displayTitle))
  const hasSession = useSessions(s => s.current !== undefined)

  return (
    <main className={styles.stage}>
      <div className={styles.stageTop}>
        <div className={styles.breadcrumb}>
          <QsIcon name="chat" size="xs" />
          <span className={styles.breadcrumbLabel}>{currentTitle ?? t('stage.newSession')}</span>
        </div>
      </div>
      <div className={styles.scroll} data-qs-scroll>
        <div className={styles.welcome}>{renderSlot('qs.stage.body', {})}</div>
        {hasSession ? renderSlot('qs.stage.transcript', {}) : null}
      </div>
      <div className={styles.composerZone}>{renderSlot('qs.composer', {})}</div>
      <div className={styles.footer}>
        {t('stage.aiNotice')} <span>·</span> {t('stage.demoOnly')}
      </div>
    </main>
  )
}
