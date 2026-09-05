/**
 * 文件职责：验证 client/ui-conversation 中 request inspection client spec
 * 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { describe, expect, it } from 'vitest'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { inspectRequestPrompt } from '../src/client/contract/request-inspection.ts'

/**
 * 常量说明：CONFIG 用于处理 CONFIG 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const CONFIG = { provider: 'test', model: 'test' }

/**
 * 功能说明：处理 header 相关流程；使用场景由所在模块及调用位置决定。
 * @param seq （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param reason （SessionEvent<'request/header'>['data']['reason']）：提供本次调用所
 * 需的数据；必须满足声明的类型及调用时序要求。
 * @param value （SessionEvent<'request/header'>['data']['header']）：提供本次调用所需
 * 的数据；必须满足声明的类型及调用时序要求。
 * @returns SessionEvent<'request/header'>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 header(seq, reason, value)，并按返回类型处理结果。
 */
function header(
  seq: SessionSeq,
  reason: SessionEvent<'request/header'>['data']['reason'],
  value: SessionEvent<'request/header'>['data']['header'],
): SessionEvent<'request/header'> {
  return {
    type: 'request/header',
    seq,
    time: 1_700_000_000_000 + seq,
    data: { reason, header: value },
  }
}

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('inspectRequestPrompt', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('classifies the first complete header as the initial prompt', () => {
    expect(inspectRequestPrompt(undefined, header(SessionSeq(1), 'initial', {
      config: CONFIG,
      system: '# System\n\nFollow instructions.',
      tools: [{ name: 'read', description: 'Read a file', parameters: { type: 'object' } }],
    }))).toMatchObject({
      prompt: {
        config: CONFIG,
        system: '# System\n\nFollow instructions.',
        tools: [{ name: 'read' }],
      },
      change: { seq: 1, time: 1_700_000_000_001, kind: 'initial' },
    })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('suppresses a resume header when the earlier prompt is outside the loaded window', () => {
    expect(inspectRequestPrompt(undefined, header(SessionSeq(2), 'resume', {
      config: CONFIG,
      system: 'same prompt',
    }))).toEqual({
      prompt: { config: CONFIG, system: 'same prompt', tools: [] },
    })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('classifies system, tool, and combined changes against the previous prompt', () => {
    const initial = inspectRequestPrompt(undefined, header(SessionSeq(1), 'initial', {
      config: CONFIG,
      system: 'first',
      tools: [{ name: 'read', description: 'Read', parameters: { type: 'object' } }],
    })).prompt
    const system = inspectRequestPrompt(initial, header(SessionSeq(2), 'change', {
      config: CONFIG,
      system: 'second',
      tools: [...initial.tools],
    }))
    const tools = inspectRequestPrompt(system.prompt, header(SessionSeq(3), 'change', {
      config: CONFIG,
      system: 'second',
      tools: [{ name: 'write', description: 'Write', parameters: { type: 'object' } }],
    }))
    const combined = inspectRequestPrompt(tools.prompt, header(SessionSeq(4), 'change', {
      config: CONFIG,
      system: 'third',
      tools: [],
    }))

    expect(system.change?.kind).toBe('system')
    expect(tools.change?.kind).toBe('tools')
    expect(combined.change?.kind).toBe('system-and-tools')
    expect(combined.change?.previous).toBe(tools.prompt)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('omits a change when the prompt and tools are unchanged', () => {
    const previous = inspectRequestPrompt(undefined, header(SessionSeq(1), 'initial', {
      config: CONFIG,
      system: 'same',
    })).prompt

    expect(inspectRequestPrompt(previous, header(SessionSeq(2), 'resume', {
      config: { ...CONFIG, maxTokens: 1_024 },
      system: 'same',
    }))).toEqual({
      prompt: { config: { ...CONFIG, maxTokens: 1_024 }, system: 'same', tools: [] },
    })
  })
})
