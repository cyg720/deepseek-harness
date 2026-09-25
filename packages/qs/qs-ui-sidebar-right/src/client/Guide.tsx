/** 向导只允许打开已装配 QS 正文的注册类型，缺失项明确禁用。 */
import type { ChainRenderOpts, HookContextOf, InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { QsGuideInjected } from './contract.ts'
import css from './inspector.module.css'

/** 向导条目依赖官方注册表与本插件的正文贡献清单。 */
export type QsGuideProps = PropsRuntime<'qs.sidebar.right.tab'> & InjectFace<QsGuideInjected> & PropsLocale<'qs-ui-sidebar-right'> & PropsRenderSlots<'qs.sidebar.right.guide'>
/**
 * 打开当前标签所属会话的页面，使用官方 replaceTab 语义。
 * @param props - 当前标签及可用注册项。
 * @returns 类型入口与可见的呈现限制。
 */
export function QsGuide({ useTabInfo, useGuideEntries, useBodyKeys, definitionId, t, renderSlotChain }: QsGuideProps) {
  const { tab } = useTabInfo()
  const entries = useGuideEntries(value => value), keys = useBodyKeys(value => value)
  const fallback = <div className={css.guide} data-qs-panel-guide>
    <h2>{t('guide.title')}</h2>
    {entries.length === 0 && <p>{t('guide.empty')}</p>}
    {entries.map((entry, index) => {
      const available = keys.includes(definitionId(entry.kind) ?? '')
      return <div key={`${entry.kind}:${index}`}><button type="button" disabled={!available}
        onClick={() => { tab.actions.openTab(entry.kind, { replaceTab: true }) }}>{entry.title()}</button>
      {entry.description !== undefined && <p>{entry.description()}</p>}
      {!available && <p>{t('guide.unavailable')}</p>}
      </div>
    })}
  </div>
  const options = { hookContext: useTabInfo, fallback } satisfies ChainRenderOpts & { hookContext: HookContextOf<'qs.sidebar.right.guide'> }
  return renderSlotChain('qs.sidebar.right.guide', {}, options)
}
