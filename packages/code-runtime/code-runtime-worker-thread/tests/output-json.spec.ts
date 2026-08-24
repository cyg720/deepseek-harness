/**
 * 文件职责：验证代码运行时的 output-json.spec.ts 行为。
 * 技术维度：Vitest、协议夹具、Worker/子进程或组件替身。
 * 产品维度：防止代码运行时协议与生命周期回归。
 * 逻辑维度：构造输入，运行被测入口并断言输出与清理。
 * 关键边界：跨进程数据必须校验；Worker 和异步任务必须结束。
 * 新手阅读建议：先读协议夹具，再按成功、失败和清理场景阅读。
 */
import { describe, expect, it, vi } from 'vitest'
import type { CodeJsonValue } from '@deepseek-ai/dsh-code-runtime'
import { jsonStringBytesUpTo, jsonValueBytesUpTo, truncateJsonStringBytes } from '../src/output-json.ts'

describe('truncateJsonStringBytes', () => {
  it('returns a fitting string whole and rejects budgets without JSON quotes', () => {
    expect(truncateJsonStringBytes('fits', 6)).toBe('fits')
    expect(truncateJsonStringBytes('x', 1)).toBe('')
    expect(jsonStringBytesUpTo('fits', 6)).toBe(6)
    expect(jsonStringBytesUpTo('fits', 5)).toBeUndefined()
  })

  it('accounts every JSON escape and cuts only between complete code points', () => {
    /** 中文说明：测试局部值 prefix，由紧邻初始化决定。 */
    const prefix = '"\\\b\t\n\f\r\u0000😀\ud800€a'
    /** 中文说明：测试局部值 text，由紧邻初始化决定。 */
    const text = `${prefix}z`
    /** 中文说明：测试局部值 budget，由紧邻初始化决定。 */
    const budget = Buffer.byteLength(JSON.stringify(prefix), 'utf8')

    expect(truncateJsonStringBytes(text, budget)).toBe(prefix)
    expect(Buffer.byteLength(JSON.stringify(truncateJsonStringBytes(text, budget)), 'utf8')).toBe(budget)
  })

  it('bounds hostile strings without materializing their complete escaped form', () => {
    /** 中文说明：测试局部值 stringify，由紧邻初始化决定。 */
    const stringify = vi.spyOn(JSON, 'stringify').mockImplementation(() => { throw new Error('must not stringify') })
    try {
      expect(jsonStringBytesUpTo('"'.repeat(10_000), 32)).toBeUndefined()
      expect(truncateJsonStringBytes('"'.repeat(10_000), 32)).toBe('"'.repeat(15))
    } finally {
      stringify.mockRestore()
    }
  })
})

describe('jsonValueBytesUpTo', () => {
  it('matches JSON serialization for every lossless value branch and stops at the cap', () => {
    /** 中文说明：测试局部值 value，由紧邻初始化决定。 */
    const value = {
      empty: {},
      nil: null,
      yes: true,
      no: false,
      number: 1.5,
      text: '"\n😀',
      array: [1, 'x'],
    }
    /** 中文说明：测试局部值 bytes，由紧邻初始化决定。 */
    const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8')

    expect(jsonValueBytesUpTo(value, bytes)).toBe(bytes)
    expect(jsonValueBytesUpTo(value, bytes - 1)).toBeUndefined()
    expect(jsonValueBytesUpTo({}, 1)).toBeUndefined()
    expect(jsonValueBytesUpTo([], 1)).toBeUndefined()
    expect(jsonValueBytesUpTo([], 2)).toBe(2)
    expect(jsonValueBytesUpTo(null, 3)).toBeUndefined()
    expect(jsonValueBytesUpTo(10, 1)).toBeUndefined()
    expect(jsonValueBytesUpTo(false, 4)).toBeUndefined()
    expect(jsonValueBytesUpTo(new Array<never>(1), 10)).toBeUndefined()
    expect(jsonValueBytesUpTo([null], 5)).toBeUndefined()
    expect(jsonValueBytesUpTo([0, 0], 3)).toBeUndefined()
    expect(jsonValueBytesUpTo({ a: null, b: null }, 10)).toBeUndefined()
    expect(jsonValueBytesUpTo({ long: null }, 2)).toBeUndefined()
    expect(jsonValueBytesUpTo({ '': null }, 4)).toBeUndefined()
    expect(jsonValueBytesUpTo({ a: null }, 9)).toBeUndefined()
    expect(jsonValueBytesUpTo({ a: undefined } as unknown as CodeJsonValue, 100)).toBeUndefined()
  })

  it('meters deeply nested arrays without recursive stack growth', () => {
    /** 中文说明：测试局部值 value，由紧邻初始化决定。 */
    let value: CodeJsonValue = null
    /** 中文说明：测试局部值 depth，由紧邻初始化决定。 */
    for (let depth = 0; depth < 5_000; depth++) value = [value]

    expect(jsonValueBytesUpTo(value, 10_004)).toBe(10_004)
    expect(jsonValueBytesUpTo(value, 10_003)).toBeUndefined()
  })

  it('uses module-captured intrinsics after model-visible globals are mutated', () => {
    /** 中文说明：测试局部值 value，由紧邻初始化决定。 */
    const value: CodeJsonValue = { payload: ['€', 42] }
    /** 中文说明：测试局部值 bytes，由紧邻初始化决定。 */
    const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8')
    /** 中文说明：测试局部值 arrayIsArrayDescriptor，由紧邻初始化决定。 */
    const arrayIsArrayDescriptor = Object.getOwnPropertyDescriptor(Array, 'isArray')!
    /** 中文说明：测试局部值 arrayPopDescriptor，由紧邻初始化决定。 */
    const arrayPopDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, 'pop')!
    /** 中文说明：测试局部值 arrayPushDescriptor，由紧邻初始化决定。 */
    const arrayPushDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, 'push')!
    /** 中文说明：测试局部值 byteLengthDescriptor，由紧邻初始化决定。 */
    const byteLengthDescriptor = Object.getOwnPropertyDescriptor(Buffer, 'byteLength')!
    /** 中文说明：测试局部值 objectKeysDescriptor，由紧邻初始化决定。 */
    const objectKeysDescriptor = Object.getOwnPropertyDescriptor(Object, 'keys')!
    /** 中文说明：测试局部值 charCodeAtDescriptor，由紧邻初始化决定。 */
    const charCodeAtDescriptor = Object.getOwnPropertyDescriptor(String.prototype, 'charCodeAt')!
    /** 中文说明：测试局部值 codePointAtDescriptor，由紧邻初始化决定。 */
    const codePointAtDescriptor = Object.getOwnPropertyDescriptor(String.prototype, 'codePointAt')!
    /** 中文说明：测试局部值 sliceDescriptor，由紧邻初始化决定。 */
    const sliceDescriptor = Object.getOwnPropertyDescriptor(String.prototype, 'slice')!
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    let measured: number | undefined
    /** 中文说明：测试局部值 prefix，由紧邻初始化决定。 */
    let prefix = ''
    try {
      Array.isArray = (_value: unknown): _value is never[] => false
      Array.prototype.pop = () => { throw new Error('mutated pop') }
      Array.prototype.push = () => { throw new Error('mutated push') }
      Buffer.byteLength = () => 0
      Object.keys = () => []
      String.prototype.charCodeAt = () => { throw new Error('mutated charCodeAt') }
      String.prototype.codePointAt = () => { throw new Error('mutated codePointAt') }
      String.prototype.slice = () => { throw new Error('mutated slice') }
      measured = jsonValueBytesUpTo(value, bytes)
      prefix = truncateJsonStringBytes('€x', 5)
    } finally {
      Object.defineProperty(Array, 'isArray', arrayIsArrayDescriptor)
      Object.defineProperty(Array.prototype, 'pop', arrayPopDescriptor)
      Object.defineProperty(Array.prototype, 'push', arrayPushDescriptor)
      Object.defineProperty(Buffer, 'byteLength', byteLengthDescriptor)
      Object.defineProperty(Object, 'keys', objectKeysDescriptor)
      Object.defineProperty(String.prototype, 'charCodeAt', charCodeAtDescriptor)
      Object.defineProperty(String.prototype, 'codePointAt', codePointAtDescriptor)
      Object.defineProperty(String.prototype, 'slice', sliceDescriptor)
    }
    expect(measured).toBe(bytes)
    expect(prefix).toBe('€')
  })
})
