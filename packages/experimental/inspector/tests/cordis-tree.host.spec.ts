/** Host-driven Cordis tree integration.
 * @remarks 文件说明：文件职责：验证 experimental/inspector 中 cordis tree host spec
 * 相关行为与失败场景。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import { Context } from '@deepseek-ai/cordis'
import WebSocket, { type RawData } from 'ws'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CordisTreeCollector } from '../src/shared/cordis/collector.ts'
import { observeCordisTree } from '../src/shared/cordis/observer.ts'
import { startInspector, type InspectorHandle } from '../src/host/bridge/controller.ts'
import { publishCordisTree as publishHostCordisTree } from '../src/host/inspection/cordis.ts'
import { parseCordisTreeSnapshot, type CordisTreeNode } from '../src/shared/cordis/snapshot.ts'
import { inspectorId } from '../src/shared/bridge/ids.ts'
import type { InspectorJsonValue } from '../src/shared/json.ts'
import { jsonByteLength } from '../src/shared/json.ts'
import type { InspectorSourceDescriptor } from '../src/shared/bridge/messages/observation.ts'
import { CordisTreeStore } from '../src/worker/inspection/cordis-store.ts'
import { CordisDomBackend, type CordisDomChange } from '../src/worker/cdp/domains/dom/model.ts'
import { InspectorClientFixture } from './fixtures/client-source.host.ts'

interface CdpMessage {
  readonly id?: number
  readonly method?: string
  readonly params?: Record<string, unknown>
  readonly result?: Record<string, unknown>
  readonly error?: { message: string }
}

interface CdpNode {
  readonly nodeId: number
  readonly backendNodeId: number
  readonly localName: string
  readonly attributes?: string[]
  readonly childNodeCount?: number
  readonly children?: CdpNode[]
}

/**
 * 类说明：CdpClient 用于集中封装 处理 CdpClient 相关状态与行为。
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。
 * 使用场景：由 experimental/inspector 在对应插件或业务生命周期内创建和调用。
 */
class CdpClient {
  /**
   * 变量说明：nextId 用于处理 nextId 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private nextId = 0
  /**
   * 常量说明：pending 用于处理 pending 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly pending = new Map<number, (message: CdpMessage) => void>()
  /**
   * 常量说明：events 用于处理 events 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  readonly events: CdpMessage[] = []

  /**
   * 功能说明：处理 CdpClient 相关流程；使用场景由所在模块及调用位置决定。
   * @param socket （WebSocket）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new CdpClient(socket) 创建实例，并在所属生命周期内使用。
   */
  private constructor(private readonly socket: WebSocket) {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：data（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(data)，并按返回类型处理结果。
     */
    socket.on('message', (data) => {
      /**
       * 常量说明：message 用于处理 message 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const message = JSON.parse(rawText(data)) as CdpMessage
      if (message.id !== undefined) this.pending.get(message.id)?.(message)
      else this.events.push(message)
    })
  }

  /**
   * 功能说明：处理 connect 相关流程；使用场景由所在模块及调用位置决定。
   * @param url （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<CdpClient>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 connect(url)，并按返回类型处理结果。
   */
  static async connect(url: string): Promise<CdpClient> {
    /**
     * 常量说明：socket 用于处理 socket 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const socket = new WebSocket(url)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：reject（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve, reject)，
     * 并按返回类型处理结果。
     */
    await new Promise<void>((resolve, reject) => {
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      socket.once('open', () => { resolve() })
      socket.once('error', reject)
    })
    return new CdpClient(socket)
  }

  /**
   * 功能说明：处理 call 相关流程；使用场景由所在模块及调用位置决定。
   * @param method （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param params （Record<string, unknown>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<CdpMessage>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 call(method, params)，并按返回类型处理结果。
   */
  call(method: string, params: Record<string, unknown> = {}): Promise<CdpMessage> {
    /**
     * 常量说明：id 用于处理 id 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const id = ++this.nextId
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：reject（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve, reject)，
     * 并按返回类型处理结果。
     */
    return new Promise((resolve, reject) => {
      /**
       * 常量说明：timer 用于处理 timer 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      const timer = setTimeout(() => { reject(new Error(`CDP call timed out: ${method}`)) }, 5_000)
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：message（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(message)，并按返回类型处理结果。
       */
      this.pending.set(id, (message) => {
        clearTimeout(timer)
        this.pending.delete(id)
        resolve(message)
      })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  /**
   * 功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。
   * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 close()，并按返回类型处理结果。
   */
  async close(): Promise<void> {
    if (this.socket.readyState === WebSocket.CLOSED) return
    /**
     * 常量说明：closed 用于处理 closed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
     */
    /**
    * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
    * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
    */
    const closed = new Promise<void>((resolve) => { this.socket.once('close', () => { resolve() }) })
    this.socket.close()
    await closed
  }
}

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('Cordis tree inspection', () => {
  /**
   * 变量说明：inspector 用于处理 inspector 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let inspector: InspectorHandle | undefined
  /**
   * 变量说明：cdp 用于处理 cdp 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let cdp: CdpClient | undefined
  /**
   * 变量说明：secondCdp 用于处理 secondCdp 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let secondCdp: CdpClient | undefined
  /**
   * 变量说明：clientSource 用于处理 clientSource 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let clientSource: InspectorClientFixture | undefined
  /**
   * 常量说明：observers 用于处理 observers 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const observers: Array<() => void> = []
  /**
   * 常量说明：fibers 用于处理 fibers 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 dispose 相关流程；使用场景由所在模块及调用位置决定。
   * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 dispose()，并按返回类型处理结果。
   */
  const fibers: Array<{ dispose(): Promise<void> }> = []

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  afterEach(async () => {
    /**
     * 变量说明：dispose 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const dispose of observers.splice(0).reverse()) dispose()
    /**
     * 变量说明：fiber 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const fiber of fibers.splice(0).reverse()) await fiber.dispose()
    await clientSource?.close()
    clientSource = undefined
    await cdp?.close()
    cdp = undefined
    await secondCdp?.close()
    secondCdp = undefined
    await inspector?.close()
    inspector = undefined
    Reflect.deleteProperty(globalThis, '__cordisHostProbe')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('preserves separate Fiber and Context identities in one shared snapshot model', async () => {
    /**
     * 常量说明：root 用于处理 root 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const root = new Context()
    /**
     * 常量说明：parent 用于处理 parent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const parent = root.isolate('probe')
    /**
     * 常量说明：fiber 用于处理 fiber 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
    * 功能说明：注册并应用 apply 相关流程；使用场景由所在模块及调用位置决定。
    * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
    * @example 在完成前置校验后调用 apply()，并按返回类型处理结果。
    */
    const fiber = parent.plugin({ name: 'child', apply() {} })
    await fiber.await()
    /**
     * 常量说明：collector 用于处理 collector 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const collector = new CordisTreeCollector(root, { maxNodes: 100, maxBytes: 64 * 1_024 })

    /**
     * 常量说明：snapshot 用于处理 snapshot 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const snapshot = collector.snapshot()
    expect(parseCordisTreeSnapshot(snapshot, 100)).toEqual(snapshot)
    /**
     * 常量说明：nodes 用于处理 nodes 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const nodes = treeNodes(snapshot.root)
    /**
     * 常量说明：fiberNode 用于处理 fiberNode 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：node（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(node)，并按返回类型处理结果。
     */
    const fiberNode = nodes.find(node => node.kind === 'fiber' && node.uid === fiber.uid)
    if (fiberNode === undefined) throw new Error('expected child Fiber node')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：node（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(node)，并按返回类型处理结果。
     */
    expect(nodes.every(node => !('id' in node) && !('parentId' in node))).toBe(true)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => parseCordisTreeSnapshot({
      ...snapshot,
      root: { ...snapshot.root, children: [{ ...fiberNode, children: [] }] },
    }, 100)).toThrow('exactly one Context')
    /**
     * 常量说明：contextNode 用于处理 contextNode 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const contextNode = fiberNode.children[0]
    /**
     * 常量说明：isolateNode 用于处理 isolateNode 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：node（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(node)，并按返回类型处理结果。
     */
    const isolateNode = nodes.find(node => node.kind === 'context'
      && collector.objects.resolve(node.objectHandle) === parent)

    expect(snapshot.root.kind).toBe('context')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：node（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(node)，并按返回类型处理结果。
     */
    expect(nodes.some(node => node.kind === 'fiber' && node.uid === 0)).toBe(false)
    expect(isolateNode?.children).toContain(fiberNode)
    /**
     * 常量说明：retainedFiber 用于处理 retainedFiber 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const retainedFiber = collector.objects.resolve(fiberNode.objectHandle)
    expect(Reflect.get(retainedFiber ?? {}, 'uid')).toBe(fiber.uid)
    expect(Reflect.get(retainedFiber ?? {}, 'ctx') === fiber.ctx).toBe(true)
    expect(collector.objects.resolve(contextNode.objectHandle) === fiber.ctx).toBe(true)
    /**
     * 常量说明：identifiedFiber 用于处理 identifiedFiber 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const identifiedFiber = collector.objects.identify(fiber)
    expect(identifiedFiber).toEqual({
      registryId: snapshot.objectRegistryId,
      handle: fiberNode.objectHandle,
    })
    expect(collector.objects.identify(Object.create(parent) as object)).toBeUndefined()

    collector.close()
    await fiber.dispose()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('marks snapshots truncated when a Context ancestry exceeds the traversal limit', async () => {
    /**
     * 常量说明：root 用于处理 root 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const root = new Context()
    /**
     * 变量说明：context 用于处理 context 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let context = root
    /**
     * 变量说明：depth 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (let depth = 0; depth < 102; depth++) context = context.isolate(`depth-${String(depth)}`)
    /**
     * 常量说明：fiber 用于处理 fiber 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
    * 功能说明：注册并应用 apply 相关流程；使用场景由所在模块及调用位置决定。
    * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
    * @example 在完成前置校验后调用 apply()，并按返回类型处理结果。
    */
    const fiber = context.plugin({ name: 'deep-child', apply() {} })
    await fiber.await()
    /**
     * 常量说明：collector 用于处理 collector 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const collector = new CordisTreeCollector(root, { maxNodes: 1_000, maxBytes: 1024 * 1024 })

    expect(collector.snapshot().truncated).toBe(true)

    collector.close()
    await fiber.dispose()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('bounds snapshots by node count and encoded byte size', async () => {
    /**
     * 常量说明：root 用于处理 root 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const root = new Context()
    /**
     * 常量说明：parent 用于处理 parent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const parent = root.isolate('parent')
    /**
     * 常量说明：child 用于处理 child 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const child = parent.isolate('child')
    /**
     * 常量说明：fiber 用于处理 fiber 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
    * 功能说明：注册并应用 apply 相关流程；使用场景由所在模块及调用位置决定。
    * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
    * @example 在完成前置校验后调用 apply()，并按返回类型处理结果。
    */
    const fiber = child.plugin({ name: 'bounded-child', apply() {} })
    await fiber.await()
    /**
     * 常量说明：completeCollector 用于处理 completeCollector 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const completeCollector = new CordisTreeCollector(root, { maxNodes: 100, maxBytes: 64 * 1_024 })
    /**
     * 常量说明：complete 用于处理 complete 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const complete = completeCollector.snapshot()
    /**
     * 常量说明：rootOnlyBytes 用于处理 rootOnlyBytes 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const rootOnlyBytes = jsonByteLength({
      ...complete,
      objectRegistryId: 'x'.repeat(complete.objectRegistryId.length),
      root: { ...complete.root, children: [] },
      truncated: true,
    })
    completeCollector.close()

    /**
     * 常量说明：nodeBound 用于处理 nodeBound 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const nodeBound = new CordisTreeCollector(root, { maxNodes: 1, maxBytes: 64 * 1_024 })
    expect(nodeBound.snapshot()).toMatchObject({ truncated: true, root: { children: [] } })
    nodeBound.close()

    /**
     * 常量说明：directRoot 用于处理 directRoot 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const directRoot = new Context()
    /**
     * 常量说明：directFiber 用于处理 directFiber 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
    * 功能说明：注册并应用 apply 相关流程；使用场景由所在模块及调用位置决定。
    * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
    * @example 在完成前置校验后调用 apply()，并按返回类型处理结果。
    */
    const directFiber = directRoot.plugin({ name: 'direct-child', apply() {} })
    await directFiber.await()
    /**
     * 常量说明：fiberBound 用于处理 fiberBound 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const fiberBound = new CordisTreeCollector(directRoot, { maxNodes: 2, maxBytes: 64 * 1_024 })
    expect(fiberBound.snapshot()).toMatchObject({ truncated: true, root: { children: [] } })
    fiberBound.close()

    /**
     * 常量说明：byteBound 用于处理 byteBound 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const byteBound = new CordisTreeCollector(root, { maxNodes: 100, maxBytes: rootOnlyBytes })
    expect(byteBound.snapshot()).toMatchObject({ truncated: true, root: { children: [] } })
    byteBound.close()

    const nestedRoot = new Context()
    const outerFiber = nestedRoot.plugin({ name: 'outer', apply() {} })
    await outerFiber.await()
    const innerFiber = outerFiber.ctx.isolate('nested').plugin({ name: 'inner', apply() {} })
    await innerFiber.await()
    const nestedComplete = new CordisTreeCollector(nestedRoot, { maxNodes: 100, maxBytes: 64 * 1_024 })
    const nestedBytes = jsonByteLength(nestedComplete.snapshot() as unknown as InspectorJsonValue)
    nestedComplete.close()
    const nestedBound = new CordisTreeCollector(nestedRoot, { maxNodes: 100, maxBytes: nestedBytes - 1 })
    const nestedSnapshot = nestedBound.snapshot()
    expect(nestedSnapshot.truncated).toBe(true)
    expect(treeNodes(nestedSnapshot.root)
      .some(node => node.kind === 'fiber' && node.uid === innerFiber.uid)).toBe(false)
    nestedBound.close()

    const impossible = new CordisTreeCollector(root, { maxNodes: 0, maxBytes: 1 })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => impossible.snapshot()).toThrow('maxNodes cannot retain the root Context')
    impossible.close()

    /**
     * 常量说明：rootTooLarge 用于处理 rootTooLarge 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const rootTooLarge = new CordisTreeCollector(new Context(), { maxNodes: 2, maxBytes: 1 })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => rootTooLarge.snapshot()).toThrow('Cordis root exceeds the source-frame byte limit')
    rootTooLarge.close()
    await innerFiber.dispose()
    await outerFiber.dispose()
    await directFiber.dispose()
    await fiber.dispose()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('coalesces Cordis notifications and ignores a queued publication after disposal', async () => {
    /**
     * 常量说明：root 用于处理 root 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const root = new Context()
    /**
     * 常量说明：listener 用于处理 listener 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const listener = vi.fn()
    /**
     * 常量说明：dispose 用于处理 dispose 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const dispose = observeCordisTree(root, listener, { maxNodes: 100, maxBytes: 64 * 1_024 })
    expect(listener).toHaveBeenCalledTimes(1)

    root.emit('internal/plugin', root.fiber)
    root.emit('internal/plugin', root.fiber)
    await Promise.resolve()
    expect(listener).toHaveBeenCalledTimes(2)

    root.emit('internal/plugin', root.fiber)
    dispose()
    dispose()
    await Promise.resolve()
    expect(listener).toHaveBeenCalledTimes(2)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('ignores disposed Fibers and non-Context listener owners while unwrapping Cordis shadows', async () => {
    /**
     * 常量说明：root 用于处理 root 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const root = new Context()
    /**
     * 常量说明：fiber 用于处理 fiber 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
    * 功能说明：注册并应用 apply 相关流程；使用场景由所在模块及调用位置决定。
    * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
    * @example 在完成前置校验后调用 apply()，并按返回类型处理结果。
    */
    const fiber = root.plugin({ name: 'temporarily-disposed', apply() {} })
    await fiber.await()
    /**
     * 常量说明：runtimeFiber 用于处理 runtimeFiber 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const runtimeFiber = fiber.ctx.fiber
    /**
     * 常量说明：uidDescriptor 用于处理 uidDescriptor 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const uidDescriptor = Object.getOwnPropertyDescriptor(runtimeFiber, 'uid')
    Object.defineProperty(runtimeFiber, 'uid', { ...uidDescriptor, value: null })
    /**
     * 常量说明：hooks 用于处理 hooks 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const hooks = root.events._hooks as unknown as Record<PropertyKey, Array<{ ctx: unknown }> | undefined>
    /**
     * 常量说明：probe 用于处理 probe 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const probe = Symbol('inspector-collector-probe')
    /**
     * 常量说明：empty 用于处理 empty 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const empty = Symbol('inspector-collector-empty')
    /**
     * 常量说明：shadow 用于处理 shadow 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const shadow = Object.create(root) as object
    Object.defineProperty(shadow, Symbol.for('cordis.shadow'), { value: true })
    hooks[probe] = [{ ctx: {} }, { ctx: shadow }, { ctx: runtimeFiber.ctx }]
    hooks[empty] = undefined
    /**
     * 常量说明：collector 用于处理 collector 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const collector = new CordisTreeCollector(root, { maxNodes: 100, maxBytes: 64 * 1_024 })
    try {
      expect(collector.snapshot().root.kind).toBe('context')
    } finally {
      collector.close()
      Reflect.deleteProperty(hooks, probe)
      Reflect.deleteProperty(hooks, empty)
      if (uidDescriptor !== undefined) Object.defineProperty(runtimeFiber, 'uid', uidDescriptor)
      await fiber.dispose()
    }
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('freezes a disconnected snapshot and replaces it with the reconnect generation', () => {
    /**
     * 常量说明：root 用于处理 root 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const root = new Context()
    /**
     * 常量说明：collector 用于处理 collector 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const collector = new CordisTreeCollector(root, { maxNodes: 100, maxBytes: 64 * 1_024 })
    /**
     * 常量说明：snapshot 用于处理 snapshot 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const snapshot = collector.snapshot()
    /**
     * 常量说明：store 用于处理 store 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const store = new CordisTreeStore({ maxNodes: 100, maxDisconnectedTrees: 1 })
    /**
     * 常量说明：first 用于处理 first 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const first = source('client-a', 'generation-1')
    store.replace(first, [{ sequence: 1, monotonicMs: 1, topic: 'cordis/tree', payload: asJson(snapshot) }])

    /**
     * 常量说明：object 用于处理 object 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const object = snapshot.root
    expect(store.resolveObject(first, {
      registryId: snapshot.objectRegistryId,
      handle: object.objectHandle,
    })).toBeDefined()
    store.close(first, 'transport closed')
    expect(store.snapshots()[0]?.connection).toEqual({ state: 'disconnected', reason: 'transport closed' })
    expect(store.resolveObject(first, {
      registryId: snapshot.objectRegistryId,
      handle: object.objectHandle,
    })).toBeUndefined()

    /**
     * 常量说明：reconnected 用于处理 reconnected 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const reconnected = source('client-a', 'generation-2')
    store.replace(reconnected, [{
      sequence: 1,
      monotonicMs: 2,
      topic: 'cordis/tree',
      payload: asJson({ ...snapshot, revision: snapshot.revision + 1 }),
    }])
    expect(store.snapshots()).toEqual([
      expect.objectContaining({ source: reconnected, connection: { state: 'connected' } }),
    ])

    store.close(reconnected, 'transport closed again')
    /**
     * 常量说明：other 用于处理 other 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const other = source('client-b', 'generation-1')
    store.replace(other, [{ sequence: 1, monotonicMs: 3, topic: 'cordis/tree', payload: asJson(snapshot) }])
    store.close(other, 'other transport closed')
    /**
     * 常量说明：retained 用于处理 retained 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const retained = store.snapshots()
    expect(retained).toHaveLength(1)
    expect(retained[0]?.source).toEqual(other)
    expect(retained[0]?.connection.state).toBe('disconnected')
    collector.close()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('diffs snapshots into local DOM mutations and suppresses revision-only updates', () => {
    /**
     * 常量说明：store 用于处理 store 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const store = new CordisTreeStore({ maxNodes: 100, maxDisconnectedTrees: 1 })
    /**
     * 常量说明：backend 用于处理 backend 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const backend = new CordisDomBackend(store)
    /**
     * 常量说明：changes 用于处理 changes 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const changes: CordisDomChange[] = []
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
     * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
     */
    backend.subscribe((event) => { changes.push(event) })
    /**
     * 常量说明：host 用于处理 host 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const host = { ...source('host', 'generation-1'), kind: 'host' as const }
    /**
     * 常量说明：context 用于处理 context 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：处理 context 相关流程；使用场景由所在模块及调用位置决定。
     * @param objectHandle （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @param children （unknown[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @returns Record<string, unknown>；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 context(objectHandle, children)，并按返回类型处理结果。
     */
    const context = (objectHandle: string, children: unknown[] = []): Record<string, unknown> => ({
      kind: 'context',
      objectHandle,
      children,
    })
    /**
     * 常量说明：fiber 用于处理 fiber 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：处理 fiber 相关流程；使用场景由所在模块及调用位置决定。
     * @param uid （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @param objectHandle （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @returns Record<string, unknown>；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 fiber(uid, objectHandle)，并按返回类型处理结果。
     */
    const fiber = (uid: number, objectHandle: string): Record<string, unknown> => ({
      kind: 'fiber',
      uid,
      objectHandle,
      children: [context(`${objectHandle}-context`)],
    })
    /**
     * 常量说明：snapshot 用于处理 snapshot 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：处理 snapshot 相关流程；使用场景由所在模块及调用位置决定。
     * @param revision （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @param children （unknown[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @returns InspectorJsonValue；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 snapshot(revision, children)，并按返回类型处理结果。
     */
    const snapshot = (revision: number, children: unknown[]): InspectorJsonValue => ({
      schemaVersion: 0,
      revision,
      objectRegistryId: 'registry',
      root: context('root', children),
      truncated: false,
    }) as InspectorJsonValue
    /**
     * 常量说明：replace 用于处理 replace 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：处理 replace 相关流程；使用场景由所在模块及调用位置决定。
     * @param revision （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @param children （unknown[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 replace(revision, children)，并按返回类型处理结果。
     */
    const replace = (revision: number, children: unknown[]): void => {
      store.append(host, [{ sequence: revision, monotonicMs: revision, topic: 'cordis/tree', payload: snapshot(revision, children) }])
    }

    replace(1, [fiber(1, 'fiber-1')])
    expect(changes.at(-1)).toMatchObject({ type: 'tree-mutated', mutations: [{ type: 'child-inserted' }] })
    changes.length = 0
    replace(2, [fiber(1, 'fiber-1')])
    expect(changes).toEqual([])

    replace(3, [fiber(2, 'fiber-1')])
    expect(changes).toEqual([
      expect.objectContaining({ type: 'tree-mutated', mutations: [expect.objectContaining({ type: 'attribute-modified', name: 'uid', value: '2' })] }),
    ])
    changes.length = 0

    replace(4, [fiber(2, 'fiber-1'), context('context-2')])
    expect(changes).toEqual([
      expect.objectContaining({ type: 'tree-mutated', mutations: [expect.objectContaining({ type: 'child-inserted' })] }),
    ])
    changes.length = 0
    replace(5, [fiber(2, 'fiber-1')])
    expect(changes).toEqual([
      expect.objectContaining({ type: 'tree-mutated', mutations: [expect.objectContaining({ type: 'child-removed' })] }),
    ])

    changes.length = 0
    replace(6, [context('context-a'), context('context-b')])
    changes.length = 0
    replace(7, [context('context-b'), context('context-a')])
    expect(changes).toEqual([
      expect.objectContaining({ type: 'tree-mutated', mutations: [expect.objectContaining({ type: 'children-replaced' })] }),
    ])

    changes.length = 0
    replace(8, [{ kind: 'fiber', uid: 3, objectHandle: 'context-a', children: [context('changed-kind')] }])
    expect(changes).toEqual([
      expect.objectContaining({ type: 'tree-mutated', mutations: [{ type: 'document-updated' }] }),
    ])
    backend.close()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('projects Host and Client trees and resolves both node kinds to RemoteObjects', async () => {
    inspector = await startInspector({ port: 0, captureFetch: false, maxCordisNodes: 100 })
    /**
     * 常量说明：host 用于处理 host 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const host = new Context()
    /**
     * 常量说明：hostFiber 用于处理 hostFiber 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
    * 功能说明：注册并应用 apply 相关流程；使用场景由所在模块及调用位置决定。
    * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
    * @example 在完成前置校验后调用 apply()，并按返回类型处理结果。
    */
    const hostFiber = host.plugin({ name: 'host-child', apply() {} })
    fibers.push(hostFiber)
    await hostFiber.await()
    Reflect.set(globalThis, '__cordisHostProbe', host)
    observers.push(publishHostCordisTree(host, inspector.source, { maxNodes: 100, maxBytes: 64 * 1_024 }))

    clientSource = await InspectorClientFixture.start(inspector.endpoint.client, { label: 'Tree Client' })
    cdp = await CdpClient.connect(inspector.endpoint.webSocketDebuggerUrl)
    await cdp.call('Runtime.enable')

    /**
     * 变量说明：document 用于处理 document 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let document: CdpNode | undefined
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(async () => {
      /**
       * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const response = await cdp!.call('DOM.getDocument', { depth: -1 })
      expect(response.error).toBeUndefined()
      document = response.result?.root as CdpNode
      expect(hostContainer(document)).toBeDefined()
      expect(clientContainers(document)).toHaveLength(1)
    })
    if (document === undefined) throw new Error('DOM.getDocument returned no root')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：node（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(node)，并按返回类型处理结果。
     */
    expect(document.children?.map(node => node.localName)).toEqual(['host', 'clients'])
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：node（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(node)，并按返回类型处理结果。
     */
    expect(document.children?.every(node => (node.attributes ?? []).length === 0)).toBe(true)

    /**
     * 常量说明：stored 用于处理 stored 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const stored = await cdp.call('DSHInspector.getCordisTree')
    /**
     * 常量说明：model 用于处理 model 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const model = stored.result?.tree as {
      host: { root: Record<string, unknown> } | null
      clients: Array<{ root: Record<string, unknown> }>
    }
    expect(model.host?.root).toMatchObject({ kind: 'context' })
    expect(model.clients).toHaveLength(1)
    expect(model.clients[0]?.root).toMatchObject({ kind: 'context' })
    expect(model.host?.root).not.toHaveProperty('nodeId')
    expect(model.host?.root).not.toHaveProperty('backendNodeId')

    /**
     * 常量说明：realms 用于处理 realms 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const realms = [
      ['host', hostContainer(document)],
      ['client', clientContainers(document)[0]],
    ] as const
    /**
     * 变量说明：realmKind、realm 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const [realmKind, realm] of realms) {
      expect(realm?.attributes ?? []).toEqual([])
      /**
       * 常量说明：rootContext 用于处理 rootContext 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const rootContext = realm?.children?.[0]
      expect(rootContext?.localName).toBe('context')
      expect(rootContext?.children?.[0]?.localName).toBe('fiber')
      expect(rootContext?.children?.[0]?.children?.[0]?.localName).toBe('context')
      /**
       * 变量说明：entityKind 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const entityKind of ['context', 'fiber']) {
        /**
         * 常量说明：node 用于处理 node 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
         * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item)，并按返回类型处理结果。
         */
        const node = realm === undefined ? undefined : walk(realm).find(item => item.localName === entityKind)
        if (node === undefined) throw new Error(`missing ${realmKind} ${entityKind} node`)
        expect(node.attributes ?? []).toEqual(entityKind === 'fiber'
          ? ['uid', expect.stringMatching(/^\d+$/u)]
          : [])
        expect(node.nodeId).toBeGreaterThan(0)
        expect(node.backendNodeId).toBeGreaterThan(0)
        /**
         * 常量说明：objectGroup 用于处理 objectGroup 相关数据，作用于当前作用域；初始化后不可重新赋值，
         * 但对象内部是否可变仍由其类型决定。
         */
        const objectGroup = `tree-${realmKind}-${entityKind}`
        /**
         * 常量说明：resolved 用于处理 resolved 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const resolved = await cdp.call('DOM.resolveNode', { nodeId: node.nodeId, objectGroup })
        expect(resolved.error).toBeUndefined()
        /**
         * 常量说明：remote 用于处理 remote 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const remote = resolved.result?.object as Record<string, unknown>
        expect(remote).toMatchObject({
          type: 'object',
          subtype: 'node',
          className: entityKind === 'fiber' ? 'Fiber' : 'Context',
        })
        expect(typeof remote.objectId).toBe('string')
        /**
         * 常量说明：properties 用于处理 properties 相关数据，作用于当前作用域；初始化后不可重新赋值，
         * 但对象内部是否可变仍由其类型决定。
         */
        const properties = await cdp.call('Runtime.getProperties', { objectId: remote.objectId, ownProperties: true })
        expect(properties.error).toBeUndefined()
        await expect(cdp.call('DOM.requestNode', { objectId: remote.objectId })).resolves.toMatchObject({
          result: { nodeId: node.nodeId },
        })
        await cdp.call('Runtime.releaseObjectGroup', { objectGroup })
      }
    }

    /**
     * 常量说明：hostNode 用于处理 hostNode 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item)，并按返回类型处理结果。
     */
    const hostNode = walk(hostContainer(document)!).find(item => item.localName === 'context')!
    /**
     * 常量说明：hostEvaluated 用于处理 hostEvaluated 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const hostEvaluated = await cdp.call('Runtime.evaluate', { expression: 'globalThis.__cordisHostProbe' })
    expect(hostEvaluated.result?.result).toMatchObject({ type: 'object', subtype: 'node', className: 'Context' })
    await expect(cdp.call('DOM.requestNode', {
      objectId: (hostEvaluated.result?.result as Record<string, unknown>).objectId,
    })).resolves.toMatchObject({ result: { nodeId: hostNode.nodeId } })
    /**
     * 常量说明：hostThrown 用于处理 hostThrown 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const hostThrown = await cdp.call('Runtime.evaluate', { expression: 'throw globalThis.__cordisHostProbe' })
    /**
     * 常量说明：hostException 用于处理 hostException 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const hostException = hostThrown.result?.exceptionDetails as Record<string, unknown>
    /**
     * 常量说明：hostExceptionObject 用于处理 hostExceptionObject 相关数据，作用于当前作用域；
     * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const hostExceptionObject = hostException.exception as Record<string, unknown>
    expect(hostExceptionObject).toMatchObject({ subtype: 'node', className: 'Context' })
    await expect(cdp.call('DOM.requestNode', { objectId: hostExceptionObject.objectId }))
      .resolves.toMatchObject({ result: { nodeId: hostNode.nodeId } })

    /**
     * 变量说明：clientContextId 用于处理 clientContextId 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let clientContextId: number | undefined
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => {
      /**
       * 常量说明：event 用于处理 event 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item)，并按返回类型处理结果。
       */
      const event = cdp!.events.find(item => item.method === 'Runtime.executionContextCreated'
        && String((item.params?.context as { name?: string } | undefined)?.name).startsWith('Client'))
      clientContextId = (event?.params?.context as { id?: number } | undefined)?.id
      expect(clientContextId).toBeTypeOf('number')
    })
    /**
     * 常量说明：clientNode 用于处理 clientNode 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item)，并按返回类型处理结果。
     */
    const clientNode = walk(clientContainers(document)[0]!).find(item => item.localName === 'context')!
    /**
     * 常量说明：clientEvaluated 用于处理 clientEvaluated 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const clientEvaluated = await cdp.call('Runtime.evaluate', {
      expression: 'globalThis.__cordisClientProbe',
      contextId: clientContextId,
    })
    expect(clientEvaluated.result?.result).toMatchObject({ type: 'object', subtype: 'node', className: 'Context' })
    await expect(cdp.call('DOM.requestNode', {
      objectId: (clientEvaluated.result?.result as Record<string, unknown>).objectId,
    })).resolves.toMatchObject({ result: { nodeId: clientNode.nodeId } })
    /**
     * 常量说明：clientThrown 用于处理 clientThrown 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const clientThrown = await cdp.call('Runtime.evaluate', {
      expression: 'throw globalThis.__cordisClientProbe',
      contextId: clientContextId,
    })
    /**
     * 常量说明：clientException 用于处理 clientException 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const clientException = clientThrown.result?.exceptionDetails as Record<string, unknown>
    /**
     * 常量说明：clientExceptionObject 用于处理 clientExceptionObject 相关数据，作用于当前作用域；
     * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const clientExceptionObject = clientException.exception as Record<string, unknown>
    expect(clientExceptionObject).toMatchObject({ subtype: 'node', className: 'Context' })
    await expect(cdp.call('DOM.requestNode', { objectId: clientExceptionObject.objectId }))
      .resolves.toMatchObject({ result: { nodeId: clientNode.nodeId } })

    /**
     * 常量说明：consoleOffset 用于处理 consoleOffset 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const consoleOffset = cdp.events.length
    await clientSource.logCordis('cordis-client-console')
    /**
     * 变量说明：consoleObject 用于处理 consoleObject 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let consoleObject: Record<string, unknown> | undefined
    /**
     * 变量说明：consoleFiber 用于处理 consoleFiber 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let consoleFiber: Record<string, unknown> | undefined
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => {
      /**
       * 常量说明：event 用于处理 event 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：candidate（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(candidate)，并按返回类型处理结果。
       */
      const event = cdp!.events.slice(consoleOffset).find((candidate) => {
        /**
         * 常量说明：params 用于处理 params 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const params = candidate.params
        if (params === undefined
          || candidate.method !== 'Runtime.consoleAPICalled'
          || params.executionContextId !== clientContextId
          || !Array.isArray(params.args)) return false
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：argument（由 TypeScript
         * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(argument)，并按返回类型处理结果。
         */
        return params.args.some(argument => (argument as { value?: unknown }).value === 'cordis-client-console')
      })
      /**
       * 常量说明：args 用于处理 args 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const args = event?.params?.args
      consoleObject = Array.isArray(args) ? args[0] as Record<string, unknown> | undefined : undefined
      consoleFiber = Array.isArray(args) ? args[1] as Record<string, unknown> | undefined : undefined
      expect(consoleObject).toMatchObject({ type: 'object', subtype: 'node', className: 'Context' })
      expect(consoleFiber).toMatchObject({ type: 'object', subtype: 'node', className: 'Fiber' })
    })
    await expect(cdp.call('DOM.requestNode', { objectId: consoleObject!.objectId }))
      .resolves.toMatchObject({ result: { nodeId: clientNode.nodeId } })
    /**
     * 常量说明：requestedFiber 用于处理 requestedFiber 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const requestedFiber = await cdp.call('DOM.requestNode', { objectId: consoleFiber!.objectId })
    /**
     * 常量说明：requestedFiberId 用于处理 requestedFiberId 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const requestedFiberId = (requestedFiber.result as { nodeId?: number } | undefined)?.nodeId
    /**
     * 常量说明：clientFiberNode 用于处理 clientFiberNode 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：node（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(node)，并按返回类型处理结果。
     */
    const clientFiberNode = walk(clientContainers(document)[0]!).find(node => node.nodeId === requestedFiberId)
    expect(clientFiberNode).toMatchObject({
      localName: 'fiber',
      attributes: ['uid', String(clientSource.fiberUid)],
    })

    /**
     * 常量说明：firstResolved 用于处理 firstResolved 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const firstResolved = await cdp.call('DOM.resolveNode', { backendNodeId: clientNode.backendNodeId })
    /**
     * 常量说明：firstObjectId 用于处理 firstObjectId 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const firstObjectId = (firstResolved.result?.object as Record<string, unknown>).objectId
    secondCdp = await CdpClient.connect(inspector.endpoint.webSocketDebuggerUrl)
    /**
     * 常量说明：secondDocument 用于处理 secondDocument 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const secondDocument = (await secondCdp.call('DOM.getDocument', { depth: -1 })).result?.root as CdpNode
    /**
     * 常量说明：secondNode 用于处理 secondNode 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：node（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(node)，并按返回类型处理结果。
     */
    const secondNode = walk(secondDocument).find(node => node.backendNodeId === clientNode.backendNodeId)
    expect(secondNode).toBeDefined()
    /**
     * 常量说明：secondResolved 用于处理 secondResolved 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const secondResolved = await secondCdp.call('DOM.resolveNode', { backendNodeId: clientNode.backendNodeId })
    /**
     * 常量说明：secondObjectId 用于处理 secondObjectId 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const secondObjectId = (secondResolved.result?.object as Record<string, unknown>).objectId
    expect(secondObjectId).not.toBe(firstObjectId)
    expect((await secondCdp.call('DOM.requestNode', { objectId: firstObjectId })).error).toBeDefined()

    /**
     * 常量说明：eventOffset 用于处理 eventOffset 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const eventOffset = cdp.events.length
    await clientSource.close()
    clientSource = undefined
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => {
      /**
       * 常量说明：events 用于处理 events 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const events = cdp!.events.slice(eventOffset)
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
       * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
       */
      expect(events.some(event => event.method === 'Runtime.executionContextDestroyed'
        && event.params?.executionContextId === clientContextId)).toBe(true)
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
       * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
       */
      expect(events.some(event => event.method === 'DOM.documentUpdated')).toBe(false)
    })

    /**
     * 常量说明：disconnectedDocument 用于处理 disconnectedDocument 相关数据，作用于当前作用域；
     * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const disconnectedDocument = (await cdp.call('DOM.getDocument', { depth: -1 })).result?.root as CdpNode
    /**
     * 常量说明：disconnectedClient 用于处理 disconnectedClient 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const disconnectedClient = clientContainers(disconnectedDocument)[0]
    expect(disconnectedClient).toBeDefined()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：node（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(node)，并按返回类型处理结果。
     */
    expect(walk(disconnectedClient!).find(node => node.backendNodeId === clientNode.backendNodeId)?.nodeId)
      .toBe(clientNode.nodeId)
    expect((await cdp.call('DOM.resolveNode', { nodeId: clientNode.nodeId })).error?.message)
      .toContain('Cordis realm is disconnected')
    expect((await cdp.call('DOM.requestNode', {
      objectId: (clientEvaluated.result?.result as Record<string, unknown>).objectId,
    })).error).toBeDefined()
    /**
     * 常量说明：disconnectedTree 用于处理 disconnectedTree 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const disconnectedTree = (await cdp.call('DSHInspector.getCordisTree')).result?.tree as {
      clients: Array<{ connection: { state: string } }>
    }
    expect(disconnectedTree.clients[0]?.connection.state).toBe('disconnected')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('emits only node-level DOM changes for Client snapshots', async () => {
    inspector = await startInspector({ port: 0, captureFetch: false, maxCordisNodes: 100 })
    cdp = await CdpClient.connect(inspector.endpoint.webSocketDebuggerUrl)
    /**
     * 常量说明：initialDocument 用于处理 initialDocument 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const initialDocument = (await cdp.call('DOM.getDocument')).result?.root as CdpNode
    /**
     * 常量说明：clientsNode 用于处理 clientsNode 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：node（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(node)，并按返回类型处理结果。
     */
    const clientsNode = initialDocument.children?.find(node => node.localName === 'clients')
    if (clientsNode === undefined) throw new Error('DOM document has no clients container')

    /**
     * 变量说明：offset 用于处理 offset 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let offset = cdp.events.length
    clientSource = await InspectorClientFixture.start(inspector.endpoint.client, { label: 'Incremental Client' })
    /**
     * 变量说明：insertedClient 用于处理 insertedClient 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let insertedClient: CdpNode | undefined
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => {
      /**
       * 常量说明：events 用于处理 events 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const events = cdp!.events.slice(offset)
      /**
       * 常量说明：inserted 用于处理 inserted 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
       * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
       */
      const inserted = events.find(event => event.method === 'DOM.childNodeInserted')
      expect(inserted?.params?.parentNodeId).toBe(clientsNode.nodeId)
      expect(inserted?.params?.node).toMatchObject({ localName: 'client' })
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
       * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
       */
      expect(events.some(event => event.method === 'DOM.documentUpdated')).toBe(false)
      insertedClient = inserted?.params?.node as CdpNode
    })
    // The collapsed insert payload withholds the realm subtree; expand it to follow deeper changes.
    expect(insertedClient?.children).toBeUndefined()
    await cdp.call('DOM.requestChildNodes', { nodeId: insertedClient!.nodeId, depth: -1 })

    /**
     * 常量说明：firstTree 用于处理 firstTree 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const firstTree = (await cdp.call('DSHInspector.getCordisTree')).result?.tree as {
      clients: Array<{ revision: number }>
    }
    /**
     * 常量说明：firstRevision 用于处理 firstRevision 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const firstRevision = firstTree.clients[0]?.revision
    offset = cdp.events.length
    await clientSource.refreshTree()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(async () => {
      /**
       * 常量说明：tree 用于处理 tree 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const tree = (await cdp!.call('DSHInspector.getCordisTree')).result?.tree as {
        clients: Array<{ revision: number }>
      }
      expect(tree.clients[0]?.revision).toBeGreaterThan(firstRevision ?? 0)
    })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
     * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
     */
    expect(cdp.events.slice(offset).some(event => event.method?.startsWith('DOM.'))).toBe(false)

    offset = cdp.events.length
    /**
     * 常量说明：uid 用于处理 uid 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const uid = await clientSource.addFiber()
    /**
     * 变量说明：insertedNodeId 用于处理 insertedNodeId 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let insertedNodeId: number | undefined
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => {
      /**
       * 常量说明：inserted 用于处理 inserted 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
       * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
       */
      const inserted = cdp!.events.slice(offset).find(event => event.method === 'DOM.childNodeInserted'
        && (event.params?.node as CdpNode | undefined)?.localName === 'fiber'
        && (event.params?.node as CdpNode | undefined)?.attributes?.includes(String(uid)))
      insertedNodeId = (inserted?.params?.node as CdpNode | undefined)?.nodeId
      expect(insertedNodeId).toBeTypeOf('number')
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
       * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
       */
      expect(cdp!.events.slice(offset).some(event => event.method === 'DOM.documentUpdated')).toBe(false)
    })

    offset = cdp.events.length
    await clientSource.removeFiber()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => {
      /**
       * 常量说明：events 用于处理 events 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const events = cdp!.events.slice(offset)
      /**
       * 常量说明：removed 用于处理 removed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
       * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
       */
      const removed = events.find(event => event.method === 'DOM.childNodeRemoved')
      expect(removed?.params?.nodeId).toBe(insertedNodeId)
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
       * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
       */
      expect(events.some(event => event.method === 'DOM.documentUpdated')).toBe(false)
    })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('serves three document levels by default and withheld levels on demand', async () => {
    inspector = await startInspector({ port: 0, captureFetch: false, maxCordisNodes: 100 })
    /**
     * 常量说明：host 用于处理 host 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const host = new Context()
    /**
     * 变量说明：innerFiber 用于处理 innerFiber 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let innerFiber: { uid: number | null } | undefined
    /**
     * 常量说明：outer 用于处理 outer 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
    * 功能说明：注册并应用 apply 相关流程；使用场景由所在模块及调用位置决定。
    * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
    * @example 在完成前置校验后调用 apply()，并按返回类型处理结果。
    */
    const outer = host.plugin({
      name: 'outer',
      /**
       * 功能说明：注册并应用 apply 相关流程；使用场景由所在模块及调用位置决定。
       * @param ctx （Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。
       * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 apply(ctx)，并按返回类型处理结果。
       */
      apply(ctx: Context) { innerFiber = ctx.plugin({ name: 'inner', apply() {} }) },
    })
    fibers.push(outer)
    await outer.await()
    /**
     * 常量说明：innerUid 用于处理 innerUid 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const innerUid = innerFiber?.uid
    if (innerFiber === undefined || innerUid === null || innerUid === undefined) {
      throw new Error('nested plugin did not register a uid')
    }
    observers.push(publishHostCordisTree(host, inspector.source, { maxNodes: 100, maxBytes: 64 * 1_024 }))
    cdp = await CdpClient.connect(inspector.endpoint.webSocketDebuggerUrl)

    // Default document depth ends at the first Fiber layer: children withheld, count advertised.
    /**
     * 变量说明：outerNode 用于处理 outerNode 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let outerNode: CdpNode | undefined
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(async () => {
      /**
       * 常量说明：document 用于处理 document 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const document = (await cdp!.call('DOM.getDocument')).result?.root as CdpNode
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：node（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(node)，并按返回类型处理结果。
       */
      outerNode = hostContainer(document)?.children?.[0]?.children
        ?.find(node => node.localName === 'fiber' && node.attributes?.includes(String(outer.uid)))
      expect(outerNode).toBeDefined()
    })
    expect(outerNode?.children).toBeUndefined()
    expect(outerNode?.childNodeCount).toBe(1)

    // Expanding serves exactly one more level by default.
    /**
     * 变量说明：offset 用于处理 offset 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let offset = cdp.events.length
    await cdp.call('DOM.requestChildNodes', { nodeId: outerNode!.nodeId })
    /**
     * 常量说明：expanded 用于处理 expanded 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
     * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
     */
    const expanded = cdp.events.slice(offset).find(event => event.method === 'DOM.setChildNodes')
    expect(expanded?.params?.parentId).toBe(outerNode!.nodeId)
    /**
     * 常量说明：outerContext 用于处理 outerContext 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const outerContext = (expanded?.params?.nodes as CdpNode[])[0]
    expect(outerContext).toMatchObject({ localName: 'context', childNodeCount: 1 })
    expect(outerContext?.children).toBeUndefined()

    // Expand-recursively requests the entire subtree.
    offset = cdp.events.length
    await cdp.call('DOM.requestChildNodes', { nodeId: outerNode!.nodeId, depth: -1 })
    /**
     * 常量说明：recursive 用于处理 recursive 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
     * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
     */
    const recursive = cdp.events.slice(offset).find(event => event.method === 'DOM.setChildNodes')
    /**
     * 常量说明：recursiveContext 用于处理 recursiveContext 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const recursiveContext = (recursive?.params?.nodes as CdpNode[])[0]
    expect(recursiveContext?.children?.[0]).toMatchObject({
      localName: 'fiber',
      attributes: ['uid', String(innerUid)],
    })
    expect((await cdp.call('DOM.getDocument', { depth: 0 })).error?.message).toContain('depth')

    // A NodeId leaving through search or object lookup pushes the not-yet-sent ancestor levels first.
    secondCdp = await CdpClient.connect(inspector.endpoint.webSocketDebuggerUrl)
    await secondCdp.call('Runtime.enable')
    /**
     * 常量说明：secondDocument 用于处理 secondDocument 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const secondDocument = (await secondCdp.call('DOM.getDocument')).result?.root as CdpNode
    /**
     * 常量说明：secondOuter 用于处理 secondOuter 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：node（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(node)，并按返回类型处理结果。
     */
    const secondOuter = walk(secondDocument).find(node => node.attributes?.includes(String(outer.uid)))
    /**
     * 常量说明：described 用于处理 described 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const described = (await secondCdp.call('DOM.describeNode', { nodeId: secondOuter?.nodeId })).result?.node as CdpNode
    expect(described.children?.[0]?.localName).toBe('context')
    expect(described.children?.[0]?.children).toBeUndefined()

    /**
     * 常量说明：search 用于处理 search 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const search = await secondCdp.call('DOM.performSearch', { query: `uid=${JSON.stringify(String(innerUid))}` })
    expect(search.result?.resultCount).toBe(1)
    offset = secondCdp.events.length
    /**
     * 常量说明：results 用于处理 results 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const results = await secondCdp.call('DOM.getSearchResults', {
      searchId: search.result?.searchId,
      fromIndex: 0,
      toIndex: 1,
    })
    /**
     * 常量说明：innerNodeId 用于处理 innerNodeId 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const innerNodeId = (results.result?.nodeIds as number[])[0]
    /**
     * 常量说明：pushed 用于处理 pushed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
     * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
     */
    const pushed = secondCdp.events.slice(offset).filter(event => event.method === 'DOM.setChildNodes')
    expect(pushed).toHaveLength(2)
    await expect(secondCdp.call('DOM.getAttributes', { nodeId: innerNodeId })).resolves.toMatchObject({
      result: { attributes: ['uid', String(innerUid)] },
    })

    Reflect.set(globalThis, '__cordisHostProbe', innerFiber)
    /**
     * 常量说明：evaluated 用于处理 evaluated 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const evaluated = await secondCdp.call('Runtime.evaluate', { expression: 'globalThis.__cordisHostProbe' })
    expect(evaluated.result?.result).toMatchObject({ subtype: 'node', className: 'Fiber' })
    offset = secondCdp.events.length
    await expect(secondCdp.call('DOM.requestNode', {
      objectId: (evaluated.result?.result as Record<string, unknown>).objectId,
    })).resolves.toMatchObject({ result: { nodeId: innerNodeId } })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
     * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
     */
    expect(secondCdp.events.slice(offset).some(event => event.method === 'DOM.setChildNodes')).toBe(false)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('restores a disconnected Client tree from a new transport generation', async () => {
    inspector = await startInspector({
      port: 0,
      captureFetch: false,
      maxCordisNodes: 100,
      clientReconnectBaseMs: 10,
      clientReconnectMaxMs: 20,
    })
    clientSource = await InspectorClientFixture.start(inspector.endpoint.client, { label: 'Reconnect Client' })
    cdp = await CdpClient.connect(inspector.endpoint.webSocketDebuggerUrl)
    await cdp.call('Runtime.enable')

    /**
     * 变量说明：document 用于处理 document 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let document: CdpNode | undefined
    /**
     * 变量说明：contextId 用于处理 contextId 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let contextId: number | undefined
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(async () => {
      document = (await cdp!.call('DOM.getDocument')).result?.root as CdpNode
      expect(clientContainers(document)).toHaveLength(1)
      /**
       * 常量说明：created 用于处理 created 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
       * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
       */
      const created = cdp!.events.find(event => event.method === 'Runtime.executionContextCreated'
        && String((event.params?.context as { name?: string } | undefined)?.name).startsWith('Client'))
      contextId = (created?.params?.context as { id?: number } | undefined)?.id
      expect(contextId).toBeTypeOf('number')
    })
    /**
     * 常量说明：initialTree 用于处理 initialTree 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const initialTree = (await cdp.call('DSHInspector.getCordisTree')).result?.tree as {
      clients: Array<{ source: { sourceId: string } }>
    }
    /**
     * 常量说明：sourceId 用于处理 sourceId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const sourceId = initialTree.clients[0]?.source.sourceId
    /**
     * 常量说明：eventOffset 用于处理 eventOffset 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const eventOffset = cdp.events.length
    await clientSource.disconnect()

    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => {
      /**
       * 常量说明：events 用于处理 events 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const events = cdp!.events.slice(eventOffset)
      /**
       * 常量说明：destroyed 用于处理 destroyed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
       * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
       */
      const destroyed = events.findIndex(event => event.method === 'Runtime.executionContextDestroyed'
        && event.params?.executionContextId === contextId)
      /**
       * 常量说明：created 用于处理 created 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
       * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
       */
      const created = events.findIndex((event) => {
        if (event.method !== 'Runtime.executionContextCreated') return false
        /**
         * 常量说明：context 用于处理 context 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const context = event.params?.context as { id?: number } | undefined
        return typeof context?.id === 'number' && context.id !== contextId
      })
      /**
       * 常量说明：removed 用于处理 removed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
       * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
       */
      const removed = events.findIndex(event => event.method === 'DOM.childNodeRemoved')
      /**
       * 常量说明：inserted 用于处理 inserted 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
       * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
       */
      const inserted = events.findIndex(event => event.method === 'DOM.childNodeInserted')
      expect(destroyed).toBeGreaterThanOrEqual(0)
      expect(created).toBeGreaterThan(destroyed)
      expect(removed).toBeGreaterThan(created)
      expect(inserted).toBeGreaterThan(removed)
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
       * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
       */
      expect(events.slice(0, created).some(event => event.method?.startsWith('DOM.'))).toBe(false)
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
       * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
       */
      expect(events.some(event => event.method === 'DOM.documentUpdated')).toBe(false)
    })

    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(async () => {
      /**
       * 常量说明：current 用于处理 current 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const current = (await cdp!.call('DOM.getDocument')).result?.root as CdpNode
      expect(clientContainers(current)).toHaveLength(1)
      expect(clientContainers(current)[0]?.children?.[0]?.localName).toBe('context')
      /**
       * 常量说明：tree 用于处理 tree 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const tree = (await cdp!.call('DSHInspector.getCordisTree')).result?.tree as {
        clients: Array<{
          source: { sourceId: string }
          connection: { state: string }
        }>
      }
      expect(tree.clients).toHaveLength(1)
      expect(tree.clients[0]?.source.sourceId).toBe(sourceId)
      expect(tree.clients[0]?.connection.state).toBe('connected')
    })
  })
})

/**
 * 功能说明：处理 source 相关流程；使用场景由所在模块及调用位置决定。
 * @param sourceId （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param generation （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns InspectorSourceDescriptor；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 source(sourceId, generation)，并按返回类型处理结果。
 */
function source(sourceId: string, generation: string): InspectorSourceDescriptor {
  return {
    sourceId: inspectorId<'InspectorSourceId'>(sourceId, 'sourceId'),
    generation: inspectorId<'InspectorSourceGeneration'>(generation, 'generation'),
    kind: 'client',
    label: sourceId,
    timeOriginMs: 0,
    capabilities: [],
  }
}

/**
 * 功能说明：处理 hostContainer 相关流程；使用场景由所在模块及调用位置决定。
 * @param root （CdpNode | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns CdpNode | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 hostContainer(root)，并按返回类型处理结果。
 */
function hostContainer(root: CdpNode | undefined): CdpNode | undefined {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：node（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(node)，并按返回类型处理结果。
   */
  return root?.children?.find(node => node.localName === 'host')
}

/**
 * 功能说明：处理 clientContainers 相关流程；使用场景由所在模块及调用位置决定。
 * @param root （CdpNode | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns CdpNode[]；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 clientContainers(root)，并按返回类型处理结果。
 */
function clientContainers(root: CdpNode | undefined): CdpNode[] {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：node（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(node)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：node（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(node)，并按返回类型处理结果。
   */
  return root?.children?.find(node => node.localName === 'clients')?.children
    ?.filter(node => node.localName === 'client') ?? []
}

/**
 * 功能说明：处理 walk 相关流程；使用场景由所在模块及调用位置决定。
 * @param root （CdpNode）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns CdpNode[]；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 walk(root)，并按返回类型处理结果。
 */
function walk(root: CdpNode): CdpNode[] {
  return [root, ...(root.children ?? []).flatMap(walk)]
}

/**
 * 功能说明：处理 treeNodes 相关流程；使用场景由所在模块及调用位置决定。
 * @param root （CordisTreeNode）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns CordisTreeNode[]；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 treeNodes(root)，并按返回类型处理结果。
 */
function treeNodes(root: CordisTreeNode): CordisTreeNode[] {
  return [root, ...root.children.flatMap(treeNodes)]
}

/**
 * 功能说明：处理 rawText 相关流程；使用场景由所在模块及调用位置决定。
 * @param data （RawData）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 rawText(data)，并按返回类型处理结果。
 */
function rawText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8')
  return Buffer.from(data).toString('utf8')
}

/**
 * 功能说明：处理 asJson 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （object）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns InspectorJsonValue；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 asJson(value)，并按返回类型处理结果。
 */
function asJson(value: object): InspectorJsonValue {
  return value as unknown as InspectorJsonValue
}
