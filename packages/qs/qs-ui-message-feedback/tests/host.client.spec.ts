/** Host 装载浏览器弹层插件不需要 DOM 或第二个控制器服务。 */
import { Context } from '@deepseek-ai/cordis'
import { expect, it } from 'vitest'
import * as plugin from '../src/index.ts'

it('Host 可以装载卸载反馈插件且不创建浏览器服务', async () => {
  const ctx = new Context()
  try {
    expect(typeof document).toBe('undefined')
    const fiber = ctx.plugin(plugin)
    await fiber
    expect(ctx.reflect.get('messageFeedbackPresentation')).toBeUndefined()
    await fiber.dispose()
  } finally { await ctx.fiber.dispose() }
})
