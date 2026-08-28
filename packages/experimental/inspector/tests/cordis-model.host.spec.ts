/** Validation and projection of the shared Cordis tree representations.
 * @remarks 文件说明：文件职责：验证 experimental/inspector 中 cordis model host spec
 * 相关行为与失败场景。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import { describe, expect, it } from 'vitest'
import { parseCordisRuntimeTree } from '../src/shared/cordis/model.ts'
import {
  identifyRealmObject,
  RealmObjectRegistry,
  realmObjectExpression,
} from '../src/shared/cordis/object-registry.ts'
import { parseInspectorObjectReference } from '../src/shared/cordis/object-reference.ts'
import { projectCordisRuntimeTree } from '../src/shared/cordis/projector.ts'
import { parseCordisTreeSnapshot, type CordisTreeSnapshot } from '../src/shared/cordis/snapshot.ts'

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('Cordis runtime tree model', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('parses connected and disconnected realms and rejects duplicate source identities', () => {
    /**
     * 常量说明：tree 用于处理 tree 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const tree = {
      schemaVersion: 0,
      host: realm('host-1', 'host', { state: 'connected' }),
      clients: [realm('client-1', 'client', { state: 'disconnected', reason: 'offline' })],
    }
    expect(parseCordisRuntimeTree(tree)).toEqual(tree)
    expect(parseCordisRuntimeTree({ schemaVersion: 0, host: null, clients: [] }).host).toBeNull()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => parseCordisRuntimeTree({
      ...tree,
      clients: [realm('host-1', 'client', { state: 'connected' })],
    })).toThrow('repeats a sourceId')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：message（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(value, message)，
   * 并按返回类型处理结果。
   */
  it.each([
    [{ schemaVersion: 1, host: null, clients: [] }, 'invalid Cordis runtime tree'],
    [{ schemaVersion: 0, host: null, clients: {} }, 'invalid Cordis runtime tree'],
    [{ schemaVersion: 0, host: realm('host-1', 'client', { state: 'connected' }), clients: [] }, 'invalid host Cordis runtime source'],
    [{ schemaVersion: 0, host: realm('host-1', 'host', { state: 'connected' }, { source: { sourceId: 'host-1', kind: 'host', label: '' } }), clients: [] }, 'invalid host Cordis runtime source'],
    [{ schemaVersion: 0, host: realm('host-1', 'host', { state: 'connected' }, { source: { sourceId: 'host-1', kind: 'host', label: 'x'.repeat(257) } }), clients: [] }, 'invalid host Cordis runtime source'],
    [{ schemaVersion: 0, host: realm('host-1', 'host', { state: 'connected' }, { revision: 0 }), clients: [] }, 'invalid Cordis runtime realm header'],
    [{ schemaVersion: 0, host: realm('host-1', 'host', { state: 'connected' }, { truncated: 'no' }), clients: [] }, 'invalid Cordis runtime realm header'],
    [{ schemaVersion: 0, host: realm('host-1', 'host', null), clients: [] }, 'connection must be an object'],
    [{ schemaVersion: 0, host: realm('host-1', 'host', { state: 'disconnected', reason: 1 }), clients: [] }, 'invalid Cordis runtime connection'],
    [{ schemaVersion: 0, host: realm('host-1', 'host', { state: 'unknown' }), clients: [] }, 'invalid Cordis runtime connection'],
  ])('rejects malformed runtime tree headers %#', (value, message) => {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => parseCordisRuntimeTree(value)).toThrow(message)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('rejects malformed runtime nodes, duplicate Fiber ids, and excessive depth', () => {
    /**
     * 常量说明：withRoot 用于处理 withRoot 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：处理 withRoot 相关流程；使用场景由所在模块及调用位置决定。
     * @param root （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @returns unknown；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 withRoot(root)，并按返回类型处理结果。
     */
    const withRoot = (root: unknown): unknown => ({
      schemaVersion: 0,
      host: realm('host-1', 'host', { state: 'connected' }, { root }),
      clients: [],
    })
    /**
     * 常量说明：fiber 用于处理 fiber 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：处理 fiber 相关流程；使用场景由所在模块及调用位置决定。
     * @param uid （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @param children （unknown[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @returns unknown；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 fiber(uid, children)，并按返回类型处理结果。
     */
    const fiber = (uid: unknown, children: unknown[] = [{ kind: 'context', children: [] }]): unknown => ({
      kind: 'fiber',
      uid,
      children,
    })
    /**
     * 常量说明：invalid 用于处理 invalid 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const invalid = [
      [fiber(1), 'root must be a Context'],
      [null, 'known kind'],
      [{ kind: 'unknown', children: [] }, 'known kind'],
      [{ kind: 'context', children: {} }, 'children must be an array'],
      [{ kind: 'context', children: [fiber(0)] }, 'invalid Cordis runtime Fiber'],
      [{ kind: 'context', children: [fiber(1, [])] }, 'invalid Cordis runtime Fiber'],
      [{ kind: 'context', children: [fiber(1, [fiber(2)])] }, 'Fiber child must be a Context'],
      [{ kind: 'context', children: [fiber(1), fiber(1)] }, 'repeats a Fiber uid'],
    ] as const
    /**
     * 变量说明：root、message 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const [root, message] of invalid) /**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
expect(() => parseCordisRuntimeTree(withRoot(root))).toThrow(message)

    /**
     * 变量说明：deep 用于处理 deep 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let deep: unknown = { kind: 'context', children: [] }
    /**
     * 变量说明：depth 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (let depth = 0; depth < 258; depth++) deep = { kind: 'context', children: [deep] }
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => parseCordisRuntimeTree(withRoot(deep))).toThrow('depth limit')
  })
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('Cordis snapshot model', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('parses a complete Context/Fiber tree and its object references', () => {
    /**
     * 常量说明：snapshot 用于处理 snapshot 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const snapshot = routedSnapshot()
    expect(parseCordisTreeSnapshot(snapshot, 10)).toEqual(snapshot)
    expect(parseInspectorObjectReference({ registryId: 'registry-1', handle: 'context-1' })).toEqual({
      registryId: 'registry-1',
      handle: 'context-1',
    })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：message（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(value, message)，
   * 并按返回类型处理结果。
   */
  it.each([
    [{ ...routedSnapshot(), schemaVersion: 1 }, 'invalid Cordis tree header'],
    [{ ...routedSnapshot(), revision: 0 }, 'invalid Cordis tree header'],
    [{ ...routedSnapshot(), truncated: 'no' }, 'invalid Cordis tree header'],
    [{ ...routedSnapshot(), root: routedFiber(1, 'fiber-root', routedContext('fiber-child')) }, 'root must be a Context'],
    [{ ...routedSnapshot(), root: null }, 'known kind'],
    [{ ...routedSnapshot(), root: { kind: 'unknown', objectHandle: 'bad', children: [] } }, 'known kind'],
    [{ ...routedSnapshot(), root: { kind: 'context', objectHandle: 'bad', children: {} } }, 'children must be an array'],
    [{ ...routedSnapshot(), root: routedContext('same', [routedContext('same')]) }, 'repeats an object handle'],
    [{ ...routedSnapshot(), root: routedContext('root', [routedFiber(0, 'fiber', routedContext('child'))]) }, 'positive safe integer'],
    [{ ...routedSnapshot(), root: routedContext('root', [routedFiber(1, 'fiber', routedContext('child'), [])]) }, 'exactly one Context'],
    [{ ...routedSnapshot(), root: routedContext('root', [
      routedFiber(1, 'fiber-1', routedContext('child-1')),
      routedFiber(1, 'fiber-2', routedContext('child-2')),
    ]) }, 'repeats a Fiber uid'],
    [{ ...routedSnapshot(), root: routedContext('root', [
      routedFiber(1, 'fiber-1', routedContext('unused'), [routedFiber(2, 'fiber-2', routedContext('child'))]),
    ]) }, 'Fiber child must be a Context'],
  ])('rejects malformed routed snapshots %#', (value, message) => {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => parseCordisTreeSnapshot(value, 10)).toThrow(message)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('enforces node and depth limits', () => {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => parseCordisTreeSnapshot(routedSnapshot(), 1)).toThrow('exceeds 1 nodes')
    /**
     * 变量说明：deep 用于处理 deep 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let deep: unknown = routedContext('leaf')
    /**
     * 变量说明：depth 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (let depth = 0; depth < 258; depth++) deep = routedContext(`depth-${String(depth)}`, [deep])
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => parseCordisTreeSnapshot({ ...routedSnapshot(), root: deep }, 1_000)).toThrow('depth limit')
  })
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('Cordis runtime projection', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('removes routing fields from context-only and Fiber nodes in disconnected Client trees', () => {
    /**
     * 常量说明：projected 用于处理 projected 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const projected = projectCordisRuntimeTree({
      host: null,
      clients: [{
        source: { sourceId: 'client-1', kind: 'client', label: 'Client' },
        connection: { state: 'disconnected', reason: 'offline' },
        snapshot: routedSnapshot(routedContext('root', [
          routedContext('nested'),
          routedFiber(1, 'fiber', routedContext('owned')),
        ])) as unknown as CordisTreeSnapshot,
      }],
    })

    expect(projected).toEqual({
      schemaVersion: 0,
      host: null,
      clients: [{
        source: { sourceId: 'client-1', kind: 'client', label: 'Client' },
        connection: { state: 'disconnected', reason: 'offline' },
        revision: 1,
        truncated: false,
        root: {
          kind: 'context',
          children: [
            { kind: 'context', children: [] },
            { kind: 'fiber', uid: 1, children: [{ kind: 'context', children: [] }] },
          ],
        },
      }],
    })
  })
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('Cordis object registry', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('retains stable identities, recognizes wrappers, and rolls generations atomically', () => {
    /**
     * 常量说明：registry 用于处理 registry 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const registry = new RealmObjectRegistry()
    /**
     * 常量说明：value 用于处理 value 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const value = {}
    /**
     * 常量说明：first 用于处理 first 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const first = registry.begin()
    /**
     * 常量说明：reference 用于处理 reference 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const reference = first.retain(value)
    expect(first.retain(value)).toEqual(reference)
    first.commit()
    first.commit()
    expect(registry.resolve(reference.handle)).toBe(value)
    expect(registry.identify(value)).toEqual(reference)
    expect(identifyRealmObject(value)).toEqual(reference)
    expect(globalThis.eval(realmObjectExpression(reference))).toBe(value)

    /**
     * 常量说明：wrapper 用于处理 wrapper 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const wrapper = Object.create(value) as { then?: unknown }
    wrapper.then = undefined
    expect(registry.identify(wrapper)).toEqual(reference)
    /**
     * 变量说明：deepWrapper 用于处理 deepWrapper 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let deepWrapper: object = value
    /**
     * 变量说明：depth 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (let depth = 0; depth < 10; depth++) {
      deepWrapper = Object.assign(Object.create(deepWrapper) as object, { then: undefined })
    }
    expect(registry.identify(deepWrapper)).toBeUndefined()
    expect(registry.identify(null)).toBeUndefined()
    expect(registry.identify(Object.create(value) as object)).toBeUndefined()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(registry.identify(new Proxy({}, { ownKeys: () => { throw new Error('blocked') } }))).toBeUndefined()
    expect(identifyRealmObject({})).toBeUndefined()

    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => first.retain({})).toThrow('already committed')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => { first.release(reference.handle) }).toThrow('already committed')
    /**
     * 常量说明：second 用于处理 second 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const second = registry.begin()
    second.release(reference.handle)
    second.commit()
    expect(registry.resolve(reference.handle)).toBeUndefined()
    registry.close()
    registry.close()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => registry.begin()).toThrow('registry is disposed')
  })
})

/**
 * 功能说明：处理 realm 相关流程；使用场景由所在模块及调用位置决定。
 * @param sourceId （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param kind （'host' | 'client'）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param connection （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param overrides （Record<string, unknown>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Record<string, unknown>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 realm(sourceId, kind, connection, overrides)，
 * 并按返回类型处理结果。
 */
function realm(
  sourceId: string,
  kind: 'host' | 'client',
  connection: unknown,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    source: { sourceId, kind, label: sourceId },
    connection,
    revision: 1,
    truncated: false,
    root: { kind: 'context', children: [{ kind: 'fiber', uid: 1, children: [{ kind: 'context', children: [] }] }] },
    ...overrides,
  }
}

/**
 * 功能说明：处理 routedContext 相关流程；使用场景由所在模块及调用位置决定。
 * @param objectHandle （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param children （unknown[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Record<string, unknown>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 routedContext(objectHandle, children)，并按返回类型处理结果。
 */
function routedContext(objectHandle: string, children: unknown[] = []): Record<string, unknown> {
  return { kind: 'context', objectHandle, children }
}

/**
 * 功能说明：处理 routedFiber 相关流程；使用场景由所在模块及调用位置决定。
 * @param uid （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param objectHandle （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param context （unknown）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。
 * @param children （unknown[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Record<string, unknown>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 routedFiber(uid, objectHandle, context, children)，
 * 并按返回类型处理结果。
 */
function routedFiber(
  uid: unknown,
  objectHandle: string,
  context: unknown,
  children: unknown[] = [context],
): Record<string, unknown> {
  return { kind: 'fiber', uid, objectHandle, children }
}

/**
 * 功能说明：处理 routedSnapshot 相关流程；使用场景由所在模块及调用位置决定。
 * @param root （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Record<string, unknown>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 routedSnapshot(root)，并按返回类型处理结果。
 */
function routedSnapshot(root: unknown = routedContext('context-1', [
  routedFiber(1, 'fiber-1', routedContext('context-2')),
])): Record<string, unknown> {
  return {
    schemaVersion: 0,
    revision: 1,
    objectRegistryId: 'registry-1',
    root,
    truncated: false,
  }
}
