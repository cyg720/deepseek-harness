/**
 * 文件职责：验证会话界面宿主插件管理忙碌状态下 Enter 键行为偏好。
 * 技术维度：使用 Vitest、Cordis 和内存 SettingsProvider 测试设置注册、模式校验与释放。
 * 产品维度：确保用户可选择忙碌时转向操作，并阻止无效偏好进入持久设置。
 * 逻辑维度：装配服务，检查默认值，写入 steer，拒绝 invalid，释放后确认命名空间消失。
 * 关键边界：测试提供者不落盘；允许值由会话插件模式定义。
 * 新手阅读建议：先看默认常量，再跟踪 ns 在读取、更新、拒绝和注销中的使用。
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SettingsProvider, settingsNamespace, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  CONVERSATION_SETTINGS_NAMESPACE, DEFAULT_BUSY_ENTER_BEHAVIOR, apply,
} from '@deepseek-ai/dsh-client-ui-conversation'

/** 可写但不落盘的测试设置提供者。 */
class MemorySettings extends SettingsProvider {
  // 固定允许写入。
  readonly writable = true
  /** 加载空设置。@returns 空对象 Promise。 */
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  /** 忽略持久化。@param _ns 命名空间。@param _section 设置值。@returns 完成的 Promise。 */
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

// 会话设置宿主测试套件。
describe('ui-conversation host', () => {
  // 验证 busyEnter 设置完整生命周期。
  it('registers, validates, and disposes the durable busy-Enter preference', async () => {
    // 本用例独立上下文。
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    // 被测插件 fiber。
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    // 品牌化会话设置命名空间。
    const ns = settingsNamespace(CONVERSATION_SETTINGS_NAMESPACE)
    expect(ctx.settings.get(ns)).toEqual({ busyEnter: DEFAULT_BUSY_ENTER_BEHAVIOR })
    await ctx.settings.update(ns, { busyEnter: 'steer' })
    expect(ctx.settings.get(ns)).toEqual({ busyEnter: 'steer' })
    await expect(ctx.settings.update(ns, { busyEnter: 'invalid' })).rejects.toThrow()
    await fiber.dispose()
    // row 是已注册设置描述；释放后目标 ns 不得存在。
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(ns)
  })
})
