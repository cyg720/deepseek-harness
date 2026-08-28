// @vitest-environment jsdom
/*
 * 文件职责：验证文档语言属性与客户端语言状态之间的初始化和同步。
 * 技术维度：JSDOM、Cordis、Vitest 与 document.documentElement.lang。
 * 产品维度：保证辅助技术、浏览器翻译和页面元数据能识别当前界面语言。
 * 逻辑维度：装载语言插件，改变状态或文档属性，再断言双向初始化与清理。
 * 关键边界：测试会修改全局 document；每个场景必须恢复原始语言属性。
 * 新手阅读建议：先看装载辅助逻辑，再比较默认值、显式值和卸载恢复场景。
 */
/**
 * `<html lang>` tracks the active locale.
 *
 * The served markup declares one language, but the resolved locale may differ
 * (browser detection, or a stored Host preference adopted after activation),
 * and it changes again whenever the user switches. Assistive technology and
 * browser features read this attribute, so a stale value misreports the
 * document language rather than merely looking untidy.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject } from '@deepseek-ai/dsh-client-locale/client'
import type { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { LOCALE_SETTINGS_NAMESPACE, LocaleSettingsSchema } from '../src/locale-settings.ts'

/** Boot the plugin over a stub Host settings document. */
/* 中文说明：测试辅助函数 `bench`；参数含义见签名，返回值用于驱动或断言场景；例如按本文件中的调用位置使用。 */
async function bench(preference?: string) {
  /** 中文说明：当前操作所属的 Cordis 上下文；变量 `ctx` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `stored` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  let stored = preference
  /** 中文说明：标识对象、顺序或版本的标量值；变量 `revision` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  let revision = 0
  /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `namespace` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
  const namespace = () => ({
    ns: LOCALE_SETTINGS_NAMESPACE,
    schema: LocaleSettingsSchema.toJSON(),
    value: stored === undefined ? {} : { preference: stored },
    applies: 'live' as const,
    secrets: [],
    revision,
  })
  /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `describeRpc` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
  const describeRpc = vi.fn(async () => ({
    ok: true as const,
    value: { writable: true, hasDocument: true, namespaces: [namespace()] },
  }))
  const mutate = vi.fn(async (_ns: string, ops: { value: string }[]) => {
    stored = ops[0]!.value
    revision += 1
    return { ok: true as const, value: namespace() }
  })
  ctx.provide('connection', { api: {}, isLoopback: true } as never)
  // The settings transport and the forwarded-event port the plugin injects.
  new TestRemote(ctx, { settings: { describe: describeRpc, mutate } })
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  await ctx.plugin({ inject: [...inject], apply }).await()
  return { ctx, locale: ctx.get('locale') as LocaleRuntime }
}

/** 中文说明：当前测试场景使用的局部状态或中间值；变量 `langOf` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
const langOf = (): string => document.documentElement.lang

describe('document language', () => {
  beforeEach(() => {
    // The served markup declares the product default; the plugin must not
    // depend on that value already being correct.
    document.documentElement.lang = 'en'
    Object.defineProperty(navigator, 'languages', { value: ['zh-CN'], configurable: true })
    Object.defineProperty(navigator, 'language', { value: 'zh-CN', configurable: true })
  })

  afterEach(() => {
    // navigator properties are installed with defineProperty above, so they
    // are removed the same way; nothing here goes through vi.stubGlobal.
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `own` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const own = navigator as unknown as Record<string, unknown>
    delete own.languages
    delete own.language
  })

  it('states the resolved locale at activation, not the value the markup shipped', async () => {
    // A Chinese browser resolves zh even though the markup said en.
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `{ locale }` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const { locale } = await bench()
    expect(locale.getLocale().active).toBe('zh')
    expect(langOf()).toBe('zh-CN')
  })

  it('follows a locale switch in both directions with BCP 47 tags', async () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `{ locale }` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const { locale } = await bench()
    expect(langOf()).toBe('zh-CN')
    locale.setLocale('en')
    // `en` needs no region; `zh` names its script variant, which bare `zh`
    // leaves ambiguous for pronunciation and font selection.
    expect(langOf()).toBe('en')
    locale.setLocale('zh')
    expect(langOf()).toBe('zh-CN')
  })

  it('follows an explicit Host preference that overrides browser detection', async () => {
    // Stored preference wins over the zh browser pinned above.
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `{ locale }` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const { locale } = await bench('en')
    await vi.waitFor(() => { expect(locale.getLocale().active).toBe('en') })
    await vi.waitFor(() => { expect(langOf()).toBe('en') })
  })

  it('uses an external locale definition for the document language', async () => {
    const { locale } = await bench()
    locale.addLanguage({ id: 'pt-BR', label: 'Português', fallback: 'en' })
    locale.setLocale('pt-BR')
    expect(langOf()).toBe('pt-BR')
  })
})
