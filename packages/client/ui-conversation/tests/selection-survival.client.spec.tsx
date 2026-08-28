// @vitest-environment jsdom
/** Exercises Conversation persistence through the real SlotRegistry store axis.
 * @remarks 文件说明：文件职责：验证 client/ui-conversation 中 selection survival client
 * spec 相关行为与失败场景。；技术维度：主要使用TypeScript、React 与项目的插件化客户端组件体系，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */
import { beforeEach, describe, expect, it } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { createConversationStore } from '../src/client/stores.ts'

/**
 * 常量说明：sid 用于处理 sid 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 sid 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns SessionId；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 sid(value)，并按返回类型处理结果。
 */
const sid = (value: string): SessionId => value as SessionId

type ConversationInstance = ReturnType<ReturnType<typeof createConversationStore>['create']>

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
   * 常量说明：conversation 用于处理 conversation 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const conversation = createConversationStore()
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_props（PropsRenderSlots<'conversa
   * tion.session' | 'conversation.ses…）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由
   * TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用
   * 匿名回调(_props)，并按返回类型处理结果。
   */
  await runtime.root.declare({
    'conversation.session': { kind: 'single', scope: 'session' },
    'conversation.session.header': { kind: 'single', scope: 'session' },
  }, (_props: PropsRenderSlots<'conversation.session' | 'conversation.session.header'>) => null)
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  runtime.slots.register({ name: 'conversation.session', store: conversation }, () => null)
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  runtime.slots.register({ name: 'conversation.session.header', store: conversation }, () => null)
  runtime.renderRoot()
  return { runtime }
}

/**
 * 功能说明：处理 storeFor 相关流程；使用场景由所在模块及调用位置决定。
 * @param current （Awaited<ReturnType<typeof createBench>>）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @param slot （'conversation.session' | 'conversation.session.header'）：提供本
 * 次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param sessionId （SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns ConversationInstance；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 storeFor(current, slot, sessionId)，并按返回类型处理结果。
 */
function storeFor(
  current: Awaited<ReturnType<typeof createBench>>,
  slot: 'conversation.session' | 'conversation.session.header',
  sessionId: SessionId,
): ConversationInstance {
  return current.runtime.storeOf(slot, sessionId) as ConversationInstance
}

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
beforeEach(() => {
  localStorage.clear()
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('Conversation state survives on its store seat', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('shares one instance between the Session body and header', async () => {
    /**
     * 常量说明：b 用于处理 b 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const b = await createBench()
    await b.runtime.sessions.add({ id: 's1' })
    /**
     * 常量说明：body 用于处理 body 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const body = storeFor(b, 'conversation.session', sid('s1'))
    /**
     * 常量说明：header 用于处理 header 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const header = storeFor(b, 'conversation.session.header', sid('s1'))

    body.actions.setDraft('half-typed')
    header.actions.setView('trajectory')

    expect(header).toBe(body)
    expect(body.store.getSnapshot()).toMatchObject({ draft: 'half-typed', view: 'trajectory' })
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
    const one = storeFor(b, 'conversation.session', oneId)
    /**
     * 常量说明：two 用于处理 two 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const two = storeFor(b, 'conversation.session', sid('s2'))
    one.actions.setDraft('only one')
    two.actions.setDraft('only two')

    await b.runtime.sessions.updateSummary(oneId, { displayTitle: 'projected' })

    expect(storeFor(b, 'conversation.session', oneId)).toBe(one)
    expect(one.store.getSnapshot().draft).toBe('only one')
    expect(two.store.getSnapshot().draft).toBe('only two')
    await b.runtime.dispose()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('buries the instance and persisted draft with the Session scope', async () => {
    /**
     * 常量说明：b 用于处理 b 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const b = await createBench()
    await b.runtime.sessions.add({ id: 's1' })
    /**
     * 常量说明：doomed 用于处理 doomed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const doomed = storeFor(b, 'conversation.session', sid('s1'))
    doomed.actions.setDraft('to be buried')
    doomed.actions.setView('chat')
    expect(localStorage.getItem('dsh.conversation.s1')).not.toBeNull()

    await b.runtime.sessions.remove('s1')

    expect(localStorage.getItem('dsh.conversation.s1')).toBeNull()
    await b.runtime.sessions.add({ id: 's1' })
    /**
     * 常量说明：reborn 用于处理 reborn 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const reborn = storeFor(b, 'conversation.session', sid('s1'))
    expect(reborn).not.toBe(doomed)
    expect(reborn.store.getSnapshot()).toEqual({ draft: '', view: null, viewRequest: null })
    await b.runtime.dispose()
  })
})
