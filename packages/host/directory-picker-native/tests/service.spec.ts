/** Registration/capability behavior of the native backend (the seam's cordis half). */
/**
 * 文件职责：验证原生目录选择后端注册稳定能力对象，并随插件纤程一起撤销服务。
 * 技术维度：使用 Vitest 和真实 Cordis 上下文覆盖服务提供、能力查询及生命周期释放。
 * 产品维度：保证宿主能可靠发现系统原生选择器，并在热卸载后不再暴露失效服务。
 * 逻辑维度：装配插件、读取服务、比较能力对象身份、释放纤程，再确认服务已移除。
 * 关键边界：测试不弹出真实系统对话框；消费者允许跨调用缓存 capability 对象。
 * 新手阅读建议：重点比较 capability 的值稳定性与 fiber.dispose 后 ctx.get 的变化。
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import NativeDirectoryPicker from '../src/index.ts'

// 测试组：描述 NativeDirectoryPicker 的 Cordis 服务注册行为。
describe('NativeDirectoryPicker', () => {
  /**
   * 功能描述：确认服务以 native 能力注册、重复查询返回同一对象，并随纤程退出。
   * 参数说明：测试回调不接收参数。
   * 返回值解释：异步完成测试；服务、能力或释放断言失败时由 Vitest 报错。
   * 使用示例：保存 picker.capability() 后再次调用应得到同一对象引用。
   */
  it('registers ctx.directoryPicker with a stable native capability and leaves with its fiber', async () => {
    // ctx：承载原生目录选择服务的独立 Cordis 测试上下文。
    const ctx = new Context()
    // fiber：NativeDirectoryPicker 插件纤程，释放时应撤销服务贡献。
    const fiber = ctx.plugin(NativeDirectoryPicker)
    await fiber.await()
    // picker：从上下文取得的目录选择服务实例，装配完成后必须存在。
    const picker = ctx.get('directoryPicker')
    expect(picker).toBeInstanceOf(NativeDirectoryPicker)
    // capability：首次取得的稳定能力描述，kind 应为 native。
    const capability = picker!.capability()
    expect(capability.kind).toBe('native')
    // Stability: consumers may capture the capability object across calls.
    // 稳定性：消费者可以跨多次调用保存并比较同一个能力对象。
    expect(picker!.capability()).toBe(capability)
    await fiber.dispose()
    expect(ctx.get('directoryPicker')).toBeUndefined()
  })
})
