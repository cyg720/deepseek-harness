/**
 * 文件职责：验证匿名用户标识包注册其解释为空的 invariant companion。
 * 技术维度：使用 Vitest、Cordis Context 和 InvariantRegistry 完成真实挂载。
 * 产品维度：确保遥测和反馈关联所用身份能力在诊断清单中有明确所有者。
 * 逻辑维度：建立上下文、启用注册表、挂载身份 companion 并等待成功。
 * 关键边界：测试不生成、读取或持久化真实匿名用户标识。
 * 新手阅读建议：先看 companion 注册，再阅读身份服务的数据生成与保存流程。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as UserIdInvariant from '@deepseek-ai/dsh-anonymous-user-id/invariant'

/** 匿名身份 invariant 测试套件；由 Vitest 单元测试运行。 */
describe('invariant companion', () => {
  /** 验证包所有权 companion 可挂载；异步回调无参数和业务返回值。 */
  it('registers the package ownership with an empty installer', async () => {
    /** 本用例隔离使用的全新 Cordis 上下文。 */
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(UserIdInvariant).await()).resolves.toBeDefined()
  })
})
