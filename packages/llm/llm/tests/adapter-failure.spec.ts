/**
 * 文件职责：验证 adapter-failure.spec.ts 覆盖的 LLM 配置、调用与事件处理行为。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件上下文和可控测试替身验证运行时协作。
 * 产品维度：保障模型接入在配置变化、认证、重试与异常场景下仍能给 Agent 稳定反馈。
 * 逻辑维度：准备上下文与测试数据，触发被测流程，再核对请求、事件、结果和清理行为。
 * 关键边界：测试替身必须保持确定性；敏感凭据不可写入日志；异步资源必须在用例结束时释放。
 * 新手阅读建议：先看测试数据和辅助函数，再按 describe/it 场景阅读，最后对照被测插件实现。
 */
import { describe, expect, it } from 'vitest'
import { normalizeLlmFailure } from '../src/adapter-failure.ts'

describe('adapter failure normalization', () => {
  it('contains hostile non-Error coercion', () => {
    /** 中文说明：函数值 thrown 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const thrown = { [Symbol.toPrimitive]: () => { throw new Error('coercion failed') } }
    expect(normalizeLlmFailure(thrown)).toEqual({ message: 'LLM adapter failed', code: 'UNKNOWN' })
  })

  it('normalizes empty primitive throws and data descriptors without values', () => {
    expect(normalizeLlmFailure('')).toEqual({ message: 'LLM adapter failed', code: 'UNKNOWN' })
    expect(normalizeLlmFailure(null)).toEqual({ message: 'null', code: 'UNKNOWN' })

    /** 中文说明：变量 error 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const error = new Error('provider failed')
    Object.defineProperty(error, 'failure', { get: () => ({ message: 'ignored', code: 'IGNORED' }) })
    Object.defineProperty(error, 'code', { get: () => 'IGNORED' })
    expect(normalizeLlmFailure(error)).toEqual({ message: 'provider failed', code: 'UNKNOWN' })

    /** 中文说明：变量 accessorCode 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const accessorCode = Object.assign(new Error('provider failed'), {
      failure: { message: 'provider failed', code: 'FOREIGN' },
    })
    Object.defineProperty(accessorCode, 'code', { get: () => 'FOREIGN' })
    expect(normalizeLlmFailure(accessorCode)).toEqual({ message: 'provider failed', code: 'UNKNOWN' })

    /** 中文说明：变量 primitiveFailure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const primitiveFailure = Object.assign(new Error('provider failed'), {
      failure: null,
      code: 'FOREIGN',
    })
    expect(normalizeLlmFailure(primitiveFailure)).toEqual({ message: 'provider failed', code: 'UNKNOWN' })
  })

  it('contains hostile Error property reflection', () => {
    /** 中文说明：变量 withFailure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const withFailure = new Error('provider failed') as Error & { failure: unknown; code: string }
    withFailure.failure = { message: 'provider failed', code: 'FOREIGN' }
    withFailure.code = 'FOREIGN'
    /** 中文说明：变量 hostileCode 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const hostileCode = new Proxy(withFailure, {
      getOwnPropertyDescriptor(target, property) {
        if (property === 'code') throw new Error('code descriptor failed')
        return Reflect.getOwnPropertyDescriptor(target, property)
      },
    })
    expect(normalizeLlmFailure(hostileCode)).toEqual({ message: 'provider failed', code: 'UNKNOWN' })

    /** 中文说明：变量 hostileFailure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const hostileFailure = new Proxy(new Error('provider failed'), {
      getOwnPropertyDescriptor() { throw new Error('failure descriptor failed') },
    })
    expect(normalizeLlmFailure(hostileFailure)).toEqual({ message: 'provider failed', code: 'UNKNOWN' })
  })

  it('rejects malformed or accessor-backed failure snapshots', () => {
    /** 中文说明：变量 malformed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const malformed = new Error('provider failed') as Error & { failure: unknown; code: string }
    malformed.failure = { message: 'provider failed', code: 'FOREIGN', requestId: '' }
    malformed.code = 'FOREIGN'
    expect(normalizeLlmFailure(malformed)).toEqual({ message: 'provider failed', code: 'UNKNOWN' })

    /** 中文说明：变量 accessorBacked 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const accessorBacked = new Error('provider failed') as Error & { failure: unknown }
    accessorBacked.failure = Object.defineProperty({}, 'message', {
      get() { throw new Error('failure getter failed') },
    })
    expect(normalizeLlmFailure(accessorBacked)).toEqual({ message: 'provider failed', code: 'UNKNOWN' })
  })

  it('falls back when an Error message accessor throws', () => {
    /** 中文说明：变量 error 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const error = new Error('provider failed')
    Object.defineProperty(error, 'message', { get() { throw new Error('message getter failed') } })
    expect(normalizeLlmFailure(error)).toEqual({ message: 'LLM adapter failed', code: 'UNKNOWN' })
  })
})
