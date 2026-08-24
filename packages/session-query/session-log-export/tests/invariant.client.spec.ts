/**
 * 文件职责：验证会话日志导出包的不变量伴生模块使用正确名称和依赖完成注册。
 * 技术维度：使用 Vitest 模拟函数、Cordis 服务注入和插件释放函数检查注册调用。
 * 产品维度：保证会话导出功能加入客户端组合时具备可发现的不变量入口。
 * 逻辑维度：提供模拟注册表，调用 apply，检查元数据与注册参数，再执行返回的清理函数。
 * 关键边界：模拟安装器不执行实际检查；本文件只覆盖伴生模块与注册表之间的连接。
 * 新手阅读建议：先看 register 模拟函数的两层返回值，再跟随 apply 和 dispose 理解注册与注销配对。
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply, inject, name } from '../src/invariant.ts'

// 测试组：描述会话日志导出包的不变量注册协议。
describe('@deepseek-ai/dsh-session-log-export/invariant', () => {
  /**
   * 功能描述：确认伴生模块声明正确元数据，并以包名向注册表登记安装器。
   * 参数说明：测试回调不接收参数。
   * 返回值解释：异步完成测试；断言失败时由 Vitest 报告实际调用信息。
   * 使用示例：apply(ctx) 返回的 dispose 可在断言结束后注销本次登记。
   */
  it('registers the package-owned empty companion', async () => {
    // register：模拟不变量注册方法；外层记录调用，内层模拟其返回的注销函数。
    const register = vi.fn(() => vi.fn())
    // ctx：当前测试使用的 Cordis 上下文，只提供 apply 所需的 invariants 服务。
    const ctx = new Context()
    ctx.provide('invariants', { register })
    // dispose：apply 返回的清理函数，调用后撤销本次不变量注册。
    const dispose = await apply(ctx)
    expect(name).toBe('session-export-invariant')
    expect(inject).toEqual(['invariants'])
    expect(register).toHaveBeenCalledWith('@deepseek-ai/dsh-session-log-export', expect.any(Function))
    dispose()
  })
})
