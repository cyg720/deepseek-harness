/**
 * 文件职责：验证 client/ui-trajectory 中 event projection client spec 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { describe, expect, it } from 'vitest'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import {
  contextForm, contextProvenance, displayFailure, emptyAssistantBlock, isTokenDelta,
  toAssistantBlock, toAssistantBlocks,
} from '../src/client/trajectory-event-projection.ts'

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('Trajectory event projection', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('projects known, unknown, and unreadable context sources', () => {
    expect(contextProvenance({ kind: 'session-reference', references: [{ label: 'A' }, { label: 'A' }] }))
      .toEqual({ role: 'recall', label: 'A' })
    expect(contextProvenance({ kind: 'session-reference', references: [] }))
      .toEqual({ role: 'recall', label: 'session-reference' })
    expect(contextProvenance({ kind: 'agent-instructions', changes: [{ path: 'AGENTS.md' }, null] }))
      .toEqual({ role: 'inject', label: 'AGENTS.md' })
    expect(contextProvenance({ kind: 'agent-instructions', changes: 'bad' }).label)
      .toBe('agent-instructions')
    expect(contextProvenance({ kind: 'plugin', plugin: 'p' }).label).toBe('p')
    expect(contextProvenance({ kind: 'plugin', plugin: 1 }).label).toBe('plugin')
    expect(contextProvenance({ kind: 'skill-invocation', name: 's' }).label).toBe('s')
    expect(contextProvenance({ kind: 'future' }).label).toBe('future')
    expect(contextProvenance(null)).toEqual({ role: 'inject', label: null })
    expect(contextProvenance([])).toEqual({ role: 'inject', label: null })
    expect(contextProvenance({ kind: '' })).toEqual({ role: 'inject', label: null })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('accepts only forms supported by the target', () => {
    /**
     * 变量说明：form 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const form of ['instructions', 'catalog', 'snapshot', 'notice', 'relay', 'recall']) {
      expect(contextForm({ form })).toBe(form)
    }
    expect(contextForm({ form: 'future' })).toBeNull()
    expect(contextForm({ form: 1 })).toBeNull()
    expect(contextForm(null)).toBeNull()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('projects finalized and empty Assistant blocks', () => {
    /**
     * 常量说明：content 用于处理 content 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const content = [
      { type: 'text', text: 'a' },
      { type: 'reasoning', text: 'b' },
      { type: 'image', attachment: { attachmentId: 'x' } },
      { type: 'tool-call', id: 'c', name: 'n', arguments: '{}' },
      { type: 'future' },
    ] as unknown as ContentBlock[]
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：block（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(block)，并按返回类型处理结果。
     */
    expect(toAssistantBlocks(content).map(block => block.kind))
      .toEqual(['text', 'reasoning', 'image', 'tool-call', 'other'])
    expect(toAssistantBlock(content[0]!)).toEqual({ kind: 'text', text: 'a' })
    expect(['text', 'reasoning', 'tool-call', 'future'].map(emptyAssistantBlock))
      .toEqual([
        { kind: 'text', text: '' },
        { kind: 'reasoning', text: '' },
        { kind: 'tool-call', callId: '', name: '', argsRaw: '' },
        { kind: 'other', block: null },
      ])
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('redacts auth failures and presents other durable values', () => {
    expect(displayFailure({ code: 'AUTH', message: 'secret' })).toEqual({ code: 'AUTH', message: '' })
    expect(displayFailure({ message: 'offline' })).toEqual({ message: 'offline' })
    expect(displayFailure({ code: 'UNKNOWN' })).toEqual({ code: 'UNKNOWN', message: '{"code":"UNKNOWN"}' })
    expect(displayFailure(undefined)).toEqual({ message: 'undefined' })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('recognizes only non-empty token deltas', () => {
    expect(isTokenDelta({ type: 'text-delta', index: 0, text: 'x' } as never)).toBe(true)
    expect(isTokenDelta({ type: 'reasoning-delta', index: 0, text: '' } as never)).toBe(false)
    expect(isTokenDelta({ type: 'tool-call-delta', index: 0, id: 'c', argumentsDelta: '}' } as never)).toBe(true)
    expect(isTokenDelta({ type: 'tool-call-delta', index: 0, id: 'c', argumentsDelta: '' } as never)).toBe(false)
    expect(isTokenDelta({ type: 'finish', reason: 'stop' } as never)).toBe(false)
  })
})
