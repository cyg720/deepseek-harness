/**
 * 文件职责：验证 compact 命令的不变量伴生模块使用正确元数据注册无操作安装器。
 * 技术维度：使用 Vitest 模拟注册函数和最小上下文替身直接调用伴生 apply。
 * 产品维度：保证压缩命令进入应用组合时拥有可发现、可释放的诊断入口。
 * 逻辑维度：创建 register 模拟和上下文，调用 apply，检查名称、依赖、参数与安装器，最后确认清理函数。
 * 关键边界：ctx 被收窄为测试所需最小替身；本文件不执行真实会话压缩。
 * 新手阅读建议：先看 register 的两层函数返回，再跟随 apply、install、dispose 的生命周期顺序。
 */
import { describe, expect, it, vi } from 'vitest'
import * as invariant from '@deepseek-ai/dsh-command-compact/invariant'

// 测试组：描述 compact 命令伴生模块的注册协议。
describe('command-compact invariant companion', () => {
  /**
   * 功能描述：确认包自有无操作安装器按约定名称与依赖注册且可安全执行。
   * 参数说明：测试回调不接收参数。
   * 返回值解释：异步完成测试；任一元数据或调用断言失败时由 Vitest 报错。
   * 使用示例：从 register 首次调用中取出 install 并执行，不应抛出异常。
   */
  it('registers the package-owned no-op installer', async () => {
    // register：模拟注册方法并返回无参数、无返回值的注销函数。
    const register = vi.fn().mockReturnValue(() => {})
    // ctx：仅提供 invariants.register 的最小上下文替身；never 转换只用于匹配 apply 类型。
    const ctx = { invariants: { register } } as never
    // dispose：伴生 apply 返回的清理函数，当前测试只验证其函数类型。
    const dispose = await invariant.apply(ctx)
    expect(invariant.name).toBe('command-compact-invariant')
    expect(invariant.inject).toEqual(['invariants'])
    expect(register).toHaveBeenCalledWith('@deepseek-ai/dsh-command-compact', expect.any(Function))
    // 断言回调：取得首次注册的安装器并确认空操作实现可以执行。
    expect(() => {
      // install：register 首次调用的第二个参数，即包自有不变量安装器。
      const install = register.mock.calls[0]![1] as () => void
      install()
    }).not.toThrow()
    expect(dispose).toBeTypeOf('function')
  })
})
