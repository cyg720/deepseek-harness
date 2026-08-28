/**
 * The process model: a command runs in its own worker, reaches the VFS only by
 * message, and dies when the host says so.
 *
 * The `Worker` here is a loopback that runs the REAL child half
 * (`runShellProcess`) against the REAL host half, so the frames, the
 * filesystem service, and the termination ladder are the shipped ones — only
 * the thread boundary is simulated, because a Node test host has no DOM
 * `Worker` to cross. The real browser Worker boundary is not exercised here.
 * @remarks 文件说明：文件职责：验证 experimental/webworker-runtime 中 shell process
 * spec 相关行为与失败场景。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryVfs } from '@deepseek-ai/dsh-experimental-webworker-runtime/src/storage/memory.ts'
import { setActiveVfs } from '@deepseek-ai/dsh-experimental-webworker-runtime/src/storage/active.ts'
import { startProcess } from '@deepseek-ai/dsh-experimental-webworker-runtime/src/shell/process/host.ts'
import { runShellProcess } from '@deepseek-ai/dsh-experimental-webworker-runtime/src/shell/process/child.ts'
import { isShellStartFrame } from '@deepseek-ai/dsh-experimental-webworker-runtime/src/shell/process/protocol.ts'
import type { FromProcessFrame, ToProcessFrame } from '@deepseek-ai/dsh-experimental-webworker-runtime/src/shell/process/protocol.ts'

/**
 * 常量说明：WORKSPACE 用于处理 WORKSPACE 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const WORKSPACE = '/dsh/workspace'
/**
 * 常量说明：WORKER_URL 用于处理 WORKER_URL 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const WORKER_URL = 'https://example.test/assets/worker.js'

/**
 * 变量说明：vfs 用于处理 vfs 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
 */
let vfs: MemoryVfs
/** Every loopback worker the code under test constructed.
 * @remarks 中文说明：变量说明：started 用于处理 started 相关数据，作用于当前作用域；其值可能随流程推进而变化，
 * 读写时需遵守声明类型和所在生命周期。 */
let started: LoopbackWorker[]

/**
 * A `Worker` that keeps the child half on this thread. Delivery is deferred so
 * neither half can observe the other's synchronous progress, which is the one
 * property of the real boundary that changes behaviour.
 * @remarks 中文说明：类说明：LoopbackWorker 用于集中封装 处理 LoopbackWorker 相关状态与行为。；
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由
 * experimental/webworker-runtime 在对应插件或业务生命周期内创建和调用。
 */
class LoopbackWorker {
  /**
   * 常量说明：url 用于处理 url 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  readonly url: string
  /**
   * 变量说明：terminated 用于处理 terminated 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  terminated = false
  /**
   * 常量说明：hostListeners 用于处理 hostListeners 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly hostListeners: ((event: MessageEvent) => void)[] = []
  /**
   * 变量说明：childListener 用于处理 childListener 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  private childListener: ((event: MessageEvent) => void) | undefined
  /**
   * 变量说明：closed 用于处理 closed 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private closed = false

  /**
   * 功能说明：处理 LoopbackWorker 相关流程；使用场景由所在模块及调用位置决定。
   * @param url （string | URL）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param options （{ type?: string }）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new LoopbackWorker(url, options) 创建实例，并在所属生命周期内使用。
   */
  constructor(url: string | URL, options?: { type?: string }) {
    this.url = String(url)
    expect(options?.type).toBe('module')
    started.push(this)
  }

  /** Host → child. The first frame starts the real child half.
   * @remarks 中文说明：功能说明：处理 postMessage 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：frame（ToProcessFrame）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 postMessage(frame)，
   * 并按返回类型处理结果。 */
  postMessage(frame: ToProcessFrame): void {
    if (this.terminated) return
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    queueMicrotask(() => {
      if (this.terminated) return
      if (isShellStartFrame(frame)) {
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：reply（FromProcessFrame）：提供本次调用所需的
         * 数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
         * ；典型用法：在完成前置校验后调用 匿名回调(reply)，并按返回类型处理结果。
         */
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_type（'message'）：提供本次调用所需的数据；
         * 必须满足声明的类型及调用时序要求。；参数：listener（(event: MessageEvent) =>
         * void）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(_type, listener)，
         * 并按返回类型处理结果。
         */
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
         */
        runShellProcess(frame, {
          postMessage: (reply: FromProcessFrame) => { this.toHost(reply) },
          addEventListener: (_type: 'message', listener: (event: MessageEvent) => void) => { this.childListener = listener },
          close: () => { this.closed = true },
        })
        return
      }
      this.childListener?.({ data: frame } as MessageEvent)
    })
  }

  /** Child → host.
   * @remarks 中文说明：功能说明：处理 toHost 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：frame（FromProcessFrame）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 toHost(frame)，并按返回类型处理结果。 */
  private toHost(frame: FromProcessFrame): void {
    if (this.terminated) return
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    queueMicrotask(() => {
      if (this.terminated) return
      /**
       * 变量说明：listener 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const listener of this.hostListeners) listener({ data: frame } as MessageEvent)
    })
  }

  /**
   * 功能说明：处理 addEventListener 相关流程；使用场景由所在模块及调用位置决定。
   * @param type （'message' | 'error'）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param listener （(event: MessageEvent) => void）：接收后续状态或事件并执行调用方逻辑；
   * 必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 addEventListener(type, listener)，并按返回类型处理结果。
   */
  addEventListener(type: 'message' | 'error', listener: (event: MessageEvent) => void): void {
    if (type === 'message') this.hostListeners.push(listener)
  }

  /**
   * 功能说明：处理 terminate 相关流程；使用场景由所在模块及调用位置决定。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 terminate()，并按返回类型处理结果。
   */
  terminate(): void {
    this.terminated = true
  }

  /** Whether the child closed itself after reporting its status.
   * @remarks 中文说明：功能说明：处理 childClosed 相关流程；使用场景由所在模块及调用位置决定。；返回值：boolean；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 childClosed()，并按返回类型处理结果。 */
  get childClosed(): boolean {
    return this.closed
  }
}

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
beforeEach(() => {
  vfs = new MemoryVfs()
  setActiveVfs(vfs)
  vfs.mkdirSync(WORKSPACE, { recursive: true })
  started = []
  // The selection in `startProcess` reads exactly these two globals.
  vi.stubGlobal('Worker', LoopbackWorker)
  vi.stubGlobal('self', { location: { href: WORKER_URL } })
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
afterEach(() => {
  vi.unstubAllGlobals()
})

/** Run one command line through the process model and collect everything.
 * @remarks 中文说明：功能说明：执行 run 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：script（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：stdin（由
 * TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<{
 * code: number; stdout: string; stderr: string }>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * ；使用示例：典型用法：在完成前置校验后调用 run(script, stdin)，并按返回类型处理结果。 */
async function run(script: string, stdin = ''): Promise<{ code: number; stdout: string; stderr: string }> {
  /**
   * 变量说明：stdout 用于处理 stdout 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let stdout = ''
  /**
   * 变量说明：stderr 用于处理 stderr 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let stderr = ''
  /**
   * 常量说明：code 用于处理 code 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：settle（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(settle)，并按返回类型处理结果。
   */
  const code = await new Promise<number>((settle) => {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：stream（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：text（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(stream, text)，并按返回类型处理结果。
     */
    startProcess({
      script,
      argv: ['bash', '-c', script],
      cwd: WORKSPACE,
      env: { HOME: '/dsh/home' },
      stdin,
      onOutput: (stream, text) => {
        if (stream === 'stdout') stdout += text
        else stderr += text
      },
      onExit: settle,
    })
  })
  return { code, stdout, stderr }
}

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
it('starts the command as a worker from this bundle, not on this thread', async () => {
  await run('echo hi')
  expect(started).toHaveLength(1)
  // The child is this very bundle in another role: no second asset to serve.
  expect(started[0]?.url).toBe(WORKER_URL)
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
it('runs the command in the child and reports its output and status', async () => {
  expect(await run('echo hi; echo oops >&2; exit 3')).toEqual({ code: 3, stdout: 'hi\n', stderr: 'oops\n' })
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
it('reaches the host filesystem by message', async () => {
  /**
   * 常量说明：written 用于处理 written 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const written = await run('mkdir -p nested && echo carried > nested/file.txt && cat nested/file.txt')
  expect(written).toEqual({ code: 0, stdout: 'carried\n', stderr: '' })
  // The child holds no VFS of its own: the bytes can only have arrived here
  // through the filesystem frames.
  expect(vfs.readFileSync(`${WORKSPACE}/nested/file.txt`, 'utf8')).toBe('carried\n')
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
it('carries a filesystem failure back with its code, not as a lost exception', async () => {
  /**
   * 常量说明：missing 用于处理 missing 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const missing = await run('cat nowhere.txt')
  expect(missing.code).toBe(1)
  expect(missing.stderr).toBe('cat: nowhere.txt: No such file or directory\n')
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
it('delivers standard input to the child', async () => {
  expect((await run('grep -c ""', 'a\nb\nc\n')).stdout).toBe('3\n')
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
it('closes the child once the command settles', async () => {
  await run('true')
  expect(started[0]?.childClosed).toBe(true)
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
it('asks first and terminates second', async () => {
  /**
   * 常量说明：events 用于处理 events 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const events: number[] = []
  /**
   * 常量说明：running 用于处理 running 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：code（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(code)，并按返回类型处理结果。
   */
  const running = startProcess({
    script: 'sleep 30',
    argv: ['bash', '-c', 'sleep 30'],
    cwd: WORKSPACE,
    env: {},
    stdin: '',
    onOutput: () => {},
    onExit: code => events.push(code),
  })
  // The first rung asks the command to stop; a `sleep` honours it.
  running.interrupt()
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  await vi.waitFor(() => { expect(events).toHaveLength(1) })
  expect(events[0]).toBe(130)

  // The second rung does not ask: the worker is gone whatever it was doing.
  /**
   * 常量说明：stubborn 用于处理 stubborn 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：code（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(code)，并按返回类型处理结果。
   */
  const stubborn = startProcess({
    script: 'sleep 30',
    argv: ['bash', '-c', 'sleep 30'],
    cwd: WORKSPACE,
    env: {},
    stdin: '',
    onOutput: () => {},
    onExit: code => events.push(code),
  })
  stubborn.destroy()
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  await vi.waitFor(() => { expect(events).toHaveLength(2) })
  expect(started[1]?.terminated).toBe(true)
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
it('runs an explicit argv without a command line to parse', async () => {
  vfs.writeFileSync(`${WORKSPACE}/spaced name.txt`, 'kept\n')
  /**
   * 变量说明：stdout 用于处理 stdout 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let stdout = ''
  /**
   * 常量说明：code 用于处理 code 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：settle（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(settle)，并按返回类型处理结果。
   */
  const code = await new Promise<number>((settle) => {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_stream（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：text（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(_stream, text)，并按返回类型处理结果。
     */
    startProcess({
      argv: ['cat', 'spaced name.txt'],
      cwd: WORKSPACE,
      env: {},
      stdin: '',
      onOutput: (_stream, text) => { stdout += text },
      onExit: settle,
    })
  })
  expect({ code, stdout }).toEqual({ code: 0, stdout: 'kept\n' })
})
