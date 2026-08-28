// @vitest-environment jsdom
/** Exercises Chat selection through the real SlotRegistry store axis.
 * @remarks 文件说明：文件职责：验证 client/ui-chat 中 selection survival client spec
 * 相关行为与失败场景。；技术维度：主要使用TypeScript、React 与项目的插件化客户端组件体系，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */
import { describe, expect, it } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { createChatStore } from '../src/client/stores.ts'

/**
 * 常量说明：sid 用于处理 sid 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 sid 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns SessionId；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 sid(value)，并按返回类型处理结果。
 */
const sid = (value: string): SessionId => value as SessionId

type ChatInstance = ReturnType<ReturnType<typeof createChatStore>['create']>

/**
 * 功能说明：创建 Bench 相关流程；使用场景由所在模块及调用位置决定。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 createBench()，并按返回类型处理结果。
 */
async function createBench() {
  /**
   * 常量说明：runtime 用于处理 runtime 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const runtime = await SlotTestRuntime.create()
  /**
   * 常量说明：chat 用于处理 chat 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const chat = createChatStore()
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_props（PropsRenderSlots<'conversa
   * tion.view' | 'details'>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
   * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(_props)，
   * 并按返回类型处理结果。
   */
  await runtime.root.declare({
    'conversation.view': { kind: 'list', scope: 'session' },
    'details': { kind: 'single', scope: 'session' },
  }, (_props: PropsRenderSlots<'conversation.view' | 'details'>) => null)
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  runtime.slots.register({ name: 'conversation.view', id: 'chat', store: chat }, () => null)
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  runtime.slots.register({ name: 'details', store: chat }, () => null)
  runtime.renderRoot()
  return { runtime }
}

/**
 * 功能说明：处理 storeFor 相关流程；使用场景由所在模块及调用位置决定。
 * @param current （Awaited<ReturnType<typeof createBench>>）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @param slot （'conversation.view' | 'details'）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @param sessionId （SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns ChatInstance；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 storeFor(current, slot, sessionId)，并按返回类型处理结果。
 */
function storeFor(
  current: Awaited<ReturnType<typeof createBench>>,
  slot: 'conversation.view' | 'details',
  sessionId: SessionId,
): ChatInstance {
  return current.runtime.storeOf(slot, sessionId) as ChatInstance
}

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('Chat selection survives on its store seat', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('shares one instance between the Chat View and details panel', async () => {
    /**
     * 常量说明：b 用于处理 b 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const b = await createBench()
    await b.runtime.sessions.add({ id: 's1' })
    /**
     * 常量说明：chat 用于处理 chat 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const chat = storeFor(b, 'conversation.view', sid('s1'))
    /**
     * 常量说明：details 用于处理 details 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const details = storeFor(b, 'details', sid('s1'))
    chat.actions.select({ turnSeq: 3, callId: 'c1' })

    expect(details).toBe(chat)
    expect(details.store.getSnapshot().selection).toEqual({ turnSeq: 3, callId: 'c1' })
    await b.runtime.dispose()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('isolates Session instances and preserves identity across list projection updates', async () => {
    /**
     * 常量说明：b 用于处理 b 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const b = await createBench()
    /**
     * 常量说明：oneId 用于处理 oneId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const oneId = sid('s1')
    await b.runtime.sessions.add({ id: 's1' })
    await b.runtime.sessions.add({ id: 's2' })
    /**
     * 常量说明：one 用于处理 one 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const one = storeFor(b, 'conversation.view', oneId)
    /**
     * 常量说明：two 用于处理 two 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const two = storeFor(b, 'conversation.view', sid('s2'))
    one.actions.select({ turnSeq: 1, callId: 'a' })
    two.actions.select({ turnSeq: 9, callId: 'z' })

    await b.runtime.sessions.updateSummary(oneId, { displayTitle: 'projected' })

    expect(storeFor(b, 'conversation.view', oneId)).toBe(one)
    expect(one.store.getSnapshot().selection).toEqual({ turnSeq: 1, callId: 'a' })
    expect(two.store.getSnapshot().selection).toEqual({ turnSeq: 9, callId: 'z' })
    await b.runtime.dispose()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('buries selection with the Session scope', async () => {
    /**
     * 常量说明：b 用于处理 b 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const b = await createBench()
    await b.runtime.sessions.add({ id: 's1' })
    /**
     * 常量说明：doomed 用于处理 doomed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const doomed = storeFor(b, 'conversation.view', sid('s1'))
    doomed.actions.select({ turnSeq: 1 })

    await b.runtime.sessions.remove('s1')

    await b.runtime.sessions.add({ id: 's1' })
    /**
     * 常量说明：reborn 用于处理 reborn 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const reborn = storeFor(b, 'conversation.view', sid('s1'))
    expect(reborn).not.toBe(doomed)
    expect(reborn.store.getSnapshot()).toEqual({ selection: null, turnProcesses: [] })
    await b.runtime.dispose()
  })
})
