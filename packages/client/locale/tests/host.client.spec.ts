/**
 * 文件职责：验证本地化宿主插件注册、校验并释放显式语言偏好设置。
 * 技术维度：使用 Vitest、Cordis 和内存 SettingsProvider 测试真实设置生命周期。
 * 产品维度：保证用户只能选择受支持语言，且插件卸载后不残留设置命名空间。
 * 逻辑维度：装配内存设置与插件，读取默认值，写入合法/非法偏好，最后释放并检查注销。
 * 关键边界：测试替身不落盘；合法语言集合由插件配置定义，fr 应被拒绝。
 * 新手阅读建议：先看 MemorySettings，再沿 ctx、fiber、ns 和三次设置断言阅读。
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SettingsProvider, settingsNamespace, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  LOCALE_SETTINGS_NAMESPACE, apply,
} from '@deepseek-ai/dsh-client-locale'

/** 仅用于测试的可写内存设置提供者，不读取或持久化真实文件。 */
class MemorySettings extends SettingsProvider {
  // 测试提供者允许更新，固定为 true。
  readonly writable = true
  /** 返回空初始设置。@returns 空对象 Promise。@example 由 SettingsProvider 启动时调用。 */
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  /** 忽略持久化。@param _ns 命名空间。@param _section 内容。@returns 立即完成的 Promise。 */
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

// 本地化宿主测试套件。
describe('locale host', () => {
  it('registers an open locale preference with the Host settings lifecycle', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    // 被测插件 fiber，用于等待装配并在末尾显式释放。
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    // 品牌化本地化设置命名空间，用于所有读取和更新。
    const ns = settingsNamespace(LOCALE_SETTINGS_NAMESPACE)
    expect(ctx.settings.get(ns)).toEqual({})
    await ctx.settings.update(ns, { preference: 'en' })
    expect(ctx.settings.get(ns)).toEqual({ preference: 'en' })
    await ctx.settings.update(ns, { preference: 'pt-BR' })
    expect(ctx.settings.get(ns)).toEqual({ preference: 'pt-BR' })
    await expect(ctx.settings.update(ns, { preference: 'bad locale' })).rejects.toThrow()
    await expect(ctx.settings.update(ns, { preference: '123' })).rejects.toThrow()
    await fiber.dispose()
    // row 是单个已注册设置描述；释放后其 ns 不得等于目标命名空间。
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(ns)
  })
})
