/**
 * Dedicated Web Worker entry. The Node-compatibility layer this app owns is
 * handed to the host assembly as the module table plus the captured request
 * listener; the assembly owns everything else (process global, VFS image,
 * Cordis tree, tunnel server).
 *
 * The assembly needs the base image and selected overlays before it can exist;
 * they arrive in the tunnel's opening `init` frame. This bundle reads nothing
 * from its own URL, so the deployment decides where every archive lives.
 * Messages before `init` queue here; requests during boot queue inside the
 * host, which attaches its handler before its first await.
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 worker 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */
// Straight to the assembly, not through the package barrel: the barrel also
// publishes the pack-time transform, whose acorn dependency would then be bundled
// into this worker — which never parses JavaScript.
import { createWorkerHost } from './worker-host.ts'
import './node/builtin_modules/implemented/buffer.ts'
import { alsCausality, runAtAsyncContextRoot } from './node/builtin_modules/implemented/async_hooks.ts'
import { installAsyncContextHooks } from './polyfill/async-context/async-context-hooks.ts'
import { createNodeBuiltins, REPLACED_PREFIXES } from './node/builtins.ts'
import { whenRequestListener } from './node/builtin_modules/implemented/http.ts'
import { installTimerGlobals } from './node/globals/timers.ts'
import { installProcessGlobal } from './node/globals/process.ts'
import { installCryptoGlobals } from './node/globals/crypto.ts'
import { isShellStartFrame } from './shell/process/protocol.ts'
import { runShellProcess } from './shell/process/host.ts'

// Before the timer globals, so the wrappers close over the patched platform.
installAsyncContextHooks()
installTimerGlobals()
installCryptoGlobals()

/**
 * 变量说明：host 用于处理 host 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
 */
/**
 * 功能说明：处理 Message 相关流程；使用场景由所在模块及调用位置决定。
 * @param data （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 handleMessage(data)，并按返回类型处理结果。
 */
let host: { handleMessage(data: unknown): void } | undefined
/**
 * 变量说明：shellRole 用于处理 shellRole 相关数据，作用于当前作用域；其值可能随流程推进而变化，
 * 读写时需遵守声明类型和所在生命周期。
 */
let shellRole = false
/**
 * 常量说明：pending 用于处理 pending 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const pending: unknown[] = []

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（MessageEvent）：提供需要处理或投影的事件数
 * 据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
 */
self.addEventListener('message', (event: MessageEvent) => {
  /**
   * 常量说明：data 用于处理 data 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const data = event.data as Record<string, unknown> | null
  // Role, decided by the first frame: a worker started by the host's shell
  // runs one command and closes. It mounts no image and boots no tree, so the
  // whole assembly below never happens in it.
  if (host === undefined && isShellStartFrame(data)) {
    shellRole = true
    // The command's own directory and environment are the only `process` facts
    // a shell process needs; bundled code that reads the global (picomatch's
    // platform check) must not find it missing.
    installProcessGlobal({ cwd: data.cwd, env: data.env })
    runShellProcess(data, self)
    return
  }
  if (host === undefined && data !== null && typeof data === 'object' && data.t === 'init') {
    if (typeof data.image !== 'string') {
      throw new Error('webworker: init frame needs a string image url')
    }
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：overlay（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(overlay)，并按返回类型处理结果。
     */
    if (!Array.isArray(data.overlays) || data.overlays.some(overlay => typeof overlay !== 'string')) {
      throw new Error('webworker: init frame needs an array of string overlay urls')
    }
    /**
     * 常量说明：created 用于处理 created 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const created = createWorkerHost({
      staticModules: createNodeBuiltins(),
      staticModulePrefixes: REPLACED_PREFIXES,
      requestListener: whenRequestListener,
      alsCausality,
      image: data.image,
      overlays: data.overlays as string[],
    })
    host = created
    /**
     * 变量说明：queued 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const queued of pending) {
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      runAtAsyncContextRoot(() => { created.handleMessage(queued) })
    }
    pending.length = 0
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    created.start().catch(() => {
      // start() already reported the failure to the page through tunnel.fail;
      // nothing else can reach this rejection, so only the duplicate
      // unhandled-rejection noise is dropped here.
    })
    return
  }
  if (host === undefined) {
    // A shell-role worker's later frames (fs replies, signals) belong to
    // runShellProcess's own listener; parking them here would hold every
    // file body until the worker exits.
    if (shellRole) return
    pending.push(event.data)
    return
  }
  /**
   * 常量说明：ready 用于处理 ready 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const ready = host
  // A tunnel request belongs to no boundary: dispatch it at the context root so
  // it cannot inherit whatever ran just before it on this thread.
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  runAtAsyncContextRoot(() => { ready.handleMessage(event.data) })
})
