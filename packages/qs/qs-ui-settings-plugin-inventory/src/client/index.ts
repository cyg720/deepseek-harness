/** 独立只读清单贡献，复用官方 Host RPC 和预设名称解析。 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-agent-preset/client'
import type {} from '@deepseek-ai/dsh-qs-ui-settings-plugins/client'
import { presetDisplayText } from '@deepseek-ai/dsh-agent-presets/display'
import { Inventory, type InventoryInjected } from './Inventory.tsx'
import { zh, en } from './locales.ts'
declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { 'qs-ui-settings-plugin-inventory': keyof typeof zh } }
/** 清单依赖只读 RPC，不声明写接口。 */
export const inject = ['slots', 'locale', 'remote', 'remote.pluginInventory']
/**
 * 向插件设置父槽贡献清单页，父槽缺失时等待。
 * @param ctx - 浏览器插件上下文。
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('qs-ui-settings-plugin-inventory', { zh, en }), 'qs inventory: locale')
  const t = ctx.locale.bind('qs-ui-settings-plugin-inventory'), copy = ctx.locale.bind('settings.agentPreset')
  const face: InventoryInjected = {
    list: async () => {
      const result = await ctx.remote.pluginInventory.list()
      if (!result.ok) throw new Error('pluginInventory.list refused')
      return result.value
    },
    presetName: preset => presetDisplayText(preset, copy).name,
  }
  ctx.slots.inject('qs.settings.plugins.tab', () => ctx.slots.register({
    name: 'qs.settings.plugins.tab', id: 'all', order: 10, label: () => t('tab'), locale: 'qs-ui-settings-plugin-inventory', inject: () => face,
  }, Inventory))
}
