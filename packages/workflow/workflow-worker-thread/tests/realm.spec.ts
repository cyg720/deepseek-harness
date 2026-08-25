/**
 * 文件职责：验证 realm.spec.ts 覆盖的工作流与 Worker Thread行为与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、Worker Thread、消息协议或领域实体。
 * 产品维度：保障 Agent 的工作流与 Worker Thread能力稳定、可隔离且可诊断。
 * 逻辑维度：准备配置和消息，建立运行环境，执行流程，再处理事件、错误与清理。
 * 关键边界：线程消息不可信；跨线程状态必须显式传递；终止时必须等待所拥有资源停止。
 * 新手阅读建议：先看协议和类型，再读 Host/Runtime 主流程，最后关注隔离、失败与清理。
 */
import { describe, expect, it } from 'vitest'
import * as vm from 'node:vm'
import { materializeFromRealm, MaterializeError, renderThrown } from '../src/realm.ts'

/** Evaluate an expression inside a fresh vm realm and hand back the raw realm value. */
/* 中文说明：函数 inRealm 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function inRealm(expression: string): unknown {
  return vm.runInNewContext(`(${expression})`)
}

/** The MaterializeError message for a value that must be rejected (throws if accepted). */
/* 中文说明：函数 rejection 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function rejection(value: unknown): string {
  try {
    materializeFromRealm(value)
  } catch (error: unknown) {
    if (error instanceof MaterializeError) return error.message
    throw error
  }
  throw new Error('expected the value to be rejected')
}

describe('materializeFromRealm', () => {
  it('copies realm objects/arrays/scalars into host plain data', () => {
    /** 中文说明：变量 value 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const value = inRealm("{ a: 1, b: 'x', c: true, d: null, list: [1, [2, { deep: 'y' }]] }")
    /** 中文说明：变量 out 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const out = materializeFromRealm(value) as Record<string, unknown>
    expect(out).toEqual({ a: 1, b: 'x', c: true, d: null, list: [1, [2, { deep: 'y' }]] })
    // The copy is HOST data: prototypes are the host intrinsics.
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype)
    expect(Array.isArray(out.list)).toBe(true)
    // And it round-trips through JSON byte-identically (the whole point).
    expect(JSON.parse(JSON.stringify(out))).toEqual(out)
  })

  it('accepts undefined ONLY at the root (a valueless script return)', () => {
    expect(materializeFromRealm(undefined)).toBeUndefined()
    expect(rejection(inRealm('{ a: undefined }'))).toContain('value.a')
  })

  it('invokes getters ordinarily — the getter RESULT is what crosses (trust premise)', () => {
    /** 中文说明：变量 counter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const counter = inRealm(`
      (() => {
        globalThis.reads = 0
        return { get x() { globalThis.reads += 1; return globalThis.reads } }
      })()
    `)
    expect(materializeFromRealm(counter)).toEqual({ x: 1 })
  })

  it('a getter that THROWS surfaces as a MaterializeError carrying the rendered failure', () => {
    /** 中文说明：变量 hostile 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const hostile = inRealm("{ get x() { throw new Error('read failed') } }")
    /** 中文说明：变量 message 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const message = rejection(hostile)
    expect(message).toContain('reading the value threw')
    expect(message).toContain('read failed')
  })

  it('a "__proto__" key becomes an OWN data property of the copy, never a prototype mutation', () => {
    /** 中文说明：变量 value 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const value: unknown = vm.runInNewContext('JSON.parse(\'{"__proto__": {"polluted": 1}, "ok": 2}\')')
    /** 中文说明：变量 out 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const out = materializeFromRealm(value) as Record<string, unknown>
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype)
    expect(Object.prototype.hasOwnProperty.call(out, '__proto__')).toBe(true)
    expect(out.ok).toBe(2)
    // The host Object.prototype was NOT touched.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('rejects functions, symbols (keys and values), and bigints with path-qualified messages', () => {
    expect(rejection(inRealm('{ fn: () => 1 }'))).toContain('value.fn')
    expect(rejection(inRealm("{ [Symbol('k')]: 1 }"))).toContain('symbol-keyed')
    expect(rejection(inRealm("{ s: Symbol('v') }"))).toContain('value.s')
    expect(rejection(inRealm('{ big: 1n }'))).toContain('value.big')
    expect(rejection(inRealm("[Symbol('x')]"))).toContain('value[0]')
    /** 中文说明：函数值 taggedArray 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const taggedArray = inRealm("(() => { const a = [1]; a[Symbol('t')] = 1; return a })()")
    expect(rejection(taggedArray)).toContain('symbol-keyed')
  })

  it('rejects non-finite numbers and undefined values inside containers', () => {
    expect(rejection(inRealm('{ n: NaN }'))).toContain('non-finite')
    expect(rejection(inRealm('[Infinity]'))).toContain('non-finite')
  })

  it('rejects exotic prototypes (Date, Map, class instances) but accepts null-prototype data', () => {
    expect(rejection(inRealm('{ d: new Date(0) }'))).toContain('exotic prototype')
    expect(rejection(inRealm('new Map()'))).toContain('exotic prototype')
    expect(rejection(inRealm('(() => { class C { constructor() { this.x = 1 } } return new C() })()')))
      .toContain('exotic prototype')
    expect(materializeFromRealm(inRealm('Object.assign(Object.create(null), { a: 1 })'))).toEqual({ a: 1 })
  })

  it('rejects cycles and accepts the same object reused as a sibling (a DAG)', () => {
    expect(rejection(inRealm('(() => { const o = {}; o.self = o; return o })()'))).toContain('circular')
    /** 中文说明：函数值 dag 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const dag = inRealm('(() => { const leaf = { v: 1 }; return { a: leaf, b: leaf } })()')
    expect(materializeFromRealm(dag)).toEqual({ a: { v: 1 }, b: { v: 1 } })
  })

  it('rejects sparse arrays and non-index array properties; an array getter element materializes its value', () => {
    expect(rejection(inRealm('[1, , 3]'))).toContain('sparse')
    expect(rejection(inRealm('(() => { const a = [1]; a.total = 3; return a })()')))
      .toContain('non-index')
    expect(materializeFromRealm(inRealm('(() => { const a = [1]; Object.defineProperty(a, 0, { get: () => 7, enumerable: true }); return a })()')))
      .toEqual([7])
  })

  it('skips non-enumerable own properties (matching JSON.stringify exactly)', () => {
    /** 中文说明：函数值 value 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const value = inRealm(`(() => {
      const o = { visible: 1 }
      Object.defineProperty(o, 'hidden', { value: () => 1, enumerable: false })
      return o
    })()`)
    expect(materializeFromRealm(value)).toEqual({ visible: 1 })
  })

  it('works on plain host values too (the boundary is realm-agnostic)', () => {
    expect(materializeFromRealm({ a: [1, 'x'] })).toEqual({ a: [1, 'x'] })
    expect(materializeFromRealm('str')).toBe('str')
    expect(materializeFromRealm(3)).toBe(3)
    expect(materializeFromRealm(false)).toBe(false)
    expect(materializeFromRealm(null)).toBeNull()
  })
})

describe('renderThrown', () => {
  it('prefers the stack, for host and realm errors alike', () => {
    /** 中文说明：变量 host 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const host = renderThrown(new Error('host failure'))
    expect(host).toContain('host failure')
    expect(host).toContain('at ') // a real stack, not just the message
    /** 中文说明：函数值 realmError 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const realmError: unknown = vm.runInNewContext('(() => { try { throw new Error("realm failure") } catch (e) { return e } })()')
    expect(renderThrown(realmError)).toContain('realm failure')
  })

  it('falls back from stack to message to String()', () => {
    expect(renderThrown({ stack: 'custom data stack' })).toBe('custom data stack')
    /** 中文说明：变量 stackless 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const stackless = new Error('stackless failure')
    delete stackless.stack
    expect(renderThrown(stackless)).toBe('stackless failure')
    expect(renderThrown({ code: 42 })).toBe('[object Object]')
    expect(renderThrown('plain')).toBe('plain')
    expect(renderThrown(42)).toBe('42')
    expect(renderThrown(undefined)).toBe('undefined')
    expect(renderThrown(null)).toBe('null')
  })

  it('is total: a value whose accessors/toString throw renders as a fixed label', () => {
    expect(renderThrown({ get stack() { throw new Error('nope') } })).toBe('[unrenderable thrown value]')
    expect(renderThrown({ [Symbol.toPrimitive]() { throw new Error('nope') } })).toBe('[unrenderable thrown value]')
  })
})
