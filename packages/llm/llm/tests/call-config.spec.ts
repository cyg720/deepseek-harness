/**
 * call-config unit tests: field-wise LlmCallConfig equality (the real-change
 * detector behind logged changed headers) and the deepFreeze ownership helper
 * the loop applies to every built request.
 */
/**
 * 文件职责：验证 call-config.spec.ts 覆盖的 LLM 配置、调用与事件处理行为。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件上下文和可控测试替身验证运行时协作。
 * 产品维度：保障模型接入在配置变化、认证、重试与异常场景下仍能给 Agent 稳定反馈。
 * 逻辑维度：准备上下文与测试数据，触发被测流程，再核对请求、事件、结果和清理行为。
 * 关键边界：测试替身必须保持确定性；敏感凭据不可写入日志；异步资源必须在用例结束时释放。
 * 新手阅读建议：先看测试数据和辅助函数，再按 describe/it 场景阅读，最后对照被测插件实现。
 */

import { describe, expect, it } from 'vitest'
import { callConfigEquals, deepFreeze, isAgentLoopRequest, markAgentLoopRequest } from '../src/call-config.ts'
import { ReasoningEffortId } from '../src/brand.ts'
import type { GenerateOptions } from '../src/types.ts'

describe('callConfigEquals', () => {
  it('compares every field, including the stop list element-wise', () => {
    /** 中文说明：变量 base 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const base = { provider: 'p', model: 'm' }
    expect(callConfigEquals(base, base)).toBe(true)
    expect(callConfigEquals(base, { provider: 'x', model: 'm' })).toBe(false)
    expect(callConfigEquals(base, { provider: 'p', model: 'x' })).toBe(false)
    expect(callConfigEquals({ ...base, reasoningEffort: ReasoningEffortId('high') }, base)).toBe(false)
    expect(callConfigEquals(
      { ...base, reasoningEffort: ReasoningEffortId('high') },
      { ...base, reasoningEffort: ReasoningEffortId('high') },
    )).toBe(true)
    expect(callConfigEquals({ ...base, temperature: 0.5 }, base)).toBe(false)
    expect(callConfigEquals({ ...base, maxTokens: 1 }, { ...base, maxTokens: 2 })).toBe(false)
    expect(callConfigEquals({ ...base, stop: ['a'] }, base)).toBe(false)
    expect(callConfigEquals({ ...base, stop: ['a'] }, { ...base, stop: ['a', 'b'] })).toBe(false)
    expect(callConfigEquals({ ...base, stop: ['a'] }, { ...base, stop: ['b'] })).toBe(false)
    expect(callConfigEquals({ ...base, stop: ['a', 'b'] }, { ...base, stop: ['a', 'b'] })).toBe(true)
  })
})

describe('deepFreeze', () => {
  it('freezes nested structure in place and returns the same reference', () => {
    /** 中文说明：变量 value 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const value = { a: { b: [1, { c: 'x' }] } }
    /** 中文说明：变量 frozen 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const frozen = deepFreeze(value)
    expect(frozen).toBe(value)
    expect(Object.isFrozen(value)).toBe(true)
    expect(Object.isFrozen(value.a)).toBe(true)
    expect(Object.isFrozen(value.a.b)).toBe(true)
    expect(Object.isFrozen(value.a.b[1])).toBe(true)
    // ESM runs in strict mode: mutation throws rather than silently failing.
    expect(() => { (value.a.b[1] as { c: string }).c = 'y' }).toThrow(TypeError)
  })

  it('never freezes an AbortSignal: the live cancellation channel keeps working', () => {
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    /** 中文说明：变量 request 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const request = deepFreeze({ model: 'm', signal: controller.signal })
    expect(Object.isFrozen(request)).toBe(true)
    expect(Object.isFrozen(controller.signal)).toBe(false)
    /** 中文说明：变量 fired 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let fired = false
    controller.signal.addEventListener('abort', () => { fired = true }, { once: true })
    controller.abort('stop')
    expect(fired).toBe(true)
    expect(controller.signal.aborted).toBe(true)
  })

  it('passes primitives through and terminates on cycles', () => {
    expect(deepFreeze(42)).toBe(42)
    expect(deepFreeze(null)).toBeNull()
    /** 中文说明：变量 cyclic 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cyclic = { self: undefined as unknown }
    cyclic.self = cyclic
    deepFreeze(cyclic)
    expect(Object.isFrozen(cyclic)).toBe(true)
  })

  it('freezes nesting deeper than the JavaScript call stack', () => {
    /** 中文说明：变量 depth 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const depth = 5_000
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root: unknown[] = []
    /** 中文说明：变量 cursor 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let cursor = root
    /** 中文说明：该循环依次处理场景数据；循环变量仅在当前循环中有效。 */
    for (let index = 0; index < depth; index++) {
      /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const child: unknown[] = []
      cursor.push(child)
      cursor = child
    }

    deepFreeze(root)

    cursor = root
    /** 中文说明：该循环依次处理场景数据；循环变量仅在当前循环中有效。 */
    for (let index = 0; index < depth; index++) {
      expect(Object.isFrozen(cursor)).toBe(true)
      cursor = cursor[0] as unknown[]
    }
    expect(Object.isFrozen(cursor)).toBe(true)
  })
})

describe('agent-loop request identity', () => {
  it('marks only the exact request object and preserves its identity', () => {
    /** 中文说明：变量 request 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const request: GenerateOptions = {
      provider: 'mock',
      model: 'model',
      messages: [],
    }
    /** 中文说明：变量 copy 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const copy = { ...request }

    expect(isAgentLoopRequest(request)).toBe(false)
    expect(markAgentLoopRequest(request)).toBe(request)
    expect(isAgentLoopRequest(request)).toBe(true)
    expect(isAgentLoopRequest(copy)).toBe(false)
  })
})
