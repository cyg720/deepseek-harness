// @vitest-environment jsdom
// 中文：使用 jsdom 装载并验证客户端主题插件。
/**
 * 中文说明：
 * - 文件职责：验证主题包伴生插件、Node 可选依赖等待和客户端主题服务装配。
 * - 技术维度：使用 Vitest、Cordis、客户端插槽/本地化依赖和设置作用域替身。
 * - 产品维度：保证外观设置在不同 Host 能力下可安全启动，并向界面提供 ThemeRuntime。
 * - 逻辑维度：先验证空不变量注册，再测试 Node 半边，最后搭建五项客户端依赖并装载主题。
 * - 关键边界：connection/remote/settingsScope 均为最小替身；主题依赖 locale 先完成装载。
 * - 新手阅读建议：先看 inject 数组，再将每个名字对应到 ctx.provide 或前置 plugin 调用。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply as nodeApply } from '@deepseek-ai/dsh-client-ui-theme'
import { apply as clientApply, inject, ThemeRuntime } from '@deepseek-ai/dsh-client-ui-theme/client'
import * as ThemeInvariant from '@deepseek-ai/dsh-client-ui-theme/invariant'
import { apply as localeApply, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'

/** 中文：主题包伴生插件和装配不变量测试组。 */
describe('invariant companion', () => {
  /** 中文：启用注册表后主题伴生插件应成功注册空安装器；无参数和返回值。 */
  it('registers under the package name with an empty installer', async () => {
    /** 当前用例的 Cordis 上下文。 */
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(ThemeInvariant).await()).resolves.toBeDefined()
  })

  /** 中文：Node 入口面对尚未出现的可选 Host 服务不应抛错；无参数和返回值。 */
  it('node-half waits for optional Host services', () => {
    nodeApply(new Context())
    expect(true).toBe(true)
  })

  /** 中文：搭建插槽、本地化和设置依赖后应提供 ThemeRuntime；无参数和返回值。 */
  it('client apply provides ctx.theme over the slots/locale edges', async () => {
    // The feature registers its own Appearance settings row with localized
    // copy, hence the slots + locale edges.
    // 中文：主题功能注册带本地化文案的“外观”设置行，因此依赖 slots 与 locale。
    expect(inject).toEqual(['slots', 'locale', 'connection', 'remote', 'settingsScope'])
    /** 承载最小客户端服务图的 Cordis 上下文。 */
    const ctx = new Context()
    new SlotRegistry(ctx)
    ctx.provide('connection', {
      api: { settings: { describe: () => Promise.resolve({
        rpcId: 'theme-invariant' as never,
        result: { ok: true, value: { writable: true, hasDocument: false, namespaces: [] } },
      }) } },
      isLoopback: true,
    } as never)
    // The settings row's transport and the forwarded-event port.
    // 中文：remote 替身同时承担设置行传输和转发事件端口。
    ctx.provide('remote', { $on: () => () => {} } as never)
    ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
    await ctx.plugin({ inject: localeInject, apply: localeApply }).await()
    await ctx.plugin({ inject, apply: clientApply }).await()
    expect(ctx.get('theme')).toBeInstanceOf(ThemeRuntime)
  })
})
