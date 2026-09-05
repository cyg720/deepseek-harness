/**
 * 文件职责：验证 session/session-log-deepseek 中 invariant spec 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry, { InvariantError } from '@deepseek-ai/dsh-invariants'
import SessionStore, {
  SESSION_FORMAT_VERSION,
  SessionId,
  SessionLogOffset,
  SessionSeq,
  type Session,
} from '@deepseek-ai/dsh-session'
import * as SessionLogInvariant from '../src/invariant.ts'
import type {} from '../src/types.ts'

/**
 * 常量说明：contexts 用于处理 contexts 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const contexts: Context[] = []

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
afterEach(async () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：ctx（由 TypeScript
   * 根据调用位置推断的类型）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
   * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(ctx)，并按返回类型处理结果。
   */
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

/**
 * 功能说明：处理 setup 相关流程；使用场景由所在模块及调用位置决定。
 * @returns Promise<Context>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 setup()，并按返回类型处理结果。
 */
async function setup(): Promise<Context> {
  /**
   * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(SessionLogInvariant)
  return ctx
}

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('DeepSeek session-log acceptance invariant', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('accepts a watermark naming an earlier event in its containing Session', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = await setup()
    /**
     * 常量说明：session 用于处理 session 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const session = ctx.sessions.create(SessionId('valid'))
    session.append('turn/start', { turn: 1 })
    expect(() => session.append('session-log-deepseek/delivery-accepted', {
      sessionId: session.id,
      throughSeq: SessionSeq(0),
      sessionFormatVersion: SESSION_FORMAT_VERSION,
    }))
      .not.toThrow()
  })

  it('treats an omitted format generation as v0 before validating its frozen sequence', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('other-generation'))
    session.append('turn/start', { turn: 1 })
    expect(() => session.append('session-log-deepseek/delivery-accepted', {
      sessionId: SessionId('unrelated-old-identity'),
      throughSeq: SessionSeq(99),
    })).not.toThrow()
  })

  it.each([-1, 0.5])('rejects malformed acceptance format version %s', async (sessionFormatVersion) => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId(`invalid-format-${sessionFormatVersion}`))
    session.append('turn/start', { turn: 1 })
    expect(() => session.append('session-log-deepseek/delivery-accepted', {
      sessionId: session.id,
      throughSeq: SessionSeq(0),
      sessionFormatVersion,
    })).toThrow(expect.objectContaining<Partial<InvariantError>>({
      code: 'INVARIANT',
      packageName: '@deepseek-ai/dsh-session-log-deepseek',
    }))
  })

  it('rejects negative-zero format versions restored across the owned invariant boundary', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SessionStore)
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const session = {
      header: { version: SESSION_FORMAT_VERSION },
      snapshotEvents: () => [{
        type: 'session-log-deepseek/delivery-accepted' as const,
        seq: SessionSeq(0),
        time: 1,
        data: { sessionId: SessionId('negative-zero'), throughSeq: SessionSeq(0), sessionFormatVersion: -0 },
      }],
      isOwnSeq: () => true,
    } as unknown as Session
    ctx.sessions.list = () => [session]

    await expect(ctx.plugin(SessionLogInvariant)).rejects.toMatchObject({
      code: 'INVARIANT',
      packageName: '@deepseek-ai/dsh-session-log-deepseek',
    })
  })

  it('rejects current-generation mismatches and leaves v0 watermarks inert', async () => {
    const ctx = await setup()
    /**
     * 常量说明：wrongId 用于处理 wrongId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const wrongId = ctx.sessions.create(SessionId('wrong-id'))
    wrongId.append('turn/start', { turn: 1 })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => wrongId.append('session-log-deepseek/delivery-accepted', {
      sessionId: SessionId('other'),
      throughSeq: SessionSeq(0),
      sessionFormatVersion: SESSION_FORMAT_VERSION,
    })).toThrow(expect.objectContaining<Partial<InvariantError>>({
      code: 'INVARIANT',
      packageName: '@deepseek-ai/dsh-session-log-deepseek',
    }))

    /**
     * 常量说明：wrongSeq 用于处理 wrongSeq 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const wrongSeq = ctx.sessions.create(SessionId('wrong-seq'))
    wrongSeq.append('turn/start', { turn: 1 })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => wrongSeq.append('session-log-deepseek/delivery-accepted', {
      sessionId: wrongSeq.id,
      throughSeq: SessionSeq(1),
      sessionFormatVersion: SESSION_FORMAT_VERSION,
    })).toThrow(expect.objectContaining<Partial<InvariantError>>({
      code: 'INVARIANT',
      packageName: '@deepseek-ai/dsh-session-log-deepseek',
    }))

    const invalidSeq = ctx.sessions.create(SessionId('invalid-seq'))
    invalidSeq.append('turn/start', { turn: 1 })
    expect(() => invalidSeq.append('session-log-deepseek/delivery-accepted', {
      sessionId: invalidSeq.id,
      throughSeq: -1 as never,
      sessionFormatVersion: SESSION_FORMAT_VERSION,
    })).toThrow(expect.objectContaining<Partial<InvariantError>>({
      code: 'INVARIANT',
      packageName: '@deepseek-ai/dsh-session-log-deepseek',
    }))
    expect(() => wrongSeq.append('session-log-deepseek/delivery-accepted', {
      sessionId: wrongSeq.id,
      throughSeq: -1 as never,
    })).not.toThrow()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('validates existing history when the invariant loads after the Session', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SessionStore)
    await ctx.plugin(InvariantRegistry, { enabled: true })
    /**
     * 常量说明：id 用于处理 id 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const id = SessionId('late-invalid')
    ctx.sessions.create(id, { seed: [
      { type: 'turn/start', seq: SessionSeq(0), time: 1, data: { turn: 1 } },
      {
        type: 'session-log-deepseek/delivery-accepted',
        seq: SessionSeq(1),
        time: 2,
        data: {
          sessionId: id,
          throughSeq: SessionSeq(1),
          sessionFormatVersion: SESSION_FORMAT_VERSION,
        },
      },
    ] })

    /**
     * 变量说明：failure 用于处理 failure 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let failure: unknown
    /**
     * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      await ctx.plugin(SessionLogInvariant)
    } catch (error) {
      failure = error
    }
    expect(failure).toMatchObject<Partial<InvariantError>>({
      code: 'INVARIANT',
      packageName: '@deepseek-ai/dsh-session-log-deepseek',
    })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('allows an inherited parent watermark inside a fork seed', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SessionStore)
    await ctx.plugin(InvariantRegistry, { enabled: true })
    /**
     * 常量说明：parentId 用于处理 parentId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const parentId = SessionId('fork-parent')
    /**
     * 常量说明：childId 用于处理 childId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const childId = SessionId('fork-child')
    ctx.sessions.create(childId, {
      seed: [
        { type: 'turn/start', seq: SessionSeq(0), time: 1, data: { turn: 1 } },
        {
          type: 'session-log-deepseek/delivery-accepted',
          seq: SessionSeq(1),
          time: 2,
          data: {
            sessionId: parentId,
            throughSeq: SessionSeq(0),
            sessionFormatVersion: SESSION_FORMAT_VERSION,
          },
        },
      ],
      inheritedEventCount: SessionLogOffset(2),
      meta: { parentSession: parentId, isSeeded: true },
    })

    await expect(ctx.plugin(SessionLogInvariant)).resolves.toBeDefined()
  })
})
