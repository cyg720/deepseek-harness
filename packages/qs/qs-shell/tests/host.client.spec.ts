/** Host 装载不得依赖浏览器环境；外壳配置只随插件挂载注入页面。 */
import { Context } from '@deepseek-ai/cordis'
import { expect, it } from 'vitest'
import * as shell from '../src/index.ts'
import * as login from '@deepseek-ai/dsh-qs-login'
import * as composer from '@deepseek-ai/dsh-qs-composer'
import * as sessions from '@deepseek-ai/dsh-qs-sessions'
import * as transcript from '@deepseek-ai/dsh-qs-transcript'
import * as approval from '@deepseek-ai/dsh-qs-approval'
import * as questions from '@deepseek-ai/dsh-qs-questions'
import * as brand from '@deepseek-ai/dsh-qs-ui-brand'
import * as sidebar from '@deepseek-ai/dsh-qs-ui-sidebar'
import * as right from '@deepseek-ai/dsh-qs-ui-sidebar-right'
import { QS_UI_CONFIG_GLOBAL } from '../src/config.ts'
it('纯浏览器插件的 Host 半边可由 Cordis 完整装载及卸载', async () => {
  const ctx = new Context()
  try {
    expect(typeof document).toBe('undefined')
    // 同一组合中反复装卸，确认不会从 Host 导入 DOM、注册会话写入者或注入额外页面配置。
    for (const plugin of [login, composer, sessions, transcript, approval, questions, brand, sidebar, right]) {
      const fiber = ctx.plugin(plugin)
      await fiber
      await fiber.dispose()
    }
    const table: Parameters<Parameters<typeof ctx.on<'webserver/index-inject'>>[1]>[0] = []
    ctx.emit('webserver/index-inject', table)
    expect(table).toEqual([])
  } finally { await ctx.fiber.dispose() }
})
it.each([undefined, { defaultUi: 'official' as const, showOfficialUiEntry: true, notificationCapacity: 256 }])('启动配置 %j 注入一次且卸载撤销', async (config) => {
  const ctx = new Context()
  try {
    ctx.provide('webServer', {} as never)
    const fiber = ctx.plugin({ apply: shell.apply }, config)
    await fiber
    const table: Parameters<Parameters<typeof ctx.on<'webserver/index-inject'>>[1]>[0] = []
    ctx.emit('webserver/index-inject', table)
    expect(table).toEqual([{ kind: 'global', name: QS_UI_CONFIG_GLOBAL, value: { notificationCapacity: 256, ...(config ?? { defaultUi: 'workbench', showOfficialUiEntry: false }) } }])
    await fiber.dispose()
    const after: typeof table = []
    ctx.emit('webserver/index-inject', after)
    expect(after).toEqual([])
  } finally { await ctx.fiber.dispose() }
})
it('Loader schema 应用默认值并拒绝错误配置类型', () => {
  expect(shell.Config({} as never)).toEqual({ notificationCapacity: 256, defaultUi: 'workbench', showOfficialUiEntry: false })
  expect(() => shell.Config({ defaultUi: 'invalid' } as never)).toThrow()
  expect(() => shell.Config({ showOfficialUiEntry: 'true' } as never)).toThrow()
})
