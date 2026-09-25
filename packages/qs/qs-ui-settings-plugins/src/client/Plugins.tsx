/** 原型设置导航；已访问页面保留挂载，避免切换丢失未保存草稿。 */
import { useEffect, useId, useRef, useState } from 'react'
import type { PluginsProps, PluginTab } from './contract.ts'
import css from './plugins.module.css'
/**
 * 渲染动态标签并在当前贡献移除时回到第一个可用页面。
 * @param props - 标签目录、子槽及本地化座位。
 * @returns 插件设置区。
 */
export function Plugins({ useTabs, renderSlot, t }: PluginsProps) {
  const id = useId(), rows = useTabs(value => value)
  const [chosen, setChosen] = useState<string>()
  const [visited, setVisited] = useState<ReadonlySet<string>>(() => new Set())
  const buttons = useRef<Array<HTMLButtonElement | null>>([])
  const active = rows.find(row => row.id === chosen)?.id ?? rows[0]?.id
  useEffect(() => {
    if (active === undefined) return
    setVisited(previous => previous.has(active) ? previous : new Set([...previous, active]))
  }, [active])
  return <section className={css.section}>
    <h3>{t('title')}</h3><p>{t('intro')}</p>
    {rows.length === 0 ? <p role="status">{t('empty')}</p> : <>
      <div role="tablist" aria-label={t('tabs')} className={css.tabs}>{rows.map((row, index) => <button
        key={row.id} ref={(element) => { buttons.current[index] = element }} type="button" role="tab"
        id={`${id}-tab-${row.id}`} aria-controls={`${id}-panel-${row.id}`} aria-selected={row.id === active}
        tabIndex={row.id === active ? 0 : -1} onClick={() => { setChosen(row.id) }}
        onKeyDown={(event) => {
          let next: number
          switch (event.key) {
            case 'ArrowRight': next = (index + 1) % rows.length; break
            case 'ArrowLeft': next = (index + rows.length - 1) % rows.length; break
            case 'Home': next = 0; break
            case 'End': next = rows.length - 1; break
            default: return
          }
          // 键盘处理来自已挂载标签；环绕索引始终落在当前同一批行与按钮中。
          const row = rows[next] as PluginTab, button = buttons.current[next] as HTMLButtonElement
          event.preventDefault(); setChosen(row.id); button.focus()
        }}
      >{row.label}</button>)}</div>
      {rows.filter(row => row.id === active || visited.has(row.id)).map(row => <div key={row.id}
        id={`${id}-panel-${row.id}`} role="tabpanel" aria-labelledby={`${id}-tab-${row.id}`} hidden={row.id !== active}
      >{renderSlot('qs.settings.plugins.tab', {}, { only: row.id })}</div>)}
    </>}
  </section>
}
