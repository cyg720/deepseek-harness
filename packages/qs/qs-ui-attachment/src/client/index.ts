/** 对应官方附件的消息、工具与轨迹贡献；新增上传不在本期范围。 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { Gallery } from './Gallery.tsx'
import { zh, en } from './locales.ts'
export type * from './contract.ts'
/** 呈现仅依赖槽注册和语言。 */
export const inject = ['slots', 'locale']
/**
 * 每个官方职责对应独立槽注册，宿主缺席时等待声明。
 * @param ctx - 浏览器插件上下文。
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('qs-ui-attachment', { zh, en }), 'qs-ui-attachment: dictionaries')
  for (const name of ['qs.conversation.message.images', 'qs.tool.call.images', 'qs.conversation.trajectory.images'] as const) {
    ctx.slots.inject(name, () => ctx.slots.register({ name, locale: 'qs-ui-attachment' }, Gallery))
  }
}
