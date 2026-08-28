/**
 * 文件职责：验证 webhook/webhook 中 invariant spec 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { WebhookDeliveryId, WebhookRuleId, WebhookSourceId } from '../src/index.ts'
import * as WebhookInvariant from '../src/invariant.ts'

/** Install the invariant over one mutable Workspace projection.
 * @remarks 中文说明：功能说明：处理 harness 相关流程；使用场景由所在模块及调用位置决定。；返回值：Promise<{ ctx:
 * Context workspaces: { path: string; sessionIds: readon…；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 harness()，并按返回类型处理结果。 */
async function harness(): Promise<{
  ctx: Context
  workspaces: { path: string; sessionIds: readonly SessionId[] }[]
}> {
  /**
   * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const ctx = new Context()
  /**
   * 常量说明：workspaces 用于处理 workspaces 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const workspaces: { path: string; sessionIds: readonly SessionId[] }[] = []
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  ctx.provide('workspaceRegistry', { list: () => workspaces } as never)
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin(WebhookInvariant)
  return { ctx, workspaces }
}

/** Append one candidate webhook inbox insertion.
 * @remarks 中文说明：功能说明：处理 insert 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；
 * 参数说明：id（SessionId）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。；
 * 参数说明：cwd（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 insert(ctx, id, cwd)，并按返回类型处理结果。 */
function insert(ctx: Context, id: SessionId, cwd?: string): void {
  /**
   * 常量说明：session 用于处理 session 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const session = ctx.sessions.create(id, { meta: { ...(cwd === undefined ? {} : { cwd }) } })
  session.append('agent/inbox/spliced', {
    target: 'next-turn',
    start: 0,
    inserted: [createUserMessage({
      content: [{ type: 'text', text: 'review' }],
      source: {
        kind: 'webhook',
        provider: 'github',
        source: WebhookSourceId('primary'),
        deliveryId: WebhookDeliveryId('delivery'),
        ruleId: WebhookRuleId('review'),
        form: 'notice',
        summary: 'review',
      },
    })],
  })
}

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('webhook prompt invariant', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('accepts prompt admission after matching Workspace attachment', async () => {
    /**
     * 常量说明：ctx、workspaces 用于处理 ctx、workspaces 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const { ctx, workspaces } = await harness()
    /**
     * 常量说明：id 用于处理 id 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const id = SessionId('attached')
    workspaces.push({ path: '/workspace', sessionIds: [id] })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => { insert(ctx, id, '/workspace') }).not.toThrow()
    await ctx.fiber.dispose()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('rejects a missing cwd, missing or duplicate Workspace, and path mismatch', async () => {
    /**
     * 常量说明：missingCwd 用于处理 missingCwd 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const missingCwd = await harness()
    /**
     * 常量说明：noCwdId 用于处理 noCwdId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const noCwdId = SessionId('no-cwd')
    missingCwd.workspaces.push({ path: '/workspace', sessionIds: [noCwdId] })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => { insert(missingCwd.ctx, noCwdId) }).toThrow(/has no cwd/)
    await missingCwd.ctx.fiber.dispose()

    /**
     * 常量说明：missing 用于处理 missing 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const missing = await harness()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => { insert(missing.ctx, SessionId('missing'), '/workspace') }).toThrow(/belongs to 0 Workspaces/)
    await missing.ctx.fiber.dispose()

    /**
     * 常量说明：duplicate 用于处理 duplicate 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const duplicate = await harness()
    /**
     * 常量说明：duplicateId 用于处理 duplicateId 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const duplicateId = SessionId('duplicate')
    duplicate.workspaces.push(
      { path: '/workspace', sessionIds: [duplicateId] },
      { path: '/workspace', sessionIds: [duplicateId] },
    )
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => { insert(duplicate.ctx, duplicateId, '/workspace') }).toThrow(/belongs to 2 Workspaces/)
    await duplicate.ctx.fiber.dispose()

    /**
     * 常量说明：mismatch 用于处理 mismatch 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const mismatch = await harness()
    /**
     * 常量说明：mismatchId 用于处理 mismatchId 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const mismatchId = SessionId('mismatch')
    mismatch.workspaces.push({ path: '/other', sessionIds: [mismatchId] })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => { insert(mismatch.ctx, mismatchId, '/workspace') }).toThrow(/differs from its Workspace path/)
    await mismatch.ctx.fiber.dispose()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('ignores non-webhook inbox messages', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { ctx } = await harness()
    /**
     * 常量说明：session 用于处理 session 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const session = ctx.sessions.create(SessionId('human'), { meta: { cwd: '/workspace' } })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => session.append('agent/inbox/spliced', {
      target: 'next-turn',
      start: 0,
      inserted: [createUserMessage({
        content: [{ type: 'text', text: 'hello' }],
        source: { kind: 'user' },
      })],
    })).not.toThrow()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => session.append('todo/write', { todos: [] })).not.toThrow()
    await ctx.fiber.dispose()
  })
})
