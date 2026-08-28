/**
 * 文件职责：验证 api/session-controller 中 control queue host spec 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { SessionControlController } from '../src/control.ts'

/**
 * 功能说明：处理 harness 相关流程；使用场景由所在模块及调用位置决定。
 * @returns Promise<{ ctx: Context control: SessionControlController agent:
 * Agent…；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 harness()，并按返回类型处理结果。
 */
async function harness(): Promise<{
  ctx: Context
  control: SessionControlController
  agent: Agent
  inbox: Inbox
}> {
  /**
   * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  /**
   * 常量说明：session 用于处理 session 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const session = ctx.sessions.create(SessionId('queue-session'))
  /**
   * 常量说明：inbox 用于处理 inbox 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const inbox = new Inbox(session, { inserted: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {}, discarded: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {}, claimed: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {} })
  /**
   * 常量说明：agent 用于处理 agent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const agent = { id: session.id, session, inbox, status: 'running', ctx } as Agent
  ctx.agents.register(agent)
  return { ctx, control: new SessionControlController(ctx), agent, inbox }
}

/**
 * 功能说明：处理 message 相关流程；使用场景由所在模块及调用位置决定。
 * @param text （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param source （'user' | 'plugin'）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 message(text, source)，并按返回类型处理结果。
 */
function message(text: string, source: 'user' | 'plugin' = 'user') {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: source === 'user' ? { kind: 'user' } : { kind: 'plugin', plugin: 'fixture' },
  })
}

describe('Session control queue projection', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
    it('projects both pending lists in baselines and live replacement frames', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：control、inbox 用于处理 control、inbox 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { control, inbox } = await harness()
        /**
     * 常量说明：queued 用于处理 queued 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const queued = message('queued')
        /**
     * 常量说明：steering 用于处理 steering 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const steering = message('steering')
        /**
     * 常量说明：context 用于处理 context 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const context = message('context', 'plugin')
        inbox.append('next-turn', queued)
        inbox.append('next-step', steering)
        inbox.append('next-step', context)

        /**
     * 常量说明：abort 用于处理 abort 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const abort = new AbortController()
        /**
     * 常量说明：iterator 用于处理 iterator 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const iterator = control.control(abort.signal)[Symbol.asyncIterator]()
        /**
     * 常量说明：opened 用于处理 opened 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const opened = await iterator.next()
        expect(opened.value).toMatchObject({
          type: 'baseline',
          value: {
            queues: {
              'queue-session': [
                { id: queued.id, placement: 'queued' },
                { id: steering.id, placement: 'steering' },
                { id: context.id, placement: 'context' },
              ],
            },
          },
        })

        /**
     * 常量说明：replacement 用于处理 replacement 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const replacement = message('replacement')
        inbox.append('next-turn', replacement)
        /**
     * 常量说明：replaced 用于处理 replaced 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const replaced = await iterator.next()
        if (replaced.done || replaced.value.type !== 'queue') throw new Error('missing queue replacement')
        expect(replaced.value.items.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item)，并按返回类型处理结果。
 */ item => item.id)).toContain(replacement.id)
        inbox.remove(steering.id)
        /**
     * 常量说明：removed 用于处理 removed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const removed = await iterator.next()
        if (removed.done || removed.value.type !== 'queue') throw new Error('missing queue replacement')
        expect(removed.value.items.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item)，并按返回类型处理结果。
 */ item => item.id)).not.toContain(steering.id)

        abort.abort()
        await iterator.next()
      })

    it('projects the prompt rpcId from a user-rpc source and omits it elsewhere', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：control、inbox 用于处理 control、inbox 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { control, inbox } = await harness()
        /**
     * 常量说明：identified 用于处理 identified 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const identified = createUserMessage({
          content: [{ type: 'text', text: 'browser prompt' }],
          source: { kind: 'user', rpcId: 'req-42' as never },
        })
        inbox.append('next-turn', identified)
        inbox.append('next-step', message('plain steering'))

        /**
     * 常量说明：abort 用于处理 abort 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const abort = new AbortController()
        /**
     * 常量说明：iterator 用于处理 iterator 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const iterator = control.control(abort.signal)[Symbol.asyncIterator]()
        /**
     * 常量说明：opened 用于处理 opened 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const opened = await iterator.next()
        if (opened.done || opened.value.type !== 'baseline') throw new Error('missing baseline')
        /**
     * 常量说明：items 用于处理 items 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const items = opened.value.value.queues['queue-session' as SessionId] ?? []
        expect(items.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item)，并按返回类型处理结果。
 */ item => ({ id: item.id, placement: item.placement, rpcId: item.rpcId }))).toEqual([
          { id: identified.id, placement: 'queued', rpcId: 'req-42' },
          { id: items[1]?.id, placement: 'steering', rpcId: undefined },
        ])
        expect('rpcId' in (items[1] ?? {})).toBe(false)

        abort.abort()
        await iterator.next()
      })

    it('ignores inbox events without the exact live Agent session', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx、control、agent、inbox 用于处理 ctx、control、agent、inbox 相关数据，作用于当前作用域；
     * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const { ctx, control, agent, inbox } = await harness()
        /**
     * 常量说明：abort 用于处理 abort 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const abort = new AbortController()
        /**
     * 常量说明：iterator 用于处理 iterator 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const iterator = control.control(abort.signal)[Symbol.asyncIterator]()
        await iterator.next()

        /**
     * 常量说明：unrelated 用于处理 unrelated 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const unrelated = ctx.sessions.create(SessionId('unrelated-queue'))
        unrelated.append('agent/inbox/spliced', {
          target: 'next-turn',
          start: 0,
          inserted: [message('unrelated')],
        })
        /**
     * 常量说明：replacement 用于处理 replacement 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const replacement = ctx.sessions.create(SessionId('replacement-session'))
        Object.defineProperty(agent, 'session', { configurable: true, value: replacement })
        inbox.append('next-turn', message('wrong-session'))

        abort.abort()
        await iterator.next()
      })

    it('drops broadcasts after cancellation has ended its queue', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：control、inbox 用于处理 control、inbox 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { control, inbox } = await harness()
        /**
     * 常量说明：abort 用于处理 abort 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const abort = new AbortController()
        /**
     * 常量说明：iterator 用于处理 iterator 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const iterator = control.control(abort.signal)[Symbol.asyncIterator]()
        await iterator.next()
        /**
     * 常量说明：waiting 用于处理 waiting 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const waiting = iterator.next()
        await Promise.resolve()

        abort.abort()
        inbox.append('next-turn', message('late'))

        await expect(waiting).resolves.toMatchObject({ done: true })
      })

    it('ends active streams on context disposal after flushing buffered frames', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx、control、inbox 用于处理 ctx、control、inbox 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { ctx, control, inbox } = await harness()
        /**
     * 常量说明：iterator 用于处理 iterator 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const iterator = control.control(new AbortController().signal)[Symbol.asyncIterator]()
        await iterator.next()
        inbox.append('next-turn', message('first'))
        inbox.append('next-turn', message('second'))

        /**
     * 常量说明：first 用于处理 first 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const first = await iterator.next()
        expect(first).toMatchObject({ done: false, value: { type: 'queue' } })
        await ctx.fiber.dispose()
        /**
     * 常量说明：second 用于处理 second 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const second = await iterator.next()
        expect(second).toMatchObject({ done: false, value: { type: 'queue' } })
        await expect(iterator.next()).resolves.toMatchObject({ done: true })
      })
  })
