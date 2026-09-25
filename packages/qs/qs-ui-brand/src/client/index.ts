/** Workbench counterpart of official ui-brand-official. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-qs-shell/client'
import { BrandMark, BrandName } from './Brand.tsx'
import { zh, en } from './locales.ts'
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'qs-ui-brand': keyof typeof zh }
}
/** Required registration services. */
export const inject = ['slots', 'locale']
/** Mount both brand contributions without occupying official brand slots.
 * @param ctx - Client plugin context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('qs-ui-brand', { zh, en }), 'qs-ui-brand: dictionaries')
  ctx.slots.inject('qs.brand.mark', () => ctx.slots.register({ name: 'qs.brand.mark', locale: 'qs-ui-brand' }, BrandMark))
  ctx.slots.inject('qs.brand.name', () => ctx.slots.register({ name: 'qs.brand.name', locale: 'qs-ui-brand' }, BrandName))
}
