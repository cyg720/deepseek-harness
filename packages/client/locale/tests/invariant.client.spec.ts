// @vitest-environment jsdom
// 中文：使用 jsdom 提供客户端插件所需的浏览器环境。
/**
 * 中文说明：
 * - 文件职责：验证本地化包的不变量伴生插件、无设置 Host 兼容性及中英文公共命名空间初始化。
 * - 技术维度：使用 Vitest、Cordis 客户端/服务端双入口、依赖注入替身和 LocaleRuntime。
 * - 产品维度：保障客户端启动即有中英文基础词典，并能在精简 Host 环境中安全装载。
 * - 逻辑维度：先检查空不变量安装器，再调用 Node 半边，最后搭建客户端依赖并检查重复注册拒绝。
 * - 关键边界：测试使用最小 remote/connection 替身；已占用的语言命名空间不可再次注册。
 * - 新手阅读建议：先看 inject 列出的四个依赖，再逐项对应 ctx.provide 和最终 locale 断言。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply as nodeApply } from '@deepseek-ai/dsh-client-locale'
import { apply as clientApply, COMMON_NS, LocaleRuntime, inject } from '@deepseek-ai/dsh-client-locale/client'
import * as LocaleInvariant from '@deepseek-ai/dsh-client-locale/invariant'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'

/** 中文：本地化包伴生插件和客户端装载不变量测试组。 */
describe('invariant companion', () => {
  /** 中文：装载启用的不变量注册表后，伴生插件应成功登记空安装器；无参数和返回值。 */
  it('registers under the package name with an empty installer', async () => {
    /** 当前用例的 Cordis 上下文。 */
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(LocaleInvariant).await()).resolves.toBeDefined()
  })

  /** 中文：Node 入口面对不提供 settings 的 Host 也不应抛错；无参数和返回值。 */
  it('node-half apply tolerates a Host without settings', () => {
    nodeApply(new Context())
  })

  /** 中文：搭建最小客户端依赖并验证 zh/en 公共命名空间已预占；无参数和返回值。 */
  it('client apply provides ctx.locale seeded with the zh/en common namespace', async () => {
    // The feature registers its own Language settings row, hence the slots edge.
    // 中文：本地化功能会注册语言设置行，因此依赖 slots 服务。
    expect(inject).toEqual(['slots', 'connection', 'remote', 'settingsScope'])
    /** 承载客户端服务的 Cordis 上下文。 */
    const ctx = new Context()
    new SlotRegistry(ctx)
    ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
    // The settings row's transport and the forwarded-event port.
    // 中文：remote 替身同时承担设置行传输和转发事件端口。
    ctx.provide('remote', { $on: () => () => {} } as never)
    ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
    await ctx.plugin({ inject, apply: clientApply }).await()
    /** 插件装载后由上下文提供的本地化运行时。 */
    const locale = ctx.get('locale')
    expect(locale).toBeInstanceOf(LocaleRuntime)
    // Seeded dictionaries occupy the (ns, locale) seats even while empty.
    // 中文：即使预置词典为空，也已经占用命名空间与语言组合，重复注册必须失败。
    expect(() => (locale as LocaleRuntime).register(COMMON_NS, 'zh', {})).toThrow('already has locale')
    expect(() => (locale as LocaleRuntime).register(COMMON_NS, 'en', {})).toThrow('already has locale')
  })
})
