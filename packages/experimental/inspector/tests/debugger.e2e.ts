/**
 * 文件职责：验证 experimental/inspector 中 debugger e2e 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import WebSocket, { type RawData } from 'ws'
import { afterEach, describe, expect, it } from 'vitest'
import { isPlainObject } from '../src/shared/json.ts'

interface CdpMessage {
  readonly id?: number
  readonly method?: string
  readonly params?: Record<string, unknown>
  readonly result?: Record<string, unknown>
  readonly error?: { message: string }
}

/**
 * 类说明：CdpClient 用于集中封装 处理 CdpClient 相关状态与行为。
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。
 * 使用场景：由 experimental/inspector 在对应插件或业务生命周期内创建和调用。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
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
  private readonly events: CdpMessage[] = []
  /**
   * 常量说明：eventWaiters 用于处理 eventWaiters 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly eventWaiters = new Set<() => void>()

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
      else {
        this.events.push(message)
        /**
         * 变量说明：wake 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
         */
        for (const wake of [...this.eventWaiters]) wake()
      }
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
   * 功能说明：处理 waitForEvent 相关流程；使用场景由所在模块及调用位置决定。
   * @param method （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param predicate （(event: CdpMessage) => boolean）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @returns Promise<CdpMessage>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 waitForEvent(method, predicate)，并按返回类型处理结果。
   */
  waitForEvent(method: string, predicate: (event: CdpMessage) => boolean = () => true): Promise<CdpMessage> {
    /**
     * 常量说明：found 用于处理 found 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
     * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
     */
    const found = this.events.find(event => event.method === method && predicate(event))
    if (found !== undefined) return Promise.resolve(found)
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
        this.eventWaiters.delete(check)
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
        this.eventWaiters.delete(check)
        resolve(event)
      }
      this.eventWaiters.add(check)
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
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('Host debugger through the Inspector Worker', () => {
  /**
   * 变量说明：child 用于处理 child 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let child: ChildProcessWithoutNullStreams | undefined
  /**
   * 变量说明：cdp 用于处理 cdp 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let cdp: CdpClient | undefined

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  afterEach(async () => {
    await cdp?.close()
    cdp = undefined
    if (child !== undefined && child.exitCode === null) child.kill('SIGKILL')
    child = undefined
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('evaluates a paused Host frame and resumes while the main thread is stopped', async () => {
    /**
     * 常量说明：fixture 用于处理 fixture 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const fixture = fileURLToPath(new URL('./fixtures/debug-host.ts', import.meta.url))
    /**
     * 常量说明：tsx 用于处理 tsx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const tsx = import.meta.resolve('tsx/esm')
    child = spawn(process.execPath, ['--import', tsx, fixture], {
      env: { ...process.env, TSX_TSCONFIG_PATH: fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url)) },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    /**
     * 常量说明：firstLine 用于处理 firstLine 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const firstLine = await readLine(child)
    /**
     * 常量说明：endpoint 用于处理 endpoint 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const endpoint = JSON.parse(firstLine) as { webSocketDebuggerUrl: string }
    cdp = await CdpClient.connect(endpoint.webSocketDebuggerUrl)
    expect((await cdp.call('Runtime.enable')).error).toBeUndefined()
    expect((await cdp.call('Debugger.enable')).error).toBeUndefined()
    /**
     * 常量说明：parsed 用于处理 parsed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
     * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
     */
    const parsed = await cdp.waitForEvent('Debugger.scriptParsed', event =>
      String(event.params?.url).endsWith('/debug-host.ts'))
    /**
     * 常量说明：scriptId 用于处理 scriptId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const scriptId = parsed.params?.scriptId
    expect(typeof scriptId).toBe('string')
    /**
     * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const source = await cdp.call('Debugger.getScriptSource', { scriptId })
    expect(source.result?.scriptSource).toContain('breakpointProbe')
    await cdp.call('Runtime.evaluate', { expression: 'console.log("host-console-probe")' })
    /**
     * 常量说明：consoleEvent 用于处理 consoleEvent 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
     * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
     */
    const consoleEvent = await cdp.waitForEvent('Runtime.consoleAPICalled', (event) => {
      /**
       * 常量说明：args 用于处理 args 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const args = event.params?.args
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：arg（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(arg)，并按返回类型处理结果。
       */
      return Array.isArray(args) && args.some(arg => isPlainObject(arg) && arg.value === 'host-console-probe')
    })
    expect(consoleEvent.params?.type).toBe('log')
    /**
     * 常量说明：evaluated 用于处理 evaluated 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const evaluated = await cdp.call('Runtime.evaluate', {
      expression: 'globalThis.__inspectorBreakpointProbe',
    })
    /**
     * 常量说明：objectId 用于处理 objectId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const objectId = (evaluated.result?.result as Record<string, unknown> | undefined)?.objectId
    expect(typeof objectId).toBe('string')
    expect((await cdp.call('Debugger.setBreakpointOnFunctionCall', { objectId })).error).toBeUndefined()

    child.stdin.write('run\n')
    /**
     * 常量说明：paused 用于处理 paused 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const paused = await cdp.waitForEvent('Debugger.paused')
    /**
     * 常量说明：callFrames 用于处理 callFrames 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const callFrames = paused.params?.callFrames as Array<Record<string, unknown>>
    /**
     * 常量说明：callFrameId 用于处理 callFrameId 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const callFrameId = callFrames[0]?.callFrameId
    expect(typeof callFrameId).toBe('string')
    /**
     * 常量说明：scopeChain 用于处理 scopeChain 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const scopeChain = callFrames[0]?.scopeChain as Array<Record<string, unknown>>
    /**
     * 常量说明：scopeObjectId 用于处理 scopeObjectId 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const scopeObjectId = (scopeChain[0]?.object as Record<string, unknown> | undefined)?.objectId
    expect(String(scopeObjectId)).toMatch(/^runtime:/u)
    expect((await cdp.call('Runtime.getProperties', { objectId: scopeObjectId })).error).toBeUndefined()

    // This Worker-local request must complete while the Host main thread is paused.
    expect((await cdp.call('DSHInspector.getSources')).result?.sources).toBeDefined()
    /**
     * 常量说明：local 用于处理 local 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const local = await cdp.call('Debugger.evaluateOnCallFrame', {
      callFrameId,
      expression: 'value',
      returnByValue: true,
    })
    expect(local.result?.result).toMatchObject({ type: 'number', value: 41 })
    /**
     * 常量说明：object 用于处理 object 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const object = await cdp.call('Debugger.evaluateOnCallFrame', {
      callFrameId,
      expression: '({ pausedValue: value })',
      objectGroup: 'backtrace',
    })
    /**
     * 常量说明：pausedObjectId 用于处理 pausedObjectId 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const pausedObjectId = (object.result?.result as Record<string, unknown> | undefined)?.objectId
    expect(String(pausedObjectId)).toMatch(/^runtime:/u)
    expect((await cdp.call('Runtime.getProperties', { objectId: pausedObjectId })).error).toBeUndefined()
    expect((await cdp.call('Debugger.resume')).error).toBeUndefined()
    /**
     * 常量说明：completed 用于处理 completed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const completed = await cdp.call('Runtime.evaluate', {
      expression: 'globalThis.__inspectorBreakpointResult',
      returnByValue: true,
    })
    expect(completed.result?.result).toMatchObject({ type: 'number', value: 42 })

    /**
     * 常量说明：exited 用于处理 exited 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
     */
    const exited = new Promise<number | null>((resolve) => { child!.once('exit', resolve) })
    child.stdin.write('stop\n')
    expect(await exited).toBe(0)
    child = undefined
    cdp = undefined
  }, 20_000)
})

/**
 * 功能说明：读取 Line 相关流程；使用场景由所在模块及调用位置决定。
 * @param child （ChildProcessWithoutNullStreams）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @returns Promise<string>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 readLine(child)，并按返回类型处理结果。
 */
function readLine(child: ChildProcessWithoutNullStreams): Promise<string> {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：reject（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve, reject)，
   * 并按返回类型处理结果。
   */
  return new Promise((resolve, reject) => {
    /**
     * 变量说明：stdout 用于处理 stdout 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let stdout = ''
    /**
     * 变量说明：stderr 用于处理 stderr 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let stderr = ''
    /**
     * 常量说明：onData 用于响应 Data 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：响应 Data 相关流程；使用场景由所在模块及调用位置决定。
     * @param chunk （Buffer）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 onData(chunk)，并按返回类型处理结果。
     */
    const onData = (chunk: Buffer): void => {
      stdout += chunk.toString('utf8')
      /**
       * 常量说明：newline 用于处理 newline 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const newline = stdout.indexOf('\n')
      if (newline === -1) return
      cleanup()
      resolve(stdout.slice(0, newline))
    }
    /**
     * 常量说明：onError 用于响应 Error 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：响应 Error 相关流程；使用场景由所在模块及调用位置决定。
     * @param error （Error）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 onError(error)，并按返回类型处理结果。
     */
    const onError = (error: Error): void => { cleanup(); reject(error) }
    /**
     * 常量说明：onExit 用于响应 Exit 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：响应 Exit 相关流程；使用场景由所在模块及调用位置决定。
     * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 onExit()，并按返回类型处理结果。
     */
    const onExit = (): void => {
      cleanup()
      reject(new Error(`debug Host exited before output; stderr:\n${stderr}`))
    }
    /**
     * 常量说明：onStderr 用于响应 Stderr 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：响应 Stderr 相关流程；使用场景由所在模块及调用位置决定。
     * @param chunk （Buffer）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 onStderr(chunk)，并按返回类型处理结果。
     */
    const onStderr = (chunk: Buffer): void => { stderr += chunk.toString('utf8') }
    /**
     * 常量说明：cleanup 用于处理 cleanup 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：处理 cleanup 相关流程；使用场景由所在模块及调用位置决定。
     * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 cleanup()，并按返回类型处理结果。
     */
    const cleanup = (): void => {
      child.stdout.off('data', onData)
      child.stderr.off('data', onStderr)
      child.off('error', onError)
      child.off('exit', onExit)
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onStderr)
    child.once('error', onError)
    child.once('exit', onExit)
  })
}
