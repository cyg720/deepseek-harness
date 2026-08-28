// @vitest-environment jsdom
/**
 * 文件职责：验证插件清单的 browser-plugin.client.spec.tsx 行为。
 * 技术维度：Vitest、React 渲染、表单事件和 API 替身。
 * 产品维度：防止插件清单保存、发现和错误提示回归。
 * 逻辑维度：构造配置状态，触发操作并断言请求与界面。
 * 关键边界：敏感值不得意外回显；异步发现和保存必须清理。
 * 新手阅读建议：先读状态夹具，再按加载、编辑、保存场景阅读。
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject, NS } from '../src/client/index.ts'
import { PluginInventorySettingsTab } from '../src/client/PluginInventorySettingsTab.tsx'
import type { PluginInventorySettingsTabInjected } from '../src/client/PluginInventorySettingsTab.tsx'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)

/** 中文说明：测试局部值 EMPTY，由紧邻初始化决定。 */
const EMPTY = { entries: [] }
/** 中文说明：类型或类 ListResult 约束设置数据或组件职责。 */
type ListResult =
  | { readonly ok: true; readonly value: typeof EMPTY }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/** 中文说明：函数 bench 的参数见签名，返回结果供设置流程使用；示例见本文件。 */
async function bench() {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  /** 中文说明：测试局部值 locale，由紧邻初始化决定。 */
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  /** 中文说明：类型或类 RemoteService 约束设置数据或组件职责。 */
  class RemoteService extends Service {
    constructor(serviceCtx: Context) {
      super(serviceCtx, 'remote')
    }
  }
  new RemoteService(ctx)
  /** 中文说明：测试局部值 list，由紧邻初始化决定。 */
  const list = vi.fn<() => Promise<ListResult>>()
    .mockResolvedValue({ ok: true, value: EMPTY })
  ctx.provide('remote.pluginInventory', { list })
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale, list }
}

/** 中文说明：函数 declare 的参数见签名，返回结果供设置流程使用；示例见本文件。 */
function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.plugins.tab': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

describe('ui-settings-plugin-inventory browser plugin', () => {
  it('declares only the services used by the Settings Remote contribution', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.pluginInventory'])
  })

  it('registers a localized tab without reading the Remote eagerly', async () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    /** 中文说明：测试局部值 entry，由紧邻初始化决定。 */
    const entry = b.slots.entries('settings.plugins.tab')[0]!
    expect(entry.component).toBe(PluginInventorySettingsTab)
    expect(entry.options).toMatchObject({ id: 'all', order: 10 })
    expect(entry.locale).toBe(NS)
    expect(resolveSlotLabel(entry.options.label)).toBe('插件列表')
    expect(b.list).not.toHaveBeenCalled()

    /** 中文说明：测试局部值 injected，由紧邻初始化决定。 */
    const injected = (entry.inject as unknown as () => PluginInventorySettingsTabInjected)()
    await expect(injected.list()).resolves.toEqual(EMPTY)
    expect(b.list).toHaveBeenCalledOnce()
    b.list.mockResolvedValueOnce({ ok: false, error: { code: 'REMOTE_ERROR', message: 'unavailable' } })
    await expect(injected.list()).rejects.toThrow('pluginInventory.list failed: REMOTE_ERROR: unavailable')
    await b.ctx.fiber.dispose()
  })

  it('follows locale and recovers across late declaration and declarer reload', async () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench()
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)

    /** 中文说明：测试局部值 stop，由紧邻初始化决定。 */
    const stop = declare(b.slots)
    await vi.waitFor(() => { expect(b.slots.entries('settings.plugins.tab')).toHaveLength(1) })
    b.locale.setLocale('en')
    expect(resolveSlotLabel(b.slots.entries('settings.plugins.tab')[0]!.options.label)).toBe('Plugin list')

    stop()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)
    declare(b.slots)
    await vi.waitFor(() => {
      expect(b.slots.entries('settings.plugins.tab')[0]?.component).toBe(PluginInventorySettingsTab)
    })

    await fiber.dispose()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)
    expect(() => b.locale.register(NS, 'zh', {})).not.toThrow()
    await b.ctx.fiber.dispose()
  })
})
