/**
 * 文件职责：验证 experimental/inspector 中 client browser e2e 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import WebSocket, { type RawData } from 'ws'
import { afterEach, describe, expect, it } from 'vitest'
import { startInspector, type InspectorHandle } from '../src/host/bridge/controller.ts'

/**
 * 常量说明：packageDirectory 用于处理 packageDirectory 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const packageDirectory = fileURLToPath(new URL('..', import.meta.url))
/**
 * 常量说明：clientBundlePath 用于处理 clientBundlePath 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const clientBundlePath = join(packageDirectory, 'lib/client.js')
/**
 * 常量说明：clientSourceMapPath 用于处理 clientSourceMapPath 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const clientSourceMapPath = join(packageDirectory, 'lib/client.js.map')
/**
 * 常量说明：built 用于处理 built 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const built = existsSync(clientBundlePath) && existsSync(clientSourceMapPath)

interface CdpMessage {
  readonly id?: number
  readonly method?: string
  readonly params?: Record<string, unknown>
  readonly result?: Record<string, unknown>
  readonly error?: { message: string }
}

/**
 * 类说明：BrowserTestCdpClient 用于集中封装 处理 BrowserTestCdpClient 相关状态与行为。
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。
 * 使用场景：由 experimental/inspector 在对应插件或业务生命周期内创建和调用。
 */
class BrowserTestCdpClient {
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
  private readonly events: CdpMessage[] = []
  /**
   * 常量说明：waiters 用于处理 waiters 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly waiters = new Set<() => void>()

  /**
   * 功能说明：处理 BrowserTestCdpClient 相关流程；使用场景由所在模块及调用位置决定。
   * @param socket （WebSocket）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new BrowserTestCdpClient(socket) 创建实例，并在所属生命周期内使用。
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
      if (message.id !== undefined) {
        this.pending.get(message.id)?.(message)
        return
      }
      this.events.push(message)
      /**
       * 变量说明：waiter 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const waiter of [...this.waiters]) waiter()
    })
  }

  /**
   * 功能说明：处理 connect 相关流程；使用场景由所在模块及调用位置决定。
   * @param url （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<BrowserTestCdpClient>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 connect(url)，并按返回类型处理结果。
   */
  static async connect(url: string): Promise<BrowserTestCdpClient> {
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
    return new BrowserTestCdpClient(socket)
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
   * 功能说明：处理 waitForEvent 相关流程；使用场景由所在模块及调用位置决定。
   * @param method （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param predicate （(message: CdpMessage) => boolean）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @returns Promise<CdpMessage>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 waitForEvent(method, predicate)，并按返回类型处理结果。
   */
  waitForEvent(method: string, predicate: (message: CdpMessage) => boolean): Promise<CdpMessage> {
    /**
     * 常量说明：existing 用于处理 existing 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
     * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
     */
    const existing = this.events.find(event => event.method === method && predicate(event))
    if (existing !== undefined) return Promise.resolve(existing)
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
        this.waiters.delete(check)
        reject(new Error(`CDP event timed out: ${method}`))
      }, 5_000)
      /**
       * 常量说明：check 用于处理 check 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       * 功能说明：处理 check 相关流程；使用场景由所在模块及调用位置决定。
       * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 check()，并按返回类型处理结果。
       */
      const check = (): void => {
        /**
         * 常量说明：event 用于处理 event 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：candidate（由 TypeScript
         * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(candidate)，并按返回类型处理结果。
         */
        const event = this.events.find(candidate => candidate.method === method && predicate(candidate))
        if (event === undefined) return
        clearTimeout(timer)
        this.waiters.delete(check)
        resolve(event)
      }
      this.waiters.add(check)
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
describe.skipIf(!built)('Inspector built Client in Chromium', () => {
  /**
   * 变量说明：inspector 用于处理 inspector 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let inspector: InspectorHandle | undefined
  /**
   * 变量说明：server 用于处理 server 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let server: Server | undefined
  /**
   * 变量说明：browser 用于处理 browser 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let browser: Browser | undefined
  /**
   * 变量说明：page 用于处理 page 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let page: Page | undefined
  /**
   * 变量说明：cdp 用于处理 cdp 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let cdp: BrowserTestCdpClient | undefined

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  afterEach(async () => {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await page?.evaluate(() => {
      /**
       * 常量说明：state 用于处理 state 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const state = Reflect.get(globalThis, '__INSPECTOR_BROWSER_TEST__') as { dispose?: () => void } | undefined
      state?.dispose?.()
    }).catch(() => {})
    await cdp?.close()
    await browser?.close()
    await inspector?.close()
    /**
    * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
    * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
    * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
    */
    /**
    * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
    * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
    */
    if (server !== undefined) await new Promise<void>((resolve) => { server!.close(() => { resolve() }) })
    page = undefined
    cdp = undefined
    browser = undefined
    inspector = undefined
    server = undefined
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('forwards Console values and exposes the built bundle as read-only source', async () => {
    inspector = await startInspector({ port: 0, captureFetch: false, maxClientSourceBytes: 1_000_000 })
    /**
     * 常量说明：bundle 用于处理 bundle 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const bundle = await readFile(clientBundlePath)
    /**
     * 常量说明：sourceMap 用于处理 sourceMap 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const sourceMap = await readFile(clientSourceMapPath)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：request（由 TypeScript
     * 根据调用位置推断的类型）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；参数：response（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(request, response)，
     * 并按返回类型处理结果。
     */
    server = createServer((request, response) => {
      /**
       * 常量说明：url 用于处理 url 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      if (url.pathname === '/client.js') {
        response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
        response.end(bundle)
        return
      }
      if (url.pathname === '/client.js.map') {
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        response.end(sourceMap)
        return
      }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(browserFixture(inspector!.endpoint.client))
    })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
     */
    /**
    * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
    * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
    */
    await new Promise<void>((resolve) => { server!.listen(0, '127.0.0.1', () => { resolve() }) })
    /**
     * 常量说明：port 用于处理 port 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const port = (server.address() as import('node:net').AddressInfo).port

    browser = await chromium.launch()
    page = await browser.newPage()
    await page.goto(`http://127.0.0.1:${String(port)}/`)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await page.waitForFunction(() => Reflect.get(globalThis, '__INSPECTOR_BROWSER_TEST__') !== undefined)

    cdp = await BrowserTestCdpClient.connect(inspector.endpoint.webSocketDebuggerUrl)
    await cdp.call('Runtime.enable')
    /**
     * 常量说明：contextEvent 用于处理 contextEvent 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
     * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
     */
    const contextEvent = await cdp.waitForEvent('Runtime.executionContextCreated', (event) => {
      /**
       * 常量说明：context 用于处理 context 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const context = event.params?.context as Record<string, unknown> | undefined
      return String(context?.name).startsWith('Client —')
    })
    /**
     * 常量说明：context 用于处理 context 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const context = contextEvent.params?.context as Record<string, unknown>
    /**
     * 常量说明：contextId 用于处理 contextId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const contextId = context.id
    /**
     * 常量说明：uniqueContextId 用于处理 uniqueContextId 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const uniqueContextId = context.uniqueId
    /**
     * 常量说明：sourceId 用于处理 sourceId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const sourceId = asRecord(context.auxData).sourceId
    expect(contextId).toBeTypeOf('number')
    expect(uniqueContextId).toBeTypeOf('string')
    expect(sourceId).toBeTypeOf('string')

    /**
     * 常量说明：evaluated 用于处理 evaluated 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const evaluated = await cdp.call('Runtime.evaluate', {
      expression: 'globalThis.__inspectorConsoleEvaluation = { answer: 6 * 7 }',
      objectGroup: 'console',
      includeCommandLineAPI: true,
      silent: false,
      returnByValue: false,
      generatePreview: true,
      userGesture: true,
      awaitPromise: false,
      replMode: true,
      allowUnsafeEvalBlockedByCSP: false,
      uniqueContextId,
    })
    expect(evaluated.error).toBeUndefined()
    expect(asRecord(evaluated.result?.result).objectId).toMatch(/^runtime:/u)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(await page.evaluate(() => Reflect.get(globalThis, '__inspectorConsoleEvaluation') as unknown)).toEqual({
      answer: 42,
    })

    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await page.evaluate(() => {
      /**
       * 常量说明：value 用于处理 value 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const value = { browser: true, nested: { ready: true } }
      Reflect.set(globalThis, '__inspectorBrowserValue', value)
      console.log(value, 'browser-client-console')
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      setTimeout(() => { throw new Error('browser-client-exception') }, 0)
    })
    /**
     * 常量说明：consoleEvent 用于处理 consoleEvent 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
     * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
     */
    const consoleEvent = await cdp.waitForEvent('Runtime.consoleAPICalled', event =>
      event.params?.executionContextId === contextId && hasArgument(event, 'browser-client-console'))
    /**
     * 常量说明：args 用于处理 args 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const args = consoleEvent.params?.args
    if (!Array.isArray(args)) throw new Error('Client Console event has no arguments')
    expect((consoleEvent.params?.stackTrace as { callFrames?: unknown[] } | undefined)?.callFrames?.length)
      .toBeGreaterThan(0)
    /**
     * 常量说明：objectId 用于处理 objectId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const objectId = asRecord(args[0]).objectId
    expect(String(objectId)).toMatch(/^runtime:/u)
    /**
     * 常量说明：properties 用于处理 properties 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const properties = await cdp.call('Runtime.getProperties', { objectId, ownProperties: true })
    expect(propertyValue(properties, 'browser')).toBe(true)
    /**
     * 常量说明：exception 用于处理 exception 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
     * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
     */
    const exception = await cdp.waitForEvent('Runtime.exceptionThrown', (event) => {
      /**
       * 常量说明：details 用于处理 details 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const details = event.params?.exceptionDetails as Record<string, unknown> | undefined
      return details !== undefined
        && details.executionContextId === contextId
        && String((details.exception as Record<string, unknown> | undefined)?.description).includes('browser-client-exception')
    })
    /**
     * 常量说明：exceptionDetails 用于处理 exceptionDetails 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const exceptionDetails = exception.params?.exceptionDetails as Record<string, unknown>
    expect((exceptionDetails.stackTrace as { callFrames?: unknown[] } | undefined)?.callFrames?.length)
      .toBeGreaterThan(0)

    /**
     * 常量说明：enabled 用于处理 enabled 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const enabled = await cdp.call('Debugger.enable')
    expect(enabled.error).toBeUndefined()
    expect(enabled.result?.debuggerId).toBeTypeOf('string')
    /**
     * 常量说明：script 用于处理 script 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
     * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
     */
    const script = await cdp.waitForEvent('Debugger.scriptParsed', event =>
      String(event.params?.url).includes('/client.js?rev=browser-test'))
    expect(script.params).toMatchObject({ executionContextId: contextId, buildId: '' })
    /**
     * 常量说明：scriptId 用于处理 scriptId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const scriptId = script.params?.scriptId
    /**
     * 常量说明：content 用于处理 content 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const content = await cdp.call('Debugger.getScriptSource', { scriptId })
    expect(String(content.result?.scriptSource)).toContain('ClientInspectorSource')
    expect((await cdp.call('Debugger.setBreakpointByUrl', {
      url: script.params?.url,
      lineNumber: 0,
    })).error?.message).toContain('Client native debugging is unavailable')

    /**
     * 常量说明：duplicateContext 用于处理 duplicateContext 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
     * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
     */
    const duplicateContext = cdp.waitForEvent('Runtime.executionContextCreated', (event) => {
      /**
       * 常量说明：candidate 用于处理 candidate 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const candidate = event.params?.context as Record<string, unknown> | undefined
      return String(candidate?.name).startsWith('Client —') && candidate?.id !== contextId
    })
    /**
     * 常量说明：popup 用于处理 popup 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：[opened]（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调([opened])，并按返回类型处理结果。
     */
    const popup = await Promise.all([
      page.waitForEvent('popup'),
      page.evaluate(() => {
        if (window.open(location.href, '_blank') === null) throw new Error('duplicate tab was blocked')
      }),
    ]).then(([opened]) => opened)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await popup.waitForFunction(() => Reflect.get(globalThis, '__INSPECTOR_BROWSER_TEST__') !== undefined)
    /**
     * 常量说明：duplicate 用于处理 duplicate 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const duplicate = (await duplicateContext).params?.context as Record<string, unknown>
    expect(asRecord(duplicate.auxData).sourceId).not.toBe(sourceId)
    await cdp.call('Debugger.disable')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await popup.evaluate(async () => {
      /**
       * 常量说明：state 用于处理 state 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const state = Reflect.get(globalThis, '__INSPECTOR_BROWSER_TEST__') as { dispose?: () => Promise<void> } | undefined
      await state?.dispose?.()
    })
    await popup.close()
  }, 20_000)
})

/**
 * 功能说明：处理 browserFixture 相关流程；使用场景由所在模块及调用位置决定。
 * @param bootstrap （InspectorHandle['endpoint']['client']）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 browserFixture(bootstrap)，并按返回类型处理结果。
 */
function browserFixture(bootstrap: InspectorHandle['endpoint']['client']): string {
  /**
   * 常量说明：boot 用于处理 boot 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const boot = {
    rev: 'browser-test',
    entries: [{
      id: '@deepseek-ai/dsh-experimental-inspector',
      url: '/client.js?rev=browser-test',
      rev: 'browser-test',
    }],
  }
  return `<!doctype html>
<title>Inspector Browser Client</title>
<script>
globalThis.__DSH_INSPECTOR__ = ${JSON.stringify(bootstrap)};
globalThis.__DSH_BOOT__ = ${JSON.stringify(boot)};
globalThis.__ModuleLoader__ = { load(registration) { globalThis.__INSPECTOR_REGISTRATION__ = registration; } };
</script>
<script src="/client.js?rev=browser-test"></script>
<script type="module">
const registration = globalThis.__INSPECTOR_REGISTRATION__;
const disposers = [];
const root = {
  __inspectorContext: true,
  registry: new Map(),
  events: { _hooks: {} },
  async effect(callback) { const dispose = await callback(); disposers.push(dispose); return dispose; },
  on() { return () => {}; },
  provide(name, value) { this[name] = value; return () => { delete this[name]; }; },
};
root.root = root;
const cordis = { Context: { is(value) { return value?.__inspectorContext === true; } } };
const plugin = registration.factory(specifier => {
  if (specifier === '@deepseek-ai/cordis') return cordis;
  throw new Error('Unexpected Client bundle dependency ' + specifier);
});
await plugin.apply(root);
globalThis.__INSPECTOR_BROWSER_TEST__ = {
  async dispose() { for (const dispose of disposers.reverse()) await dispose(); },
};
</script>`
}

/**
 * 功能说明：判断是否包含 Argument 相关流程；使用场景由所在模块及调用位置决定。
 * @param event （CdpMessage）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 hasArgument(event, value)，并按返回类型处理结果。
 */
function hasArgument(event: CdpMessage, value: unknown): boolean {
  /**
   * 常量说明：args 用于处理 args 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const args = event.params?.args
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：argument（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(argument)，并按返回类型处理结果。
   */
  return Array.isArray(args) && args.some(argument => asRecord(argument).value === value)
}

/**
 * 功能说明：处理 propertyValue 相关流程；使用场景由所在模块及调用位置决定。
 * @param response （CdpMessage）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param name （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns unknown；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 propertyValue(response, name)，并按返回类型处理结果。
 */
function propertyValue(response: CdpMessage, name: string): unknown {
  /**
   * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const result = response.result?.result
  if (!Array.isArray(result)) throw new Error('Runtime.getProperties returned no property list')
  /**
   * 常量说明：property 用于处理 property 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：candidate（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(candidate)，并按返回类型处理结果。
   */
  const property = result.map(asRecord).find(candidate => candidate.name === name)
  return asRecord(property?.value).value
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
