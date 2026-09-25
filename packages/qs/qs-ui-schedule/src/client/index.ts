/** 对应官方 ui-schedule，仅从共享投影读取活动提醒。 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-qs-composer/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-schedule/client'
import { ScheduleCatalogAction } from './ScheduleCatalogAction.tsx'
import { en, NS, zh, type ScheduleCatalogKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Read-only active Schedule catalog copy. */
    'qs-schedule.catalog': ScheduleCatalogKey
  }
}

/** Required services for locale registration and header-slot contribution. */
export const inject = ['slots', 'locale']

/**
 * 注册语言与会话标题动作，随贡献卸载清理。
 * @param ctx - 浏览器插件上下文。
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'qs-ui-schedule: dictionaries')
  ctx.slots.inject(
    'qs.stage.header.actions',
    () => ctx.slots.register({
      name: 'qs.stage.header.actions',
      id: 'qs-schedule-catalog',
      // 与官方顺序一致：调度目录位于后台作业之前。
      order: 10,
      locale: NS,
    }, ScheduleCatalogAction),
  )
}
