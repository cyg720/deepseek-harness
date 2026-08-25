/**
 * 文件职责：验证通用设置宿主插件注册并随 fiber 释放持久化的新手引导命名空间。
 * 技术维度：使用 Vitest、真实 Cordis 上下文和内存 SettingsProvider 测试替身。
 * 产品维度：确保新手引导设置能被发现，且插件卸载后不会留下失效配置入口。
 * 逻辑维度：装配内存设置服务，启动被测插件，检查命名空间存在，释放后检查其消失。
 * 关键边界：测试替身不落盘；命名空间字符串必须与 src/index.ts 内部标识保持一致。
 * 新手阅读建议：先看 MemorySettings 如何满足抽象服务，再跟踪 fiber 启动和释放前后的 describe 结果。
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SettingsProvider, settingsNamespace, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { apply } from '../src/index.ts'

/** Mirrors the module-local namespace id in src/index.ts. */
/* 镜像 src/index.ts 的模块内命名空间标识；用于断言而非另立产品配置。 */
const ONBOARDING_SETTINGS_NAMESPACE = 'ui-onboarding'

/** 仅供测试使用的内存设置提供者；允许写入但不读取或持久化真实文件。 */
class MemorySettings extends SettingsProvider {
  // 表示提供者允许写操作；固定为 true。
  readonly writable = true
  /** 加载空设置。@returns 已完成的空对象 Promise。@example await provider.load() 由框架内部调用。 */
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  /** 忽略持久化请求。@param _ns 设置命名空间，测试中不使用。@param _section 设置内容，测试中不保存。@returns 立即完成的 Promise。 */
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

// 通用设置宿主插件测试套件。
describe('ui-settings-general host', () => {
  // 验证命名空间与插件 fiber 生命周期一致；异步返回 Promise<void>。
  it('registers and disposes the durable onboarding namespace with its fiber', async () => {
    // 本用例独立 Cordis 上下文；承载设置服务和被测插件。
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    // 被测插件 fiber；用于等待完成装配并显式触发释放。
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    // 每个 row 是已登记设置描述；这里只提取其命名空间用于存在性断言。
    expect(ctx.settings.describe().map(row => row.ns)).toContain(
      settingsNamespace(ONBOARDING_SETTINGS_NAMESPACE),
    )
    await fiber.dispose()
    // 释放后再次遍历描述行，目标命名空间必须消失。
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(
      settingsNamespace(ONBOARDING_SETTINGS_NAMESPACE),
    )
  })
})
