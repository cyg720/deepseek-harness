/**
 * 文件职责：验证主题与设计系统的 host.client.spec.ts 行为。
 * 技术维度：Vitest、React 渲染、DOM 事件和服务替身。
 * 产品维度：防止主题与设计系统显示、导航或生命周期回归。
 * 逻辑维度：构造状态，触发交互并断言输出和清理。
 * 关键边界：全局主题、DOM 尺寸和订阅必须在用例后恢复。
 * 新手阅读建议：先读夹具，再按加载、交互和卸载场景阅读。
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'
import { SettingsProvider, settingsNamespace, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  DEFAULT_PREFERENCE, THEME_SETTINGS_NAMESPACE, apply,
} from '@deepseek-ai/dsh-client-ui-theme'

/** 中文说明：类型或类 MemorySettings 约束模块数据或组件职责。 */
class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

/** Collect the injection table the way an index render or boot payload does. */
/* 中文说明：函数 collect 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function collect(ctx: Context): IndexInjection[] {
  /** 中文说明：测试局部值 table，由紧邻初始化决定。 */
  const table: IndexInjection[] = []
  ctx.emit('webserver/index-inject', table)
  return table
}

/** Narrow the theme row and return its script body. */
/* 中文说明：函数 scriptText 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function scriptText(row: IndexInjection | undefined): string {
  if (row?.kind !== 'script') throw new Error('expected a script row')
  return row.text
}

describe('ui-theme host', () => {
  it('registers, validates, and disposes the durable theme namespace with its fiber', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    /** 中文说明：测试局部值 ns，由紧邻初始化决定。 */
    const ns = settingsNamespace(THEME_SETTINGS_NAMESPACE)
    expect(ctx.settings.get(ns)).toEqual({ preference: DEFAULT_PREFERENCE, fontSize: 14 })
    await ctx.settings.update(ns, { preference: 'dark', fontSize: 16 })
    expect(ctx.settings.get(ns)).toEqual({ preference: 'dark', fontSize: 16 })
    await expect(ctx.settings.update(ns, { preference: 'sepia' })).rejects.toThrow()
    await expect(ctx.settings.update(ns, { fontSize: 11 })).rejects.toThrow()
    await expect(ctx.settings.update(ns, { fontSize: 18 })).rejects.toThrow()
    await fiber.dispose()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(ns)
  })

  it('answers each collection with the current durable preference until disposal', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    /** 中文说明：测试局部值 rows，由紧邻初始化决定。 */
    const rows = collect(ctx)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'script', placement: 'body' })
    expect(scriptText(rows[0])).toContain('const preference = "system"')
    expect(scriptText(rows[0])).toContain('"14px"')
    await ctx.settings.update(settingsNamespace(THEME_SETTINGS_NAMESPACE), { preference: 'dark', fontSize: 17 })
    expect(scriptText(collect(ctx)[0])).toContain('const preference = "dark"')
    expect(scriptText(collect(ctx)[0])).toContain('"17px"')
    await fiber.dispose()
    expect(collect(ctx)).toEqual([])
  })

  it('uses the system preference without a settings provider', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin({ apply }).await()
    expect(scriptText(collect(ctx)[0])).toContain('const preference = "system"')
  })

  it('falls back to the schema default while the theme namespace holds no section', async () => {
    // A settings provider whose namespace read comes back empty (registration
    // still pending or a provider without schema defaults).
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    ctx.provide('settings', { register: () => () => {}, get: () => undefined } as never)
    await ctx.plugin({ apply }).await()
    expect(scriptText(collect(ctx)[0])).toContain('const preference = "system"')
  })
})
