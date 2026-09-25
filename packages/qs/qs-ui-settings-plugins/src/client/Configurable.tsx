/** 配置卡与官方已服务命名空间求交，未加载不能当作空目录。 */
import type { ConfigurableProps } from './contract.ts'
/**
 * 渲染部署实际提供的配置卡；加载及不可用状态单独呈现。
 * @param props - 官方镜像、动态卡目录和子槽。
 * @returns 配置标签内容。
 */
export function Configurable({ useSettings, useCards, renderSlot, retry, t }: ConfigurableProps) {
  const settings = useSettings(value => value), cards = useCards(value => value)
  if (settings.view === undefined && settings.status === 'idle' && settings.error !== null) return <div role="alert"><p>{t('readFailed')}</p><button type="button" onClick={retry}>{t('retry')}</button></div>
  if (settings.view === undefined) return <p role="status">{t(settings.status === 'unavailable' ? 'unavailable' : 'loading')}</p>
  const served = new Set(settings.view.namespaces.map(namespace => namespace.ns))
  const visible = cards.filter(key => served.has(key))
  return <section>
    {settings.view.writable ? null : <p role="status">{t('readonly')}</p>}
    {visible.length === 0 ? <p>{t('emptyConfig')}</p> : visible.map(key => <div key={key}>{renderSlot('qs.settings.plugin.item', {}, { entryKey: key })}</div>)}
  </section>
}
