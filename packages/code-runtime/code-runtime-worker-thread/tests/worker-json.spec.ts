/**
 * 文件职责：验证代码运行时的 worker-json.spec.ts 行为。
 * 技术维度：Vitest、协议夹具、Worker/子进程或组件替身。
 * 产品维度：防止代码运行时协议与生命周期回归。
 * 逻辑维度：构造输入，运行被测入口并断言输出与清理。
 * 关键边界：跨进程数据必须校验；Worker 和异步任务必须结束。
 * 新手阅读建议：先读协议夹具，再按成功、失败和清理场景阅读。
 */
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { snapshotJsonValue } from '@deepseek-ai/dsh-session'
import { decodeWorkerJson, encodeWorkerJson, snapshotCodeJsonValue } from '../src/worker-json.ts'

describe('snapshotCodeJsonValue', () => {
  it('matches the canonical scalar boundary', () => {
    /** 中文说明：测试局部值 unsupported，由紧邻初始化决定。 */
    const unsupported = [undefined, 1n, Symbol('value'), () => 1]
    /** 中文说明：测试局部值 value，由紧邻初始化决定。 */
    for (const value of [null, false, 'text', 1.25, -0, Number.NaN, Number.POSITIVE_INFINITY, ...unsupported]) {
      expect(snapshotCodeJsonValue(value)).toEqual(snapshotJsonValue(value))
    }
  })

  it('detaches dense arrays and plain or null-prototype records', () => {
    /** 中文说明：测试局部值 shared，由紧邻初始化决定。 */
    const shared = { value: 1 }
    /** 中文说明：测试局部值 nullPrototype，由紧邻初始化决定。 */
    const nullPrototype = Object.assign(Object.create(null) as Record<string, unknown>, { shared })
    /** 中文说明：测试局部值 source，由紧邻初始化决定。 */
    const source = { list: [nullPrototype, shared], alias: shared }

    /** 中文说明：测试局部值 snapshot，由紧邻初始化决定。 */
    const snapshot = snapshotCodeJsonValue(source) as Record<string, unknown>
    shared.value = 2

    expect(snapshot).toEqual({ list: [{ shared: { value: 1 } }, { value: 1 }], alias: { value: 1 } })
    expect(snapshot).not.toBe(source)
    expect((snapshot.list as unknown[])[0]).not.toBe(nullPrototype)
    expect(snapshot.alias).not.toBe(shared)
  })

  it('accepts intrinsic plain containers from another JavaScript realm', () => {
    /** 中文说明：测试局部值 foreign，由紧邻初始化决定。 */
    const foreign = runInNewContext('({ object: { nested: [1] }, array: [2, { ok: true }] })') as {
      object: unknown
      array: unknown
    }

    expect(snapshotCodeJsonValue(foreign.object)).toEqual({ nested: [1] })
    expect(snapshotCodeJsonValue(foreign.array)).toEqual([2, { ok: true }])
  })

  it('reads each accepted slot once and preserves a literal __proto__ key', () => {
    /** 中文说明：测试局部值 objectReads，由紧邻初始化决定。 */
    let objectReads = 0
    /** 中文说明：测试局部值 arrayReads，由紧邻初始化决定。 */
    let arrayReads = 0
    /** 中文说明：测试局部值 source，由紧邻初始化决定。 */
    const source = Object.create(null) as Record<string, unknown>
    Object.defineProperty(source, '__proto__', {
      enumerable: true,
      get: () => {
        objectReads += 1
        return { safe: true }
      },
    })
    /** 中文说明：测试局部值 array，由紧邻初始化决定。 */
    const array = new Array<unknown>(1)
    Object.defineProperty(array, 0, {
      enumerable: true,
      get: () => {
        arrayReads += 1
        return arrayReads === 1 ? source : undefined
      },
    })

    /** 中文说明：测试局部值 snapshot，由紧邻初始化决定。 */
    const snapshot = snapshotCodeJsonValue(array) as Record<string, unknown>[]

    expect(objectReads).toBe(1)
    expect(arrayReads).toBe(1)
    expect(Object.getPrototypeOf(snapshot[0])).toBe(Object.prototype)
    expect(Object.hasOwn(snapshot[0]!, '__proto__')).toBe(true)
    expect(snapshot[0]?.['__proto__']).toEqual({ safe: true })
  })

  it('accepts deeply nested valid JSON without using the JavaScript call stack', () => {
    /** 中文说明：测试局部值 value，由紧邻初始化决定。 */
    let value: unknown = 'leaf'
    /** 中文说明：测试局部值 depth，由紧邻初始化决定。 */
    for (let depth = 0; depth < 5_000; depth++) value = [value]

    /** 中文说明：测试局部值 cursor，由紧邻初始化决定。 */
    let cursor = snapshotCodeJsonValue(value)
    /** 中文说明：测试局部值 depth，由紧邻初始化决定。 */
    for (let depth = 0; depth < 5_000; depth++) {
      expect(Array.isArray(cursor)).toBe(true)
      cursor = Array.isArray(cursor) ? cursor[0] : undefined
    }
    expect(cursor).toBe('leaf')
  })

  it('rejects exotic containers, sparse arrays, cycles, and invalid children', () => {
    /** 中文说明：类型或类 ExoticObject 约束协议数据或模块职责。 */
    class ExoticObject {
      readonly value = 1
    }
    /** 中文说明：类型或类 ExoticArray 约束协议数据或模块职责。 */
    class ExoticArray extends Array<number> {}
    /** 中文说明：测试局部值 cyclic，由紧邻初始化决定。 */
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    /** 中文说明：测试局部值 decorated，由紧邻初始化决定。 */
    const decorated = [1]
    Object.defineProperty(decorated, 'extra', { value: true })
    /** 中文说明：测试局部值 compensatedSparse，由紧邻初始化决定。 */
    const compensatedSparse = new Array(1)
    Object.defineProperty(compensatedSparse, 'extra', { value: true })
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
    /** 中文说明：测试局部值 forgedPrototype，由紧邻初始化决定。 */
    const forgedPrototype: unknown[] = []
    Object.setPrototypeOf(forgedPrototype, null)
    /** 中文说明：测试局部值 forgedArray，由紧邻初始化决定。 */
    const forgedArray = [1]
    Object.setPrototypeOf(forgedArray, forgedPrototype)
    /** 中文说明：测试局部值 spoofedObjectPrototype，由紧邻初始化决定。 */
    const spoofedObjectPrototype = Object.create(null) as Record<string, unknown>
    /** 中文说明：测试局部值 SpoofedObject，由紧邻初始化决定。 */
    const SpoofedObject = function Object() {}
    SpoofedObject.prototype = spoofedObjectPrototype
    Object.defineProperty(spoofedObjectPrototype, 'constructor', { value: SpoofedObject })
    /** 中文说明：测试局部值 spoofedObject，由紧邻初始化决定。 */
    const spoofedObject = Object.create(spoofedObjectPrototype) as Record<string, unknown>
    spoofedObject.value = 1
    /** 中文说明：测试局部值 revokedPrototype，由紧邻初始化决定。 */
    const revokedPrototype = Object.create(null) as Record<string, unknown>
    /** 中文说明：测试局部值 RevokedObject，由紧邻初始化决定。 */
    const RevokedObject = function Object() {}
    RevokedObject.prototype = revokedPrototype
    /** 中文说明：测试局部值 revokedConstructor，由紧邻初始化决定。 */
    const revokedConstructor = Proxy.revocable(RevokedObject, {})
    Object.defineProperty(revokedPrototype, 'constructor', { value: revokedConstructor.proxy })
    /** 中文说明：测试局部值 revokedObject，由紧邻初始化决定。 */
    const revokedObject = Object.create(revokedPrototype) as Record<string, unknown>
    revokedConstructor.revoke()
    /** 中文说明：测试局部值 spoofedArrayPrototype，由紧邻初始化决定。 */
    const spoofedArrayPrototype: unknown[] = []
    Object.setPrototypeOf(spoofedArrayPrototype, Object.prototype)
    /** 中文说明：测试局部值 SpoofedArray，由紧邻初始化决定。 */
    const SpoofedArray = function Array() {}
    SpoofedArray.prototype = spoofedArrayPrototype
    Object.defineProperty(spoofedArrayPrototype, 'constructor', { value: SpoofedArray })
    /** 中文说明：测试局部值 spoofedArray，由紧邻初始化决定。 */
    const spoofedArray = [1]
    Object.setPrototypeOf(spoofedArray, spoofedArrayPrototype)

    /** 中文说明：测试局部值 value，由紧邻初始化决定。 */
    for (const value of [
      new ExoticObject(),
      new Map([['value', 1]]),
      new ExoticArray(1),
      new Array(1),
      decorated,
      compensatedSparse,
      symbolDecorated,
      hiddenObject,
      symbolObject,
      customPrototypeObject,
      forgedArray,
      spoofedObject,
      revokedObject,
      spoofedArray,
      cyclic,
      [undefined],
      { value: undefined },
    ]) {
      /** 中文说明：测试局部值 canonical，由紧邻初始化决定。 */
      const canonical = snapshotJsonValue(value)
      expect(canonical).toBeUndefined()
      expect(snapshotCodeJsonValue(value)).toEqual(canonical)
    }
  })

  it('rejects an array whose getter mutates the validated length', () => {
    /** 中文说明：测试局部值 array，由紧邻初始化决定。 */
    const array = [0, 2]
    Object.defineProperty(array, 0, {
      enumerable: true,
      get: () => {
        array.length = 1
        return 1
      },
    })

    expect(snapshotCodeJsonValue(array)).toBeUndefined()
  })

  it('propagates a throwing getter and releases its recursion guard', () => {
    /** 中文说明：测试局部值 failure，由紧邻初始化决定。 */
    const failure = new Error('getter failed')
    /** 中文说明：测试局部值 source，由紧邻初始化决定。 */
    const source = Object.defineProperty({}, 'value', {
      enumerable: true,
      get: () => { throw failure },
    })

    expect(() => snapshotCodeJsonValue(source)).toThrow(failure)
    expect(snapshotCodeJsonValue({ after: true })).toEqual({ after: true })
  })
})

describe('flat worker JSON wire', () => {
  it('round-trips every JSON root while preserving object keys and container order', () => {
    /** 中文说明：测试局部值 withPrototypeKey，由紧邻初始化决定。 */
    const withPrototypeKey = Object.create(null) as Record<string, unknown>
    withPrototypeKey.__proto__ = { safe: true }
    /** 中文说明：测试局部值 values，由紧邻初始化决定。 */
    const values = [null, false, true, 1.25, 'text', [], {}, [1, { nested: [2] }], withPrototypeKey]
    /** 中文说明：测试局部值 value，由紧邻初始化决定。 */
    for (const value of values) {
      /** 中文说明：测试局部值 snapshot，由紧邻初始化决定。 */
      const snapshot = snapshotCodeJsonValue(value)
      expect(snapshot).not.toBeUndefined()
      expect(decodeWorkerJson(encodeWorkerJson(snapshot!))).toEqual(snapshot)
    }
    /** 中文说明：测试局部值 decoded，由紧邻初始化决定。 */
    const decoded = decodeWorkerJson(encodeWorkerJson(snapshotCodeJsonValue(withPrototypeKey)!)) as Record<string, unknown>
    expect(Object.hasOwn(decoded, '__proto__')).toBe(true)
    expect(decoded.__proto__).toEqual({ safe: true })
  })

  it('round-trips deep values through a bounded-depth token array', () => {
    /** 中文说明：测试局部值 value，由紧邻初始化决定。 */
    let value: unknown = 'leaf'
    /** 中文说明：测试局部值 depth，由紧邻初始化决定。 */
    for (let depth = 0; depth < 5_000; depth++) value = [value]
    /** 中文说明：测试局部值 snapshot，由紧邻初始化决定。 */
    const snapshot = snapshotCodeJsonValue(value)!
    /** 中文说明：测试局部值 wire，由紧邻初始化决定。 */
    const wire = encodeWorkerJson(snapshot)
    expect(wire).toHaveLength(5_001)

    /** 中文说明：测试局部值 cursor，由紧邻初始化决定。 */
    let cursor = decodeWorkerJson(wire)
    /** 中文说明：测试局部值 depth，由紧邻初始化决定。 */
    for (let depth = 0; depth < 5_000; depth++) {
      expect(Array.isArray(cursor)).toBe(true)
      cursor = Array.isArray(cursor) ? cursor[0] : undefined
    }
    expect(cursor).toBe('leaf')
  })

  it('rejects malformed, incomplete, lossy, sparse, decorated, and throwing wire values', () => {
    /** 中文说明：测试局部值 sparse，由紧邻初始化决定。 */
    const sparse = new Array(1)
    /** 中文说明：测试局部值 compensatedSparse，由紧邻初始化决定。 */
    const compensatedSparse = new Array(1)
    Object.defineProperty(compensatedSparse, 'extra', { value: true })
    /** 中文说明：测试局部值 decorated，由紧邻初始化决定。 */
    const decorated: unknown[] = [null]
    Object.defineProperty(decorated, 'extra', { value: true })
    /** 中文说明：测试局部值 throwing，由紧邻初始化决定。 */
    const throwing: unknown[] = []
    Object.defineProperty(throwing, 0, { enumerable: true, get: () => { throw new Error('wire getter') } })
    /** 中文说明：测试局部值 decoratedKeys，由紧邻初始化决定。 */
    const decoratedKeys: unknown[] = ['x']
    Object.defineProperty(decoratedKeys, 'extra', { value: true })
    /** 中文说明：测试局部值 foreignMarker，由紧邻初始化决定。 */
    const foreignMarker: Record<string, unknown> = { kind: 'array', length: 0 }
    Object.setPrototypeOf(foreignMarker, {})
    /** 中文说明：测试局部值 hiddenMarker，由紧邻初始化决定。 */
    const hiddenMarker = Object.defineProperty({ kind: 'array', length: 0 }, 'hidden', { value: true })

    /** 中文说明：测试局部值 value，由紧邻初始化决定。 */
    for (const value of [
      undefined,
      null,
      {},
      [],
      sparse,
      compensatedSparse,
      decorated,
      throwing,
      [undefined],
      [-0],
      [Number.NaN],
      [Number.POSITIVE_INFINITY],
      [1, 2],
      [[]],
      [foreignMarker],
      [hiddenMarker],
      [{ kind: 'unknown' }],
      [{ kind: 'array', bogus: 0 }],
      [{ kind: 'array' }],
      [{ kind: 'array', length: '1' }],
      [{ kind: 'array', length: -1 }],
      [{ kind: 'array', length: Number.MAX_SAFE_INTEGER + 1 }],
      [{ kind: 'array', length: 1 }],
      [{ kind: 'array', length: 2 }, { kind: 'array', length: 1 }, null],
      [{ kind: 'array', length: 0, extra: true }],
      [{ kind: 'object' }],
      [{ kind: 'object', keys: 'x' }],
      [{ kind: 'object', keys: decoratedKeys }],
      [{ kind: 'object', keys: [1] }],
      [{ kind: 'object', keys: ['x', 'x'] }, 1, 2],
      [{ kind: 'object', keys: ['x'] }],
      [{ kind: 'object', keys: [], extra: true }],
    ]) {
      expect(decodeWorkerJson(value)).toBeUndefined()
    }
  })

  it('rejects invalid values passed through a forged static type', () => {
    expect(() => encodeWorkerJson([undefined] as never)).toThrow(/sparse JSON array/)
    expect(() => encodeWorkerJson({ value: undefined } as never)).toThrow(/undefined JSON object property/)
  })
})
