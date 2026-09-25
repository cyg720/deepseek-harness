/** 主区承载欢迎、转写、固定待回答区和输入；无会话时不请求严格 session 槽。 */
import type { ReactNode } from 'react'
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { QsIcon } from './Icon.tsx'
import styles from './stage.module.css'

/** 主区需要展示的副本。 */
export interface QsStageCopy {
  readonly notice: string
  readonly demoOnly: string
}

/** 主区输入。 */
export interface QsStageProps {
  readonly t: TranslateNS<'qs-conversation'>
  readonly renderSlot: PropsRenderSlots<'qs.stage.reading' | 'qs.stage.header.actions' | 'qs.stage.body' | 'qs.stage.transcript' | 'qs.stage.pending' | 'qs.composer.dock' | 'qs.composer'>['renderSlot']
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
  // 欢迎区只用于无会话或官方摘要确认空白的会话，不遮挡历史顶部及分页触发点。
  const showWelcome = useSessions(s => s.current === undefined || s.byId[s.current]?.blank === true)

  const chat = hasSession ? renderSlot('qs.stage.transcript', {}) : null

  return (
    <main className={styles.stage}>
      <div className={styles.stageTop}>
        <div className={styles.breadcrumb}>
          <QsIcon name="chat" size="xs" />
          <span className={styles.breadcrumbLabel} data-qs-session-heading tabIndex={-1}>{currentTitle ?? t('stage.newSession')}</span>
        </div>
        {hasSession ? <div className={styles.headerActions}>{renderSlot('qs.stage.header.actions', {})}</div> : null}
      </div>
      <div className={styles.scroll} data-qs-scroll>
        {showWelcome ? <div className={styles.welcome}>{renderSlot('qs.stage.body', {})}</div> : null}
        {hasSession ? renderSlot('qs.stage.reading', { chat }, { fallback: chat }) : null}
      </div>
      {/* 待回答区常驻会话座位，阅读内容滚动或卸载不影响回答。 */}
      {hasSession ? <div className={styles.pendingZone}>{renderSlot('qs.stage.pending', {})}</div> : null}
      <div className={styles.composerZone}>
        {hasSession ? renderSlot('qs.composer.dock', {}) : null}
        {renderSlot('qs.composer', {})}
      </div>
      <div className={styles.footer}>
        {t('stage.aiNotice')} <span>·</span> {t('stage.demoOnly')}
      </div>
    </main>
  )
}
