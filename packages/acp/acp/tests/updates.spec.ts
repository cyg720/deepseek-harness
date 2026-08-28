/**
 * 文件职责：验证 acp/acp 中 updates spec 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { ToolCallId, MessageId } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { assistantUpdates, toolCallUpdate, toolResultUpdate } from '../src/updates.ts'

/** Minimal committed assistant event for pure update projection tests.
 * @remarks 中文说明：功能说明：处理 assistantEvent 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：content（SessionEvent<'assistant/message'>['data']['message']['conte
 * …）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：usage（SessionEvent<'assistant/mess
 * age'>['data']['usage']）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：SessionEvent<'assistant/message'>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 assistantEvent(content, usage)，并按返回类型处理结果。 */
function assistantEvent(
  content: SessionEvent<'assistant/message'>['data']['message']['content'],
  usage?: SessionEvent<'assistant/message'>['data']['usage'],
): SessionEvent<'assistant/message'> {
  return {
    type: 'assistant/message',
    seq: 0,
    time: 0,
    data: {
      turn: 1,
      step: 1,
      message: {
        id: MessageId('message-1'),
        role: 'assistant',
        source: { kind: 'model', provider: 'mock', model: 'mock' },
        content,
      },
      ...usage === undefined ? {} : { usage },
    },
  }
}

describe('standard ACP update projection', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
    it('omits empty reasoning, unsupported assistant blocks, and absent usage', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const ctx = { get: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => undefined } as unknown as Context
        /**
     * 常量说明：session 用于处理 session 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const session = { requestContext: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => undefined } as unknown as Session
        /**
     * 常量说明：event 用于处理 event 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const event = assistantEvent([
          { type: 'reasoning', text: '' },
          { type: 'tool-call', id: ToolCallId('call-hidden'), name: 'hidden', arguments: '{}' },
        ])

        await expect(assistantUpdates(ctx, session, event)).resolves.toEqual([])
      })

    it('requires both measured usage and context capacity', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：meter 用于处理 meter 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const meter = { measure: vi.fn(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => ({ totalTokens: 7 })) }
        /**
     * 常量说明：withMeter 用于处理 withMeter 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const withMeter = { get: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：name（string）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 典型用法：在完成前置校验后调用 匿名回调(name)，并按返回类型处理结果。
 */ (name: string) => name === 'tokenMeter' ? meter : undefined } as unknown as Context
        /**
     * 常量说明：withoutMeter 用于处理 withoutMeter 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const withoutMeter = { get: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => undefined } as unknown as Context
        /**
     * 常量说明：withCapacity 用于处理 withCapacity 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const withCapacity = { requestContext: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => ({ contextWindow: 100 }) } as unknown as Session
        /**
     * 常量说明：withoutCapacity 用于处理 withoutCapacity 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const withoutCapacity = { requestContext: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => undefined } as unknown as Session
        /**
     * 常量说明：event 用于处理 event 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const event = assistantEvent([{ type: 'text', text: 'done' }], { inputTokens: 1, outputTokens: 1 })

        expect((await assistantUpdates(withMeter, withoutCapacity, event)).map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：update（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(update)，并按返回类型处理结果。
 */ update => update.sessionUpdate))
          .toEqual(['agent_message_chunk'])
        expect((await assistantUpdates(withoutMeter, withCapacity, event)).map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：update（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(update)，并按返回类型处理结果。
 */ update => update.sessionUpdate))
          .toEqual(['agent_message_chunk'])
        expect(meter.measure).not.toHaveBeenCalled()
      })

    it('preserves malformed tool input and projects a failed result without hidden content', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：call 用于处理 call 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const call = toolCallUpdate({
          type: 'tool/call',
          seq: 0,
          time: 0,
          data: { turn: 1, step: 1, callId: ToolCallId('call-bad'), name: 'broken', arguments: '{' },
        })
        /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const result = await toolResultUpdate({ get: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => undefined } as unknown as Context, {
          type: 'tool/result',
          seq: 0,
          time: 0,
          data: {
            turn: 1,
            step: 1,
            message: {
              id: MessageId('tool-message'),
              role: 'user',
              source: { kind: 'tool', callId: ToolCallId('call-bad') },
              content: [{
                type: 'tool-result',
                toolCallId: ToolCallId('call-bad'),
                isError: true,
                content: [{ type: 'reasoning', text: 'hidden' }],
              }],
            },
          },
        })

        expect(call).toMatchObject({ rawInput: '{' })
        expect(result).toEqual({
          sessionUpdate: 'tool_call_update',
          toolCallId: 'call-bad',
          status: 'failed',
          content: [],
        })
      })
  })
