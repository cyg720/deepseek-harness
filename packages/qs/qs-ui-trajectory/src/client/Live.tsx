/** 实时轨迹只消费官方投影，最终状态仍由持久化台账接替。 */
import type { PartialAssistant, RunningToolCall, RenderMessageImages } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { AssistantContent } from './Content.tsx'
import { ToolCall } from './ToolCall.tsx'
import css from './trajectory.module.css'

type Copy = { focusPath?: ReadonlySet<string> | undefined; t: TranslateNS<'qs-ui-trajectory'>; renderImages: RenderMessageImages }
/**
 * 展示官方实时助手输出及根工具调用，子调用遵循官方层级。
 * @param props - 官方瞬时快照与当前会话附件呈现。
 * @returns 活动内容；空快照不保留已完成占位。
 */
export function Live({ partial, calls, t, renderImages, focusPath }: {
  partial: PartialAssistant | null
  calls: readonly RunningToolCall[]
} & Copy) {
  if (partial === null && calls.length === 0) return null
  return <section data-qs-trajectory-live aria-label={t('live')}>
    {partial !== null && <article className={css.card}>
      <h3>{t('streaming')} · {t('turn')} {partial.turn} · {t('step')} {partial.step}</h3>
      <AssistantContent blocks={partial.blocks} t={t} renderImages={renderImages} />
    </article>}
    {calls.length > 0 && <article className={css.card}><h3>{t('toolRunning')}</h3>
      {calls.map(call => <ToolCall key={call.callId} call={call} focusPath={focusPath} t={t} renderImages={renderImages} />)}
    </article>}
  </section>
}
