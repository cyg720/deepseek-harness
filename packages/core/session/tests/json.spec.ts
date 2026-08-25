/**
 * 文件职责：验证Session 持久状态的 json.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis、Vitest、会话事件、JSON 模式和服务作用域。
 * 产品维度：保证Session 持久状态在配置、错误、恢复和生命周期场景中可靠。
 * 逻辑维度：构造输入并驱动服务，再断言输出、日志和清理。
 * 关键边界：持久与凭据数据属于不可信边界；工具和提示词必须保持模型可见内容可重建。
 * 新手阅读建议：先读类型和夹具，再按正常、非法输入、作用域和清理场景阅读。
 */
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { isJsonValue, snapshotJsonValue, type JsonValue } from '@deepseek-ai/dsh-session'

/** 中文说明：函数 objectWithForgedIntrinsicPrototype 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function objectWithForgedIntrinsicPrototype(revoked = false): Record<string, unknown> {
  /** 中文说明：测试局部值 prototype，由紧邻初始化决定。 */
  const prototype = Object.create(null) as Record<string, unknown>
  /** 中文说明：测试局部值 ForgedObject，由紧邻初始化决定。 */
  const ForgedObject = function ForgedObject(): void {}
  Object.defineProperty(ForgedObject, 'name', { value: 'Object' })
  ForgedObject.prototype = prototype
  /** 中文说明：测试局部值 constructor，由紧邻初始化决定。 */
  const constructor = revoked ? Proxy.revocable(ForgedObject, {}) : undefined
  if (constructor !== undefined) constructor.revoke()
  Object.defineProperty(prototype, 'constructor', { value: constructor?.proxy ?? ForgedObject })
  return Object.assign(Object.create(prototype) as Record<string, unknown>, { value: 1 })
}

describe('snapshotJsonValue', () => {
  it('copies the complete JSON scalar vocabulary and rejects unsupported scalars', () => {
    /** 中文说明：测试局部值 unsupportedFunction，由紧邻初始化决定。 */
    const unsupportedFunction = (): void => {}

    expect(snapshotJsonValue(null)).toBeNull()
    expect(snapshotJsonValue(true)).toBe(true)
    expect(snapshotJsonValue('text')).toBe('text')
    expect(snapshotJsonValue(1.25)).toBe(1.25)
    expect(snapshotJsonValue(-0)).toBeUndefined()
    expect(isJsonValue(-0)).toBe(false)
    expect(snapshotJsonValue(Number.NaN)).toBeUndefined()
    expect(snapshotJsonValue(Number.POSITIVE_INFINITY)).toBeUndefined()
    expect(snapshotJsonValue(1n)).toBeUndefined()
    expect(snapshotJsonValue(unsupportedFunction)).toBeUndefined()
    expect(snapshotJsonValue(Symbol('value'))).toBeUndefined()
    /** 中文说明：测试局部值 unsupportedUndefined，由紧邻初始化决定。 */
    const unsupportedUndefined: unknown = undefined
    expect(snapshotJsonValue(unsupportedUndefined)).toBeUndefined()
  })

  it('recursively detaches dense arrays and plain or null-prototype objects', () => {
    /** 中文说明：测试局部值 shared，由紧邻初始化决定。 */
    const shared = { value: 1 }
    /** 中文说明：测试局部值 nullPrototype，由紧邻初始化决定。 */
    const nullPrototype = Object.assign(Object.create(null) as Record<string, unknown>, { shared })
    /** 中文说明：测试局部值 source，由紧邻初始化决定。 */
    const source = { list: [nullPrototype, shared], alias: shared }

    /** 中文说明：测试局部值 snapshot，由紧邻初始化决定。 */
    const snapshot = snapshotJsonValue(source)!
    shared.value = 2

    expect(snapshot).toEqual({ list: [{ shared: { value: 1 } }, { value: 1 }], alias: { value: 1 } })
    expect(snapshot).not.toBe(source)
    expect(snapshot.list).not.toBe(source.list)
    expect(snapshot.alias).not.toBe(shared)
    expect(snapshot.list[0]).not.toBe(nullPrototype)
    expect(Object.getPrototypeOf(snapshot.list[0])).toBe(Object.prototype)
  })

  it('accepts intrinsic plain containers from another JavaScript realm', () => {
    /** 中文说明：测试局部值 foreign，由紧邻初始化决定。 */
    const foreign = runInNewContext('({ object: { nested: [1] }, array: [2, { ok: true }] })') as {
      object: { nested: number[] }
      array: JsonValue[]
    }

    expect(isJsonValue(foreign.object)).toBe(true)
    expect(isJsonValue(foreign.array)).toBe(true)
    /** 中文说明：测试局部值 objectSnapshot，由紧邻初始化决定。 */
    const objectSnapshot = snapshotJsonValue(foreign.object)!
    /** 中文说明：测试局部值 arraySnapshot，由紧邻初始化决定。 */
    const arraySnapshot = snapshotJsonValue(foreign.array)!
    expect(objectSnapshot).toEqual({ nested: [1] })
    expect(arraySnapshot).toEqual([2, { ok: true }])
    expect(Object.getPrototypeOf(objectSnapshot)).toBe(Object.prototype)
    expect(Object.getPrototypeOf(arraySnapshot)).toBe(Array.prototype)
  })

  it('reads each object value and array slot once while materializing', () => {
    /** 中文说明：类型或类 Exotic 约束服务或测试数据职责。 */
    class Exotic {
      readonly accepted = false
    }
    /** 中文说明：测试局部值 objectReads，由紧邻初始化决定。 */
    let objectReads = 0
    /** 中文说明：测试局部值 arrayReads，由紧邻初始化决定。 */
    let arrayReads = 0
    /** 中文说明：测试局部值 nested，由紧邻初始化决定。 */
    const nested = Object.defineProperty({}, 'value', {
      enumerable: true,
      get: () => {
        objectReads += 1
        return objectReads === 1 ? { accepted: true } : new Exotic()
      },
    })
    /** 中文说明：测试局部值 array，由紧邻初始化决定。 */
    const array = new Array<unknown>(1)
    Object.defineProperty(array, 0, {
      enumerable: true,
      get: () => {
        arrayReads += 1
        return arrayReads === 1 ? nested : new Exotic()
      },
    })

    expect(snapshotJsonValue(array)).toEqual([{ value: { accepted: true } }])
    expect(objectReads).toBe(1)
    expect(arrayReads).toBe(1)
  })

  it('accepts deeply nested valid JSON without using the JavaScript call stack', () => {
    /** 中文说明：测试局部值 value，由紧邻初始化决定。 */
    let value: JsonValue = 'leaf'
    /** 中文说明：测试局部值 depth，由紧邻初始化决定。 */
    for (let depth = 0; depth < 5_000; depth++) value = [value]

    expect(isJsonValue(value)).toBe(true)
    /** 中文说明：测试局部值 cursor，由紧邻初始化决定。 */
    let cursor: JsonValue | undefined = snapshotJsonValue(value)
    /** 中文说明：测试局部值 depth，由紧邻初始化决定。 */
    for (let depth = 0; depth < 5_000; depth++) {
      expect(Array.isArray(cursor)).toBe(true)
      cursor = Array.isArray(cursor) ? cursor[0] : undefined
    }
    expect(cursor).toBe('leaf')
  })

  it('rejects exotic containers, sparse or decorated arrays, cycles, and invalid children', () => {
    /** 中文说明：类型或类 ExoticObject 约束服务或测试数据职责。 */
    class ExoticObject {
      readonly value = 1
    }
    /** 中文说明：类型或类 ExoticArray 约束服务或测试数据职责。 */
    class ExoticArray extends Array<number> {}
    /** 中文说明：测试局部值 sparse，由紧邻初始化决定。 */
    const sparse = new Array<number>(1)
    /** 中文说明：测试局部值 compensatedSparse，由紧邻初始化决定。 */
    const compensatedSparse = new Array<number>(1)
    Object.defineProperty(compensatedSparse, 'extra', { value: true })
    /** 中文说明：测试局部值 decorated，由紧邻初始化决定。 */
    const decorated = [1]
    Object.defineProperty(decorated, 'extra', { value: true })
    /** 中文说明：测试局部值 symbolDecorated，由紧邻初始化决定。 */
    const symbolDecorated = [1]
    Object.defineProperty(symbolDecorated, Symbol('extra'), { value: true })
    /** 中文说明：测试局部值 hiddenObject，由紧邻初始化决定。 */
    const hiddenObject = Object.defineProperty({}, 'hidden', { value: true })
    /** 中文说明：测试局部值 symbolObject，由紧邻初始化决定。 */
    const symbolObject = { [Symbol('extra')]: true }
    /** 中文说明：测试局部值 customPrototype，由紧邻初始化决定。 */
    const customPrototype = Object.create(null) as Record<string, unknown>
    /** 中文说明：测试局部值 customPrototypeObject，由紧邻初始化决定。 */
    const customPrototypeObject = Object.assign(Object.create(customPrototype) as Record<string, unknown>, { value: 1 })
    /** 中文说明：测试局部值 forgedIntrinsicObject，由紧邻初始化决定。 */
    const forgedIntrinsicObject = objectWithForgedIntrinsicPrototype()
    /** 中文说明：测试局部值 revokedIntrinsicObject，由紧邻初始化决定。 */
    const revokedIntrinsicObject = objectWithForgedIntrinsicPrototype(true)
    /** 中文说明：测试局部值 forgedPrototype，由紧邻初始化决定。 */
    const forgedPrototype: unknown[] = []
    Object.setPrototypeOf(forgedPrototype, null)
    /** 中文说明：测试局部值 forgedArray，由紧邻初始化决定。 */
    const forgedArray = [1]
    Object.setPrototypeOf(forgedArray, forgedPrototype)
    /** 中文说明：测试局部值 cyclic，由紧邻初始化决定。 */
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    /** 中文说明：测试局部值 foreignExotics，由紧邻初始化决定。 */
    const foreignExotics = runInNewContext(`(() => {
      class Box { constructor() { this.value = 1 } }
      class List extends Array {}
      return [new Box(), new List(1)]
    })()`) as [object, unknown[]]

    expect(snapshotJsonValue(new ExoticObject())).toBeUndefined()
    expect(snapshotJsonValue(new Map([['value', 1]]))).toBeUndefined()
    expect(snapshotJsonValue(new ExoticArray(1))).toBeUndefined()
    expect(snapshotJsonValue(foreignExotics[0])).toBeUndefined()
    expect(snapshotJsonValue(foreignExotics[1])).toBeUndefined()
    expect(snapshotJsonValue(sparse)).toBeUndefined()
    expect(snapshotJsonValue(compensatedSparse)).toBeUndefined()
    expect(snapshotJsonValue(decorated)).toBeUndefined()
    expect(snapshotJsonValue(symbolDecorated)).toBeUndefined()
    expect(snapshotJsonValue(hiddenObject)).toBeUndefined()
    expect(snapshotJsonValue(symbolObject)).toBeUndefined()
    expect(snapshotJsonValue(customPrototypeObject)).toBeUndefined()
    expect(snapshotJsonValue(forgedIntrinsicObject)).toBeUndefined()
    expect(snapshotJsonValue(revokedIntrinsicObject)).toBeUndefined()
    expect(snapshotJsonValue(forgedArray)).toBeUndefined()
    expect(snapshotJsonValue(cyclic)).toBeUndefined()
    expect(snapshotJsonValue([undefined])).toBeUndefined()
    expect(snapshotJsonValue({ value: undefined })).toBeUndefined()
  })

  it('preserves a literal __proto__ JSON key without changing the snapshot prototype', () => {
    /** 中文说明：测试局部值 source，由紧邻初始化决定。 */
    const source = Object.create(null) as Record<string, unknown>
    source.__proto__ = { safe: true }

    /** 中文说明：测试局部值 snapshot，由紧邻初始化决定。 */
    const snapshot = snapshotJsonValue(source)!

    expect(Object.getPrototypeOf(snapshot)).toBe(Object.prototype)
    expect(Object.prototype.hasOwnProperty.call(snapshot, '__proto__')).toBe(true)
    expect(snapshot.__proto__).toEqual({ safe: true })
  })

  it('propagates a throwing getter after reading it once', () => {
    /** 中文说明：测试局部值 failure，由紧邻初始化决定。 */
    const failure = new Error('getter failed')
    /** 中文说明：测试局部值 reads，由紧邻初始化决定。 */
    let reads = 0
    /** 中文说明：测试局部值 source，由紧邻初始化决定。 */
    const source = Object.defineProperty({}, 'value', {
      enumerable: true,
      get: () => {
        reads += 1
        throw failure
      },
    })

    expect(() => snapshotJsonValue(source)).toThrow(failure)
    expect(reads).toBe(1)
  })
})

describe('isJsonValue', () => {
  it('recognizes supported scalars and rejects every lossy scalar case', () => {
    /** 中文说明：测试局部值 unsupportedFunction，由紧邻初始化决定。 */
    const unsupportedFunction = (): void => {}
    /** 中文说明：测试局部值 unsupportedUndefined，由紧邻初始化决定。 */
    const unsupportedUndefined: unknown = undefined

    expect(isJsonValue(null)).toBe(true)
    expect(isJsonValue(false)).toBe(true)
    expect(isJsonValue('text')).toBe(true)
    expect(isJsonValue(1.25)).toBe(true)
    expect(isJsonValue(-0)).toBe(false)
    expect(isJsonValue(Number.NaN)).toBe(false)
    expect(isJsonValue(1n)).toBe(false)
    expect(isJsonValue(unsupportedFunction)).toBe(false)
    expect(isJsonValue(Symbol('value'))).toBe(false)
    expect(isJsonValue(unsupportedUndefined)).toBe(false)
  })

  it('accepts dense arrays and plain objects, including null-prototype records', () => {
    /** 中文说明：测试局部值 nullPrototype，由紧邻初始化决定。 */
    const nullPrototype = Object.assign(Object.create(null) as Record<string, unknown>, { value: true })

    expect(isJsonValue([1, { nested: null }, nullPrototype])).toBe(true)
    expect(isJsonValue({ value: [1, 2] })).toBe(true)
    expect(isJsonValue(nullPrototype)).toBe(true)
  })

  it('rejects sparse or decorated arrays, invalid children, exotic objects, and cycles', () => {
    /** 中文说明：类型或类 Exotic 约束服务或测试数据职责。 */
    class Exotic {
      readonly value = 1
    }
    /** 中文说明：类型或类 ExoticArray 约束服务或测试数据职责。 */
    class ExoticArray extends Array<number> {}
    /** 中文说明：测试局部值 sparse，由紧邻初始化决定。 */
    const sparse = new Array<number>(1)
    /** 中文说明：测试局部值 compensatedSparse，由紧邻初始化决定。 */
    const compensatedSparse = new Array<number>(1)
    Object.defineProperty(compensatedSparse, 'extra', { value: true })
    /** 中文说明：测试局部值 decorated，由紧邻初始化决定。 */
    const decorated = Object.assign([1], { extra: true })
    /** 中文说明：测试局部值 symbolDecorated，由紧邻初始化决定。 */
    const symbolDecorated = [1]
    Object.defineProperty(symbolDecorated, Symbol('extra'), { value: true })
    /** 中文说明：测试局部值 hiddenObject，由紧邻初始化决定。 */
    const hiddenObject = Object.defineProperty({}, 'hidden', { value: true })
    /** 中文说明：测试局部值 symbolObject，由紧邻初始化决定。 */
    const symbolObject = { [Symbol('extra')]: true }
    /** 中文说明：测试局部值 customPrototype，由紧邻初始化决定。 */
    const customPrototype = Object.create(null) as Record<string, unknown>
    /** 中文说明：测试局部值 customPrototypeObject，由紧邻初始化决定。 */
    const customPrototypeObject = Object.assign(Object.create(customPrototype) as Record<string, unknown>, { value: 1 })
    /** 中文说明：测试局部值 forgedIntrinsicObject，由紧邻初始化决定。 */
    const forgedIntrinsicObject = objectWithForgedIntrinsicPrototype()
    /** 中文说明：测试局部值 revokedIntrinsicObject，由紧邻初始化决定。 */
    const revokedIntrinsicObject = objectWithForgedIntrinsicPrototype(true)
    /** 中文说明：测试局部值 forgedPrototype，由紧邻初始化决定。 */
    const forgedPrototype: unknown[] = []
    Object.setPrototypeOf(forgedPrototype, null)
    /** 中文说明：测试局部值 forgedArray，由紧邻初始化决定。 */
    const forgedArray = [1]
    Object.setPrototypeOf(forgedArray, forgedPrototype)
    /** 中文说明：测试局部值 cyclic，由紧邻初始化决定。 */
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic

    expect(isJsonValue(sparse)).toBe(false)
    expect(isJsonValue(compensatedSparse)).toBe(false)
    expect(isJsonValue(decorated)).toBe(false)
    expect(isJsonValue(symbolDecorated)).toBe(false)
    expect(isJsonValue(hiddenObject)).toBe(false)
    expect(isJsonValue(symbolObject)).toBe(false)
    expect(isJsonValue(customPrototypeObject)).toBe(false)
    expect(isJsonValue(forgedIntrinsicObject)).toBe(false)
    expect(isJsonValue(revokedIntrinsicObject)).toBe(false)
    expect(isJsonValue(forgedArray)).toBe(false)
    expect(isJsonValue(new ExoticArray(1))).toBe(false)
    expect(isJsonValue([undefined])).toBe(false)
    expect(isJsonValue({ value: undefined })).toBe(false)
    expect(isJsonValue(new Exotic())).toBe(false)
    expect(isJsonValue(cyclic)).toBe(false)
  })
})
