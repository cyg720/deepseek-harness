/**
 * The Node-compatibility layer's refusals and its small answering faces.
 *
 * Two contracts live here. Every replaced symbol must be PRESENT — a missing
 * CommonJS export degrades to `undefined` and fails at call time somewhere
 * unrelated — and every symbol the worker cannot honour must refuse while naming
 * itself, because these errors are routinely swallowed far from their cause and
 * the name is what places them in a worker session's console.
 *
 * The member lists are the tables the modules are checked against: adding a
 * refusing symbol without listing it here leaves it unproven, and listing one
 * that starts answering fails.
 * @remarks 文件说明：文件职责：验证 experimental/webworker-runtime 中 node stubs spec
 * 相关行为与失败场景。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { describe, expect, it, vi } from 'vitest'
import { notAvailableError, notImplementedFail } from '../../src/node/notImplementedFail.ts'
import * as childProcess from '../../src/node/builtin_modules/implemented/child_process.ts'
import * as dnsPromises from '../../src/node/builtin_modules/mock/dns/promises.ts'
import * as net from '../../src/node/builtin_modules/mock/net.ts'
import * as sqlite from '../../src/node/builtin_modules/mock/sqlite.ts'
import * as stream from '../../src/node/builtin_modules/implemented/stream.ts'
import * as vm from '../../src/node/builtin_modules/mock/vm.ts'
import * as workerThreads from '../../src/node/builtin_modules/mock/worker_threads.ts'
import * as nodePty from '../../src/node/external_packages/node-pty.ts'
import * as piAi from '../../src/node/external_packages/pi-ai.ts'
import * as ripgrep from '../../src/node/external_packages/ripgrep.ts'
import * as ws from '../../src/node/external_packages/ws.ts'
import { REPLACED_EXTERNAL_PACKAGES } from '../../src/node/external_packages/replaced-externals.ts'
import * as os from '../../src/node/builtin_modules/implemented/os.ts'
import * as perfHooks from '../../src/node/builtin_modules/implemented/perf_hooks.ts'
import { DSH_HOME, DSH_TMP } from '../../src/storage/paths.ts'

/** Every refusal writes its message to the console before throwing; keep the run quiet.
 * @remarks 中文说明：常量说明：quiet 用于处理 quiet 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。；功能说明：处理 quiet 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 quiet()，并按返回类型处理结果。 */
const quiet = (): void => { /**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
vi.spyOn(console, 'error').mockImplementation(() => {}) }

/** Symbols that refuse when called.
 * @remarks 中文说明：常量说明：CALLED 用于处理 CALLED 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
const CALLED: [string, Record<string, unknown>, readonly string[]][] = [
  ['node:dns/promises', dnsPromises, ['lookup']],
  ['node:net', net, ['createServer', 'connect']],
  ['node:sqlite', sqlite, ['backup']],
  ['node:vm', vm, ['createContext', 'runInContext', 'runInNewContext', 'runInThisContext', 'isContext']],
  ['node:worker_threads', workerThreads, ['MessageChannel', 'MessagePort', 'markAsUntransferable', 'receiveMessageOnPort']],
  // The rest of `node:child_process` runs commands (see child-process.spec.ts);
  // these three need a real process, so they stay refusals.
  ['node:child_process', childProcess, ['execFileSync', 'execSync', 'fork']],
  ['node-pty', nodePty, ['spawn', 'open']],
  ['@deepseek-ai/pi-ai', piAi, [
    'createProvider', 'createModels', 'openAICompletionsApi', 'openAIResponsesApi', 'anthropicMessagesApi',
    'isContextOverflow', 'getSupportedThinkingLevels',
  ]],
]

/** Classes that refuse when constructed.
 * @remarks 中文说明：常量说明：CONSTRUCTED 用于处理 CONSTRUCTED 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
const CONSTRUCTED: [string, Record<string, unknown>, readonly string[]][] = [
  ['node:sqlite', sqlite, ['DatabaseSync', 'StatementSync']],
  ['node:vm', vm, ['Script']],
  ['node:worker_threads', workerThreads, ['Worker']],
  ['node:perf_hooks', perfHooks, ['PerformanceObserver']],
  ['ws', ws, ['WebSocket']],
]

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('not-implemented stubs', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('names the module and the symbol, and reports before throwing', () => {
    /**
     * 常量说明：reported 用于处理 reported 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const reported = vi.spyOn(console, 'error').mockImplementation(() => {})
    /**
     * 常量说明：error 用于处理 error 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const error = notAvailableError('node:zlib', 'gzipSync')
    expect(error.message).toBe('web-preview: node:zlib.gzipSync is not available in the worker host')
    expect(reported).toHaveBeenCalledWith(error.message)

    /**
     * 常量说明：stub 用于处理 stub 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const stub = notImplementedFail('node:zlib', 'gzipSync')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => stub()).toThrow(error.message)
  })

  /**
   * 变量说明：module、namespace、members 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const [module, namespace, members] of CALLED) {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    it(`${module} refuses ${String(members.length)} called symbol(s)`, () => {
      quiet()
      /**
       * 变量说明：member 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const member of members) {
        /**
         * 常量说明：value 用于处理 value 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const value = namespace[member]
        expect(typeof value, member).toBe('function')
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
         */
        expect(() => (value as () => unknown)(), member).toThrow(new RegExp(`${member}\\b.*not available in the worker host`))
      }
    })
  }

  /**
   * 变量说明：module、namespace、members 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const [module, namespace, members] of CONSTRUCTED) {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    it(`${module} refuses ${String(members.length)} constructed symbol(s)`, () => {
      quiet()
      /**
       * 变量说明：member 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const member of members) {
        /**
         * 常量说明：value 用于处理 value 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const value = namespace[member]
        expect(typeof value, member).toBe('function')
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
         */
        expect(() => new (value as new () => unknown)(), member).toThrow(/not available in the worker host/)
      }
    })
  }

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('keeps the CommonJS interop marker and a default export on every replaced module', () => {
    /**
     * 变量说明：namespace 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const namespace of [dnsPromises, net, sqlite, vm, workerThreads, childProcess, stream, ws, nodePty, piAi, os, perfHooks]) {
      /**
       * 常量说明：holder 用于处理 holder 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const holder = namespace as { __esModule?: unknown; default?: unknown }
      expect(holder.__esModule).toBe(true)
      expect(holder.default).toBeDefined()
    }
  })
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('constructible-but-inert fakes', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('a ws server constructs, accepts listeners, and refuses to carry an upgrade', () => {
    quiet()
    expect(ws.Server).toBe(ws.WebSocketServer)
    /**
     * 常量说明：server 用于处理 server 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const server = new ws.WebSocketServer()
    expect(server.clients.size).toBe(0)
    expect(server.on()).toBe(server)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => server.handleUpgrade()).toThrow(/WebSocketServer.handleUpgrade is not available/)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => server.emit()).toThrow(/WebSocketServer.emit is not available/)
    /**
     * 变量说明：closed 用于处理 closed 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let closed = false
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    server.close(() => { closed = true })
    expect(closed).toBe(true)
  })
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('replaced external packages', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('lists the packages the loader serves from the bundle', () => {
    expect(REPLACED_EXTERNAL_PACKAGES).not.toContain('chokidar')
    expect(REPLACED_EXTERNAL_PACKAGES).not.toContain('@deepseek-ai/node-addon-landlock-run')
    expect(REPLACED_EXTERNAL_PACKAGES).toContain('ws')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('answers the values callers read without invoking anything', () => {
    // The ripgrep binary path is read as data by its consumer.
    expect(typeof ripgrep.rgPath).toBe('string')
  })
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('node:net address predicates', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('classifies IPv4, IPv6, and neither', () => {
    expect([net.isIPv4('127.0.0.1'), net.isIPv4('255.255.255.255')]).toEqual([true, true])
    expect([net.isIPv4('256.0.0.1'), net.isIPv4('::1'), net.isIPv4('nope')]).toEqual([false, false, false])
    expect([net.isIPv6('::1'), net.isIPv6('fe80::1'), net.isIPv6('127.0.0.1')]).toEqual([true, true, false])
    expect([net.isIP('127.0.0.1'), net.isIP('::1'), net.isIP('nope')]).toEqual([4, 6, 0])
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('constructs a Socket but refuses to move bytes through it', () => {
    /**
     * 常量说明：socket 用于处理 socket 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const socket = new net.Socket()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => socket.write()).toThrow(/Socket.write is not available/)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => socket.end()).toThrow(/Socket.end is not available/)
    // Disposal paths run against sockets that were never connected.
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => { socket.destroy() }).not.toThrow()
  })
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('node:os', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('reports the virtual platform identity and the VFS directories', () => {
    expect([os.EOL, os.tmpdir(), os.homedir()]).toEqual(['\n', DSH_TMP, DSH_HOME])
    expect([os.platform(), os.type(), os.arch()]).toEqual(['linux', 'Linux', 'x64'])
    expect([os.release(), os.hostname()]).toEqual(['0.0.0-dsh-worker', 'dsh-worker'])
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('reports no per-core facts and no network interfaces', () => {
    expect(os.cpus()).toEqual([])
    // The worker webserver binds the loopback literal, so a LAN address is never
    // derived — and an empty record keeps it out of the trust snapshot.
    expect(os.networkInterfaces()).toEqual({})
    expect(os.availableParallelism()).toBeGreaterThanOrEqual(1)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('maps the terminal signal names its consumer reads', () => {
    expect(os.constants.signals.SIGTERM).toBe(15)
    expect(os.constants.signals.SIGKILL).toBe(9)
  })
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('node:perf_hooks', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it("hands over the worker's own clock", () => {
    expect(perfHooks.performance).toBe(globalThis.performance)
    expect(perfHooks.performance.now()).toBeGreaterThan(0)
  })
})
