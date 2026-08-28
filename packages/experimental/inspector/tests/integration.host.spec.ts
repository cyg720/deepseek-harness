/** Host-driven integration over an isolated Client fixture.
 * @remarks 文件说明：文件职责：验证 experimental/inspector 中 integration host spec
 * 相关行为与失败场景。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import { createServer, type Server } from 'node:http'
import { createContext, runInContext } from 'node:vm'
import WebSocket, { type RawData } from 'ws'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startInspector, type InspectorHandle } from '../src/host/bridge/controller.ts'
import { InspectorClientFixture } from './fixtures/client-source.host.ts'

interface CdpMessage {
  readonly id?: number
  readonly method?: string
  readonly params?: Record<string, unknown>
  readonly result?: Record<string, unknown>
  readonly error?: { message: string }
}

/**
 * 类说明：TestCdpClient 用于集中封装 处理 TestCdpClient 相关状态与行为。
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。
 * 使用场景：由 experimental/inspector 在对应插件或业务生命周期内创建和调用。
 */
class TestCdpClient {
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
   * 功能说明：处理 TestCdpClient 相关流程；使用场景由所在模块及调用位置决定。
   * @param socket （WebSocket）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new TestCdpClient(socket) 创建实例，并在所属生命周期内使用。
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
   * @returns Promise<TestCdpClient>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 connect(url)，并按返回类型处理结果。
   */
  static async connect(url: string): Promise<TestCdpClient> {
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
    return new TestCdpClient(socket)
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
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP call timed out: ${method}`))
      }, 5_000)
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
    const closed = new Promise<void>((resolve) => { /**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
this.socket.once('close', () => { resolve() }) })
    this.socket.close()
    await closed
  }
}

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('experimental Inspector real Worker', () => {
  /**
   * 变量说明：inspector 用于处理 inspector 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let inspector: InspectorHandle | undefined
  /**
   * 变量说明：cdp 用于处理 cdp 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let cdp: TestCdpClient | undefined
  /**
   * 变量说明：secondCdp 用于处理 secondCdp 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let secondCdp: TestCdpClient | undefined
  /**
   * 变量说明：client 用于处理 client 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let client: InspectorClientFixture | undefined
  /**
   * 变量说明：server 用于处理 server 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let server: Server | undefined

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  afterEach(async () => {
    await client?.close()
    client = undefined
    await cdp?.close()
    cdp = undefined
    await secondCdp?.close()
    secondCdp = undefined
    await inspector?.close()
    inspector = undefined
    if (server !== undefined) /**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
 */
await new Promise<void>((resolve) => { /**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
server!.close(() => { resolve() }) })
    server = undefined
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('switches between Host and Client contexts and routes Client RemoteObjects', async () => {
    inspector = await startInspector({ port: 0, captureFetch: false, clientReconnectBaseMs: 10, clientReconnectMaxMs: 20 })
    cdp = await TestCdpClient.connect(inspector.endpoint.webSocketDebuggerUrl)
    inspector.source.publish('host/probe', { value: 1 })
    client = await InspectorClientFixture.start(inspector.endpoint.client, { label: 'Test Client' })
    await client.publish('client/probe', { value: 2 })

    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(async () => {
      /**
       * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const response = await cdp!.call('DSHInspector.getSources')
      /**
       * 常量说明：sources 用于处理 sources 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const sources = response.result?.sources as Array<{ kind: string; topics: Record<string, number> }>
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：source（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(source)，并按返回类型处理结果。
       */
      expect(sources.find(source => source.kind === 'host')?.topics).toEqual({ 'host/probe': 1 })
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：source（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(source)，并按返回类型处理结果。
       */
      expect(sources.find(source => source.kind === 'client')?.topics).toMatchObject({ 'client/probe': 1 })
    })

    ;(globalThis as Record<string, unknown>).__inspectorHostProbe = 73
    expect((await cdp.call('Runtime.enable')).error).toBeUndefined()
    /**
     * 变量说明：clientContextId 用于处理 clientContextId 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let clientContextId: number | undefined
    /**
     * 变量说明：clientUniqueContextId 用于处理 clientUniqueContextId 相关数据，作用于当前作用域；
     * 其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let clientUniqueContextId: string | undefined
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => {
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：context（由 TypeScript
       * 根据调用位置推断的类型）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
       * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(context)，
       * 并按返回类型处理结果。
       */
      expect(runtimeContexts(cdp!).some(context => context.name === 'Host')).toBe(true)
      /**
       * 常量说明：clientContext 用于处理 clientContext 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
       * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
       * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：context（由 TypeScript
       * 根据调用位置推断的类型）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
       * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(context)，
       * 并按返回类型处理结果。
       */
      const clientContext = cdp!.events
        .filter(event => event.method === 'Runtime.executionContextCreated')
        .map(event => event.params?.context as Record<string, unknown> | undefined)
        .find(context => String(context?.name).startsWith('Client —'))
      expect(clientContext).toBeDefined()
      clientContextId = clientContext?.id as number
      clientUniqueContextId = clientContext?.uniqueId as string
    })
    if (clientContextId === undefined || clientUniqueContextId === undefined) {
      throw new Error('Client execution context was not announced')
    }
    /**
     * 常量说明：hostEvaluated 用于处理 hostEvaluated 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const hostEvaluated = await cdp.call('Runtime.evaluate', {
      expression: 'globalThis.__inspectorHostProbe',
      returnByValue: true,
    })
    expect(hostEvaluated.result?.result).toMatchObject({ type: 'number', value: 73 })

    await client.setGlobal('__inspectorClientProbe', { value: 17, nested: { ready: true } })
    /**
     * 常量说明：clientEvaluated 用于处理 clientEvaluated 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const clientEvaluated = await cdp.call('Runtime.evaluate', {
      expression: 'globalThis.__inspectorClientProbe',
      contextId: clientContextId,
      objectGroup: 'console',
      generatePreview: true,
    })
    /**
     * 常量说明：clientObject 用于处理 clientObject 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const clientObject = clientEvaluated.result?.result as Record<string, unknown>
    expect(clientObject).toMatchObject({ type: 'object', className: 'Object' })
    expect(String(clientObject.objectId)).toMatch(/^runtime:/u)

    /**
     * 常量说明：properties 用于处理 properties 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const properties = await cdp.call('Runtime.getProperties', {
      objectId: clientObject.objectId,
      ownProperties: true,
    })
    /**
     * 常量说明：propertyRows 用于处理 propertyRows 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const propertyRows = recordArray(properties.result?.result)
    /**
     * 常量说明：valueProperty 用于处理 valueProperty 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：property（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(property)，并按返回类型处理结果。
     */
    const valueProperty = propertyRows.find(property => property.name === 'value')
    /**
     * 常量说明：nestedProperty 用于处理 nestedProperty 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：property（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(property)，并按返回类型处理结果。
     */
    const nestedProperty = propertyRows.find(property => property.name === 'nested')
    expect(asRecord(valueProperty?.value)).toMatchObject({ type: 'number', value: 17 })
    expect(asRecord(nestedProperty?.value).type).toBe('object')

    /**
     * 常量说明：called 用于处理 called 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const called = await cdp.call('Runtime.callFunctionOn', {
      objectId: clientObject.objectId,
      functionDeclaration: 'function (increment) { return this.value + increment }',
      arguments: [{ value: 5 }],
      returnByValue: true,
    })
    expect(called.result?.result).toMatchObject({ type: 'number', value: 22 })

    /**
     * 常量说明：hostObject 用于处理 hostObject 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const hostObject = await cdp.call('Runtime.evaluate', { expression: '({ realm: "host" })' })
    /**
     * 常量说明：hostObjectId 用于处理 hostObjectId 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const hostObjectId = asRecord(hostObject.result?.result).objectId
    expect((await cdp.call('Runtime.callFunctionOn', {
      executionContextId: clientContextId,
      functionDeclaration: 'function (value) { return value }',
      arguments: [{ objectId: hostObjectId }],
    })).error?.message).toContain('between realms')
    expect((await cdp.call('Runtime.callFunctionOn', {
      objectId: hostObjectId,
      functionDeclaration: 'function (value) { return value }',
      arguments: [{ objectId: clientObject.objectId }],
    })).error?.message).toContain('between realms')
    expect((await cdp.call('Runtime.queryObjects', {
      prototypeObjectId: clientObject.objectId,
    })).error?.message).toContain('Client realm has no native CDP transport')

    /**
     * 常量说明：awaited 用于处理 awaited 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const awaited = await cdp.call('Runtime.evaluate', {
      expression: 'Promise.resolve({ realm: "client" })',
      contextId: clientContextId,
      awaitPromise: true,
      returnByValue: true,
    })
    expect(awaited.result?.result).toMatchObject({ type: 'object', value: { realm: 'client' } })

    /**
     * 常量说明：uniquelyRouted 用于处理 uniquelyRouted 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const uniquelyRouted = await cdp.call('Runtime.evaluate', {
      expression: '6 * 7',
      uniqueContextId: clientUniqueContextId,
      returnByValue: true,
    })
    expect(uniquelyRouted.result?.result).toMatchObject({ type: 'number', value: 42 })

    expect((await cdp.call('Runtime.releaseObject', { objectId: clientObject.objectId })).error).toBeUndefined()
    expect((await cdp.call('Runtime.getProperties', { objectId: clientObject.objectId })).error).toBeDefined()

    /**
     * 常量说明：thrown 用于处理 thrown 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const thrown = await cdp.call('Runtime.evaluate', {
      expression: 'throw new Error("client failure")',
      contextId: clientContextId,
    })
    expect(asRecord(thrown.result?.exceptionDetails)).toMatchObject({
      text: 'Uncaught',
      executionContextId: clientContextId,
    })

    /**
     * 常量说明：pendingEvaluation 用于处理 pendingEvaluation 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const pendingEvaluation = cdp.call('Runtime.evaluate', {
      expression: 'new Promise(() => {})',
      contextId: clientContextId,
      awaitPromise: true,
    })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
     */
    await new Promise<void>((resolve) => { setTimeout(resolve, 10) })
    await client.close()
    client = undefined
    expect((await pendingEvaluation).error).toBeDefined()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => {
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
       * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
       */
      expect(cdp!.events.some(event =>
        event.method === 'Runtime.executionContextDestroyed'
        && event.params?.executionContextId === clientContextId)).toBe(true)
    })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('isolates Client object ids and object groups by DevTools connection', async () => {
    inspector = await startInspector({ port: 0, captureFetch: false })
    client = await InspectorClientFixture.start(inspector.endpoint.client, { label: 'Shared Client' })
    cdp = await TestCdpClient.connect(inspector.endpoint.webSocketDebuggerUrl)
    secondCdp = await TestCdpClient.connect(inspector.endpoint.webSocketDebuggerUrl)
    await Promise.all([cdp.call('Runtime.enable'), secondCdp.call('Runtime.enable')])

    /**
     * 常量说明：firstContext 用于处理 firstContext 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const firstContext = await clientContext(cdp)
    /**
     * 常量说明：secondContext 用于处理 secondContext 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const secondContext = await clientContext(secondCdp)
    /**
     * 常量说明：first 用于处理 first 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const first = await cdp.call('Runtime.evaluate', {
      expression: '({ owner: "first" })',
      contextId: firstContext,
      objectGroup: 'console',
    })
    /**
     * 常量说明：second 用于处理 second 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const second = await secondCdp.call('Runtime.evaluate', {
      expression: '({ owner: "second" })',
      contextId: secondContext,
      objectGroup: 'console',
    })
    /**
     * 常量说明：firstObjectId 用于处理 firstObjectId 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const firstObjectId = asRecord(first.result?.result).objectId
    /**
     * 常量说明：secondObjectId 用于处理 secondObjectId 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const secondObjectId = asRecord(second.result?.result).objectId
    expect(firstObjectId).not.toBe(secondObjectId)
    expect((await secondCdp.call('Runtime.getProperties', { objectId: firstObjectId })).error).toBeDefined()

    await cdp.close()
    cdp = undefined
    /**
     * 常量说明：secondProperties 用于处理 secondProperties 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const secondProperties = await secondCdp.call('Runtime.getProperties', {
      objectId: secondObjectId,
      ownProperties: true,
    })
    /**
     * 常量说明：owner 用于处理 owner 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：property（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(property)，并按返回类型处理结果。
     */
    const owner = recordArray(secondProperties.result?.result).find(property => property.name === 'owner')
    expect(asRecord(owner?.value).value).toBe('second')
    expect((await secondCdp.call('Runtime.releaseObjectGroup', { objectGroup: 'console' })).error).toBeUndefined()
    expect((await secondCdp.call('Runtime.getProperties', { objectId: secondObjectId })).error).toBeDefined()

    /**
     * 常量说明：beforeDisable 用于处理 beforeDisable 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const beforeDisable = await secondCdp.call('Runtime.evaluate', {
      expression: '({ retained: true })',
      contextId: secondContext,
    })
    /**
     * 常量说明：disabledObjectId 用于处理 disabledObjectId 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const disabledObjectId = asRecord(beforeDisable.result?.result).objectId
    expect((await secondCdp.call('Runtime.disable')).error).toBeUndefined()
    expect((await secondCdp.call('Runtime.enable')).error).toBeUndefined()
    expect((await secondCdp.call('Runtime.getProperties', { objectId: disabledObjectId })).error).toBeDefined()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('cancels Client Runtime work when the Worker deadline expires', async () => {
    inspector = await startInspector({ port: 0, captureFetch: false, clientRuntimeTimeoutMs: 20 })
    client = await InspectorClientFixture.start(inspector.endpoint.client, { label: 'Timeout Client' })
    cdp = await TestCdpClient.connect(inspector.endpoint.webSocketDebuggerUrl)
    await cdp.call('Runtime.enable')
    /**
     * 常量说明：contextId 用于处理 contextId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const contextId = await clientContext(cdp)

    /**
     * 常量说明：timedOut 用于处理 timedOut 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const timedOut = await cdp.call('Runtime.evaluate', {
      expression: 'new Promise(() => {})',
      contextId,
      awaitPromise: true,
    })
    expect(timedOut.error?.message).toContain('timed out after 20ms')
    expect((await cdp.call('Runtime.evaluate', {
      expression: '42',
      contextId,
      returnByValue: true,
    })).result?.result).toMatchObject({ type: 'number', value: 42 })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('preserves native Host execution-context selectors', async () => {
    inspector = await startInspector({ port: 0, captureFetch: false })
    cdp = await TestCdpClient.connect(inspector.endpoint.webSocketDebuggerUrl)
    await cdp.call('Runtime.enable')
    /**
     * 常量说明：context 用于处理 context 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const context = createContext({}, { name: 'Inspector VM Context' })
    runInContext('globalThis.vmMarker = "selected-vm"; let vmLexicalMarker = 1', context)

    /**
     * 变量说明：contextId 用于处理 contextId 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let contextId: number | undefined
    /**
     * 变量说明：uniqueContextId 用于处理 uniqueContextId 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let uniqueContextId: string | undefined
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => {
      /**
       * 常量说明：created 用于处理 created 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：candidate（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(candidate)，并按返回类型处理结果。
       */
      const created = runtimeContexts(cdp!).find(candidate => candidate.name === 'Inspector VM Context')
      contextId = created?.id as number | undefined
      uniqueContextId = created?.uniqueId as string | undefined
      expect(contextId).toBeTypeOf('number')
      expect(uniqueContextId).toBeTypeOf('string')
    })
    /**
     * 常量说明：evaluated 用于处理 evaluated 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const evaluated = await cdp.call('Runtime.evaluate', {
      expression: 'globalThis.vmMarker',
      contextId,
      returnByValue: true,
    })
    expect(evaluated.result?.result).toMatchObject({ type: 'string', value: 'selected-vm' })
    expect((await cdp.call('Runtime.evaluate', {
      expression: 'globalThis.vmMarker',
      uniqueContextId,
      returnByValue: true,
    })).result?.result).toMatchObject({ type: 'string', value: 'selected-vm' })
    expect((await cdp.call('Runtime.callFunctionOn', {
      executionContextId: contextId,
      functionDeclaration: 'function () { return globalThis.vmMarker }',
      returnByValue: true,
    })).result?.result).toMatchObject({ type: 'string', value: 'selected-vm' })
    expect((await cdp.call('Runtime.globalLexicalScopeNames', { executionContextId: contextId })).result?.names)
      .toContain('vmLexicalMarker')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('uses the same Runtime value model for Host and Client realms', async () => {
    inspector = await startInspector({ port: 0, captureFetch: false })
    client = await InspectorClientFixture.start(inspector.endpoint.client, { label: 'Compatibility Client' })
    cdp = await TestCdpClient.connect(inspector.endpoint.webSocketDebuggerUrl)
    await cdp.call('Runtime.enable')
    /**
     * 常量说明：clientContextId 用于处理 clientContextId 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const clientContextId = await clientContext(cdp)

    /**
     * 变量说明：name、contextId 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const [name, contextId] of [['Host', undefined], ['Client', clientContextId]] as const) {
      /**
       * 常量说明：select 用于处理 select 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const select = contextId === undefined ? {} : { contextId }
      /**
       * 常量说明：nan 用于处理 nan 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const nan = await cdp.call('Runtime.evaluate', { expression: 'NaN', ...select })
      expect(nan.result?.result, name).toMatchObject({ type: 'number', unserializableValue: 'NaN' })

      /**
       * 常量说明：array 用于处理 array 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const array = await cdp.call('Runtime.evaluate', {
        expression: '[1, 2]',
        objectGroup: `compat-${name}`,
        ...select,
      })
      /**
       * 常量说明：arrayObject 用于处理 arrayObject 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const arrayObject = asRecord(array.result?.result)
      expect(arrayObject, name).toMatchObject({ type: 'object', subtype: 'array', className: 'Array' })
      /**
       * 常量说明：properties 用于处理 properties 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const properties = await cdp.call('Runtime.getProperties', {
        objectId: arrayObject.objectId,
        ownProperties: true,
      })
      /**
       * 常量说明：first 用于处理 first 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：property（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(property)，并按返回类型处理结果。
       */
      const first = recordArray(properties.result?.result).find(property => property.name === '0')
      expect(first, name).toMatchObject({ configurable: true, enumerable: true, writable: true })
      expect(asRecord(first?.value), name).toMatchObject({ type: 'number', value: 1 })

      /**
       * 常量说明：thrown 用于处理 thrown 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const thrown = await cdp.call('Runtime.evaluate', {
        expression: 'throw new TypeError("realm-compatibility")',
        ...select,
      })
      expect(thrown.result?.result, name).toMatchObject({ type: 'object', subtype: 'error' })
      expect(thrown.result?.exceptionDetails, name).toMatchObject({ text: 'Uncaught' })

      expect((await cdp.call('Runtime.releaseObjectGroup', { objectGroup: `compat-${name}` })).error).toBeUndefined()
      expect((await cdp.call('Runtime.getProperties', { objectId: arrayObject.objectId })).error).toBeDefined()
    }

    expect((await cdp.call('Runtime.evaluate', {
      expression: '1 + 1',
      throwOnSideEffect: true,
    })).result?.result).toMatchObject({ type: 'number', value: 2 })
    expect((await cdp.call('Runtime.evaluate', {
      expression: '1 + 1',
      contextId: clientContextId,
      throwOnSideEffect: true,
    })).error?.message).toContain('does not support throwOnSideEffect')
    expect((await cdp.call('Runtime.compileScript', {
      expression: '1 + 1',
      sourceURL: 'client-eval.js',
      persistScript: true,
      executionContextId: clientContextId,
    })).error?.message).toContain('Client realm has no native CDP transport')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('forwards Client Console objects through isolated realm sessions', async () => {
    inspector = await startInspector({ port: 0, captureFetch: false })
    client = await InspectorClientFixture.start(inspector.endpoint.client, { label: 'Console Client' })
    cdp = await TestCdpClient.connect(inspector.endpoint.webSocketDebuggerUrl)
    secondCdp = await TestCdpClient.connect(inspector.endpoint.webSocketDebuggerUrl)
    await Promise.all([cdp.call('Runtime.enable'), secondCdp.call('Runtime.enable')])
    /**
     * 常量说明：firstContext 用于处理 firstContext 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const firstContext = await clientContext(cdp)
    /**
     * 常量说明：secondContext 用于处理 secondContext 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const secondContext = await clientContext(secondCdp)
    /**
     * 常量说明：value 用于处理 value 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const value = { owner: 'client-console' }
    /**
     * 常量说明：marker 用于处理 marker 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const marker = 'client-console-event'
    await client.log(value, marker)
    /**
     * 变量说明：firstEvent 用于处理 firstEvent 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let firstEvent: CdpMessage | undefined
    /**
     * 变量说明：secondEvent 用于处理 secondEvent 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let secondEvent: CdpMessage | undefined
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => {
      firstEvent = consoleEvent(cdp!, firstContext, marker)
      secondEvent = consoleEvent(secondCdp!, secondContext, marker)
      expect(firstEvent).toBeDefined()
      expect(secondEvent).toBeDefined()
    })
    /**
     * 常量说明：firstObjectId 用于处理 firstObjectId 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const firstObjectId = asRecord(recordArray(firstEvent!.params?.args)[0]).objectId
    /**
     * 常量说明：secondObjectId 用于处理 secondObjectId 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const secondObjectId = asRecord(recordArray(secondEvent!.params?.args)[0]).objectId
    expect(firstObjectId).toBeTypeOf('string')
    expect(secondObjectId).toBeTypeOf('string')
    expect(firstObjectId).not.toBe(secondObjectId)
    expect((await secondCdp.call('Runtime.getProperties', { objectId: firstObjectId })).error).toBeDefined()

    /**
     * 常量说明：secondProperties 用于处理 secondProperties 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const secondProperties = await secondCdp.call('Runtime.getProperties', {
      objectId: secondObjectId,
      ownProperties: true,
    })
    /**
     * 常量说明：owner 用于处理 owner 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：property（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(property)，并按返回类型处理结果。
     */
    const owner = recordArray(secondProperties.result?.result).find(property => property.name === 'owner')
    expect(asRecord(owner?.value).value).toBe('client-console')

    expect((await cdp.call('Runtime.discardConsoleEntries')).error).toBeUndefined()
    expect((await cdp.call('Runtime.getProperties', { objectId: firstObjectId })).error).toBeDefined()
    expect((await secondCdp.call('Runtime.getProperties', { objectId: secondObjectId })).error).toBeUndefined()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('projects a chunked Client bundle as read-only Debugger source', async () => {
    /**
     * 常量说明：sourceText 用于处理 sourceText 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const sourceText = `const clientSourceMarker = 42\n/*${'x'.repeat(150_000)}*/\n`
    /**
     * 常量说明：sourceMap 用于处理 sourceMap 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const sourceMap = JSON.stringify({ version: 3, sources: ['client/index.ts'], mappings: 'AAAA' })
    /**
     * 常量说明：sourceUrl 用于处理 sourceUrl 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const sourceUrl = 'http://client.test/plugins/inspector/client.js?rev=test'
    /**
     * 常量说明：sourceMapUrl 用于处理 sourceMapUrl 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const sourceMapUrl = 'http://client.test/plugins/inspector/client.js.map?rev=test'
    inspector = await startInspector({ port: 0, captureFetch: false, maxClientSourceBytes: 1_000_000 })
    client = await InspectorClientFixture.start(inspector.endpoint.client, {
      label: 'Source Client',
      sourceCatalog: { sourceText, sourceMap, sourceUrl, sourceMapUrl },
    })
    cdp = await TestCdpClient.connect(inspector.endpoint.webSocketDebuggerUrl)
    await cdp.call('Runtime.enable')
    /**
     * 常量说明：contextId 用于处理 contextId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const contextId = await clientContext(cdp)
    expect((await cdp.call('Debugger.enable')).error).toBeUndefined()

    /**
     * 变量说明：script 用于处理 script 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let script: CdpMessage | undefined
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => {
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
       * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
       */
      script = cdp!.events.find(event => event.method === 'Debugger.scriptParsed'
        && event.params?.url === sourceUrl)
      expect(script).toBeDefined()
    })
    expect(script?.params).toMatchObject({
      executionContextId: contextId,
      sourceMapURL: sourceMapUrl,
      hash: 'test',
      isModule: false,
      length: sourceText.length,
    })
    /**
     * 常量说明：scriptId 用于处理 scriptId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const scriptId = script?.params?.scriptId
    expect(scriptId).toBeTypeOf('string')
    await expect(cdp.call('Debugger.getScriptSource', { scriptId })).resolves.toMatchObject({
      result: { scriptSource: sourceText },
    })
    await expect(cdp.call('Debugger.searchInContent', {
      scriptId,
      query: 'clientSourceMarker',
      caseSensitive: true,
    })).resolves.toMatchObject({
      result: { result: [{ lineNumber: 0, lineContent: 'const clientSourceMarker = 42' }] },
    })
    expect((await cdp.call('Debugger.setBreakpointByUrl', { url: sourceUrl, lineNumber: 0 })).error?.message)
      .toContain('Client native debugging is unavailable')
    expect((await cdp.call('Debugger.setBreakpointByUrl', {
      urlRegex: 'client\\.js',
      lineNumber: 0,
    })).error?.message).toContain('Client native debugging is unavailable')
    expect((await cdp.call('Debugger.setBreakpointByUrl', {
      scriptHash: 'test',
      lineNumber: 0,
    })).error?.message).toContain('Client native debugging is unavailable')
    expect((await cdp.call('Debugger.evaluateOnCallFrame', {
      callFrameId: 'client:unsupported-frame',
      expression: '1',
    })).error?.message).toContain('Client native debugging is unavailable')
  }, 15_000)

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('projects full Host fetch data through the Network domain', async () => {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：request（由 TypeScript
     * 根据调用位置推断的类型）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；参数：response（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(request, response)，
     * 并按返回类型处理结果。
     */
    server = createServer((request, response) => {
      /**
       * 变量说明：body 用于处理 body 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
       */
      let body = ''
      request.setEncoding('utf8')
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：chunk（string）：提供本次调用所需的数据；
       * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
       * 典型用法：在完成前置校验后调用 匿名回调(chunk)，并按返回类型处理结果。
       */
      request.on('data', (chunk: string) => { body += chunk })
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      request.on('end', () => {
        response.writeHead(201, { authorization: 'response-secret', 'content-type': 'application/json' })
        response.end(JSON.stringify({ body }))
      })
    })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
     */
    await new Promise<void>((resolve) => { /**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
server!.listen(0, '127.0.0.1', () => { resolve() }) })
    /**
     * 常量说明：port 用于处理 port 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const port = (server.address() as import('node:net').AddressInfo).port
    inspector = await startInspector({ port: 0 })
    cdp = await TestCdpClient.connect(inspector.endpoint.webSocketDebuggerUrl)
    await cdp.call('Network.enable')

    /**
     * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const response = await fetch(`http://127.0.0.1:${String(port)}/capture?secret=query`, {
      method: 'POST',
      headers: { authorization: 'Bearer request-secret' },
      body: 'request-body',
    })
    expect(await response.json()).toEqual({ body: 'request-body' })

    /**
     * 变量说明：started 用于处理 started 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let started: CdpMessage | undefined
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => {
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
       * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
       */
      started = cdp!.events.find(event =>
        event.method === 'Network.requestWillBeSent'
        && String((event.params?.request as Record<string, unknown> | undefined)?.url).includes('/capture'))
      expect(started).toBeDefined()
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
       * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
       */
      expect(cdp!.events.some(event =>
        event.method === 'Network.loadingFinished'
        && event.params?.requestId === started!.params?.requestId)).toBe(true)
    })
    /**
     * 常量说明：request 用于处理 request 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const request = started!.params?.request as Record<string, unknown>
    expect(request.url).toBe(`http://127.0.0.1:${String(port)}/capture?secret=query`)
    expect(request.headers).toMatchObject({ authorization: 'Bearer request-secret' })
    /**
     * 常量说明：requestId 用于处理 requestId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const requestId = started!.params?.requestId
    /**
     * 常量说明：post 用于处理 post 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const post = await cdp.call('Network.getRequestPostData', { requestId })
    expect(post.result?.postData).toBe('request-body')
    /**
     * 常量说明：body 用于处理 body 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const body = await cdp.call('Network.getResponseBody', { requestId })
    expect(Buffer.from(String(body.result?.body), 'base64').toString('utf8')).toBe('{"body":"request-body"}')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('streams later Host fetch response chunks to an opted-in CDP connection', async () => {
    /**
     * 常量说明：continueResponse 用于处理 continueResponse 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const continueResponse = Promise.withResolvers<true>()
    /**
     * 常量说明：firstChunk 用于处理 firstChunk 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const firstChunk = 'data: first\n\n'
    /**
     * 常量说明：laterChunk 用于处理 laterChunk 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const laterChunk = 'event: update\nid: 2\ndata: second\ndata: line\n\n'
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_request（由 TypeScript
     * 根据调用位置推断的类型）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；参数：response（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(_request, response)，
     * 并按返回类型处理结果。
     */
    server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' })
      response.write(firstChunk)
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      void continueResponse.promise.then(() => { response.end(laterChunk) })
    })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
     */
    await new Promise<void>((resolve) => { /**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
server!.listen(0, '127.0.0.1', () => { resolve() }) })
    /**
     * 常量说明：port 用于处理 port 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const port = (server.address() as import('node:net').AddressInfo).port
    inspector = await startInspector({ port: 0 })
    cdp = await TestCdpClient.connect(inspector.endpoint.webSocketDebuggerUrl)
    await cdp.call('Network.enable')

    try {
      /**
       * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const response = await fetch(`http://127.0.0.1:${String(port)}/events`)
      /**
       * 变量说明：requestId 用于处理 requestId 相关数据，作用于当前作用域；其值可能随流程推进而变化，
       * 读写时需遵守声明类型和所在生命周期。
       */
      let requestId: string | undefined
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      await vi.waitFor(() => {
        /**
         * 常量说明：received 用于处理 received 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
         * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
         */
        const received = cdp!.events.find(event =>
          event.method === 'Network.responseReceived'
          && (event.params?.response as Record<string, unknown> | undefined)?.mimeType === 'text/event-stream')
        requestId = received?.params?.requestId as string | undefined
        expect(requestId).toBeTypeOf('string')
        expect(received?.params).toMatchObject({
          type: 'EventSource',
          response: { encodedDataLength: -1 },
        })
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
         * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
         */
        expect(cdp!.events.find(event =>
          event.method === 'Network.requestWillBeSent'
          && event.params?.requestId === requestId)?.params?.type).toBe('EventSource')
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
         * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
         */
        expect(cdp!.events.find(event =>
          event.method === 'Network.eventSourceMessageReceived'
          && event.params?.requestId === requestId)?.params).toMatchObject({
          eventName: 'message',
          eventId: '1',
          data: 'first',
        })
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
         * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
         */
        expect(cdp!.events.some(event =>
          event.method === 'Network.dataReceived'
          && event.params?.requestId === requestId)).toBe(true)
      })
      if (requestId === undefined) throw new Error('SSE request was not observed')

      /**
       * 常量说明：streaming 用于处理 streaming 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const streaming = await cdp.call('Network.streamResourceContent', { requestId })
      expect(Buffer.from(String(streaming.result?.bufferedData), 'base64').toString('utf8')).toBe(firstChunk)
      /**
       * 常量说明：laterEventOffset 用于处理 laterEventOffset 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const laterEventOffset = cdp.events.length
      continueResponse.resolve(true)
      expect(await response.text()).toBe(firstChunk + laterChunk)

      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      await vi.waitFor(() => {
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
         * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
         */
        expect(cdp!.events.some(event =>
          event.method === 'Network.loadingFinished'
          && event.params?.requestId === requestId)).toBe(true)
        /**
         * 常量说明：streamed 用于处理 streamed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
         * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
         */
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
         * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
         */
        const streamed = cdp!.events.slice(laterEventOffset)
          .filter(event => event.method === 'Network.dataReceived'
            && event.params?.requestId === requestId
            && typeof event.params?.data === 'string')
          .map(event => Buffer.from(String(event.params!.data), 'base64'))
        expect(Buffer.concat(streamed).toString('utf8')).toBe(laterChunk)
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
         * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
         */
        expect(cdp!.events.slice(laterEventOffset).find(event =>
          event.method === 'Network.eventSourceMessageReceived'
          && event.params?.requestId === requestId)?.params).toMatchObject({
          eventName: 'update',
          eventId: '2',
          data: 'second\nline',
        })
      })

      /**
       * 常量说明：body 用于处理 body 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const body = await cdp.call('Network.getResponseBody', { requestId })
      expect(Buffer.from(String(body.result?.body), 'base64').toString('utf8')).toBe(firstChunk + laterChunk)
    } finally {
      continueResponse.resolve(true)
    }
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('keeps captured EventSource data readable when the caller aborts after response headers', async () => {
    /**
     * 常量说明：eventStream 用于处理 eventStream 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const eventStream = 'data: first\n\ndata: [DONE]\n\n'
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_request（由 TypeScript
     * 根据调用位置推断的类型）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；参数：response（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(_request, response)，
     * 并按返回类型处理结果。
     */
    server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' })
      response.write(eventStream)
    })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
     */
    await new Promise<void>((resolve) => { /**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
server!.listen(0, '127.0.0.1', () => { resolve() }) })
    /**
     * 常量说明：port 用于处理 port 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const port = (server.address() as import('node:net').AddressInfo).port
    inspector = await startInspector({ port: 0 })
    cdp = await TestCdpClient.connect(inspector.endpoint.webSocketDebuggerUrl)
    await cdp.call('Network.enable')
    /**
     * 常量说明：abort 用于处理 abort 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const abort = new AbortController()

    /**
     * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const response = await fetch(`http://127.0.0.1:${String(port)}/aborted-events`, { signal: abort.signal })
    /**
     * 常量说明：reader 用于处理 reader 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const reader = response.body?.getReader()
    if (reader === undefined) throw new Error('SSE response did not expose a body')
    expect(Buffer.from((await reader.read()).value ?? []).toString('utf8')).toBe(eventStream)

    /**
     * 变量说明：requestId 用于处理 requestId 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let requestId: string | undefined
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => {
      /**
       * 常量说明：received 用于处理 received 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
       * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
       */
      const received = cdp!.events.find(event =>
        event.method === 'Network.responseReceived'
        && String((event.params?.response as Record<string, unknown> | undefined)?.url).includes('/aborted-events'))
      requestId = received?.params?.requestId as string | undefined
      expect(requestId).toBeTypeOf('string')
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
       * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
       * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
       */
      expect(cdp!.events.filter(event =>
        event.method === 'Network.eventSourceMessageReceived'
        && event.params?.requestId === requestId).map(event => event.params?.data)).toEqual(['first', '[DONE]'])
    })
    abort.abort()

    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => {
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
       * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
       */
      expect(cdp!.events.some(event =>
        event.method === 'Network.loadingFinished'
        && event.params?.requestId === requestId)).toBe(true)
    })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
     * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
     */
    expect(cdp.events.some(event =>
      event.method === 'Network.loadingFailed'
      && event.params?.requestId === requestId)).toBe(false)
    /**
     * 常量说明：body 用于处理 body 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const body = await cdp.call('Network.getResponseBody', { requestId })
    expect(Buffer.from(String(body.result?.body), 'base64').toString('utf8')).toBe(eventStream)
    expect(body.result?.dshInspectorTruncated).toBe(true)
    expect(String(body.result?.dshInspectorCaptureError)).toContain('AbortError')
  })
})

/**
 * 功能说明：处理 clientContext 相关流程；使用场景由所在模块及调用位置决定。
 * @param client （TestCdpClient）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Promise<number>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 clientContext(client)，并按返回类型处理结果。
 */
async function clientContext(client: TestCdpClient): Promise<number> {
  /**
   * 变量说明：contextId 用于处理 contextId 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let contextId: number | undefined
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  await vi.waitFor(() => {
    /**
     * 常量说明：context 用于处理 context 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：candidate（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(candidate)，并按返回类型处理结果。
     */
    const context = runtimeContexts(client).find(candidate => String(candidate.name).startsWith('Client —'))
    expect(context).toBeDefined()
    contextId = context?.id as number
  })
  if (contextId === undefined) throw new Error('Client execution context was not announced')
  return contextId
}

/**
 * 功能说明：处理 runtimeContexts 相关流程；使用场景由所在模块及调用位置决定。
 * @param client （TestCdpClient）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Readonly<Record<string, unknown>>[]；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 runtimeContexts(client)，并按返回类型处理结果。
 */
function runtimeContexts(client: TestCdpClient): Readonly<Record<string, unknown>>[] {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
   * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
   * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
   */
  return client.events
    .filter(event => event.method === 'Runtime.executionContextCreated')
    .map(event => asRecord(event.params?.context))
}

/**
 * 功能说明：处理 consoleEvent 相关流程；使用场景由所在模块及调用位置决定。
 * @param client （TestCdpClient）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param contextId （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param marker （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns CdpMessage | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 consoleEvent(client, contextId, marker)，并按返回类型处理结果。
 */
function consoleEvent(client: TestCdpClient, contextId: number, marker: string): CdpMessage | undefined {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
   * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
   */
  return client.events.find((event) => {
    if (event.method !== 'Runtime.consoleAPICalled' || event.params?.executionContextId !== contextId) return false
    /**
     * 常量说明：args 用于处理 args 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const args = event.params.args
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：argument（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(argument)，并按返回类型处理结果。
     */
    return Array.isArray(args) && args.some(argument => asRecord(argument).value === marker)
  })
}

/**
 * 功能说明：处理 recordArray 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Readonly<Record<string, unknown>>[]；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 recordArray(value)，并按返回类型处理结果。
 */
function recordArray(value: unknown): Readonly<Record<string, unknown>>[] {
  if (!Array.isArray(value)) throw new Error('expected an array of records')
  return value.map(asRecord)
}

/**
 * 功能说明：处理 asRecord 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Readonly<Record<string, unknown>>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 asRecord(value)，并按返回类型处理结果。
 */
function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('expected a record')
  return value as Readonly<Record<string, unknown>>
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
