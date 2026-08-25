/**
 * Shared launcher for ACP tests that drive an agent subprocess over JSON-RPC
 * stdio. It owns source-or-built launch resolution, workspace environment,
 * stdout tee, SDK client, update collection, permission fallback, and process
 * shutdown so e2e and snapshot suites do not each reconstruct that boundary.
 *
 * @module @deepseek-ai/dsh-acp-snapshot/launcher
 */
/**
 * 文件职责：实现 launcher.ts 覆盖的ACP 快照测试支持行为与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、进程流、终端会话或快照规范化。
 * 产品维度：保障 Agent 的ACP 快照测试支持能力稳定、可复现且可诊断。
 * 逻辑维度：准备输入和资源，执行核心流程，收集事件或输出，再处理错误与清理。
 * 关键边界：进程退出与取消可能竞态；外部输出不可信；清理必须等待子资源完全停止。
 * 新手阅读建议：先看类型和夹具，再读启动/收集主流程，最后关注平台差异、规范化和清理。
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import {
  ClientSideConnection,
  ndJsonStream,
  /** 中文说明：type Agent 定义本模块所需的数据或行为，用于表达ACP 快照测试支持场景。 */
  type Agent as AcpAgent,
  /** 中文说明：type Client 定义本模块所需的数据或行为，用于表达ACP 快照测试支持场景。 */
  type Client,
  /** 中文说明：type RequestPermissionRequest 定义本模块所需的数据或行为，用于表达ACP 快照测试支持场景。 */
  type RequestPermissionRequest,
  /** 中文说明：type RequestPermissionResponse 定义本模块所需的数据或行为，用于表达ACP 快照测试支持场景。 */
  type RequestPermissionResponse,
  /** 中文说明：type SessionNotification 定义本模块所需的数据或行为，用于表达ACP 快照测试支持场景。 */
  type SessionNotification,
} from '@agentclientprotocol/sdk'
import { resolveExampleLaunch } from '@deepseek-ai/dsh-loader-smoke'

/** 中文说明：常量 EXIT_MARKER_GRACE_MS 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const EXIT_MARKER_GRACE_MS = 250

/** The source/built agent entry, leaf config, and workspace tsconfig an ACP test boots. */
/** 中文说明：interface AgentUnderTest 定义本模块所需的数据或行为，用于表达ACP 快照测试支持场景。 */
export interface AgentUnderTest {
  /** The agent source bin entry (for example `packages/examples/acp-demo/src/bin.ts`). */
  binScript: string
  /** Explicit built-mode entry for fixtures whose source path is not under `src/`. */
  libBinScript?: string | undefined
  /** The leaf `cordis.yml` loaded by the bin. */
  configPath: string
  /** The repo tsconfig whose paths resolve unbuilt workspace imports. */
  tsconfigPath: string
}

/** Options for one ACP test subprocess. */
/** 中文说明：interface AcpTestLaunchOptions 定义本模块所需的数据或行为，用于表达ACP 快照测试支持场景。 */
export interface AcpTestLaunchOptions {
  /** The agent composition to boot. */
  agent: AgentUnderTest
  /** Process cwd and default session-home root. */
  cwd: string
  /** Alternate leaf config for this launch. */
  configPath?: string
  /** Extra environment values layered over the parent environment. */
  env?: NodeJS.ProcessEnv
  /** Permission handler; omitted requests fail closed as `cancelled`. */
  requestPermission?: (params: RequestPermissionRequest) => Promise<RequestPermissionResponse>
}

/** A running ACP test process and its captured client-side outputs. */
/** 中文说明：interface LaunchedAcpTestAgent 定义本模块所需的数据或行为，用于表达ACP 快照测试支持场景。 */
export interface LaunchedAcpTestAgent {
  /** The child process, exposed for process-level assertions. */
  child: ChildProcessWithoutNullStreams
  /** Resolve when the OS spawns the child; reject with its asynchronous spawn failure. */
  spawned: Promise<void>
  /** The SDK connection backed by the child's stdio. */
  client: ClientSideConnection
  /** Session updates in receive order. */
  updates: SessionNotification['update'][]
  /** Decode all stdout bytes captured so far. */
  rawStdout(): string
  /** Decode all stderr chunks captured so far. */
  stderr(): string
  /** Resolve when a future session update matches the predicate. */
  waitForUpdate(match: (update: SessionNotification['update']) => boolean): Promise<SessionNotification['update']>
  /** Close the process and drain its streams and callbacks; rejects promptly if fallback termination is refused. */
  close(signal?: NodeJS.Signals): Promise<void>
}

/**
 * Boot an ACP agent subprocess and connect an SDK client to its stdio.
 *
 * @param options Agent paths, cwd, environment, and optional permission handler.
 * @returns The running process, connected client, captures, and shutdown handle.
 */
/** 中文说明：函数 launchAcpTestAgent 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export function launchAcpTestAgent(options: AcpTestLaunchOptions): LaunchedAcpTestAgent {
  const { agent, cwd } = options
  /** 中文说明：变量 launch 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const launch = resolveExampleLaunch({
    srcBin: agent.binScript,
    libBin: agent.libBinScript,
    configArgs: ['--config', options.configPath ?? agent.configPath],
    tsconfigPath: agent.tsconfigPath,
    env: {
      ...options.env,
      DSH_HOME: join(cwd, '.dsh'),
      DSH_AGENTS_HOME: join(cwd, '.agents'),
    },
  })
  /** 中文说明：变量 child 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const child = spawn(
    launch.command,
    launch.args,
    {
      cwd,
      env: { ...process.env, ...launch.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  )
  // A spawn-level failure is an asynchronous `error` event. Observe it in the
  // same tick as spawn so a missing cwd or OS rejection cannot crash the test
  // runner, then make startup and shutdown surface the original error.
  // Keep observing after the first error: a fallback kill attempted during
  // shutdown may itself report another process error, which must not become an
  // unhandled EventEmitter error after the promise has already settled.
  /** 中文说明：函数值 childFailure 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const childFailure = new Promise<Error>(resolve => child.on('error', resolve))
  /** 中文说明：变量 spawned 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const spawned = Promise.race([
    new Promise<void>(resolve => child.once('spawn', resolve)),
    childFailure.then((error): never => { throw error }),
  ])
  // `spawned` is public and close() also awaits it, but a caller may ignore both.
  // Keep that misuse from turning the already-observed child error into an
  // unhandled promise rejection.
  void spawned.catch(() => undefined)

  /** 中文说明：变量 stderrChunks 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const stderrChunks: string[] = []
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => stderrChunks.push(chunk))

  /** 中文说明：变量 rawBuffers 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const rawBuffers: Buffer[] = []
  /** 中文说明：变量 passthrough 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const passthrough = new Readable({ read() {} })
  /** 中文说明：变量 updates 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const updates: SessionNotification['update'][] = []
  /** 中文说明：变量 updateWaiters 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const updateWaiters: {
    match: (update: SessionNotification['update']) => boolean
    resolve: (update: SessionNotification['update']) => void
    reject: (reason: unknown) => void
  }[] = []
  /** 中文说明：变量 updateStreamFailure 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let updateStreamFailure: Error | undefined
  /** 中文说明：函数值 closeUpdateStream 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const closeUpdateStream = (): void => {
    if (updateStreamFailure !== undefined) return
    updateStreamFailure = new Error('ACP test agent update stream closed before a matching session update arrived')
    /** 中文说明：该循环依次处理事件或输出；循环变量仅在当前循环中有效。 */
    for (const waiter of updateWaiters.splice(0)) waiter.reject(updateStreamFailure)
  }
  child.stdout.on('data', (buffer: Buffer) => {
    rawBuffers.push(buffer)
    passthrough.push(buffer)
  })
  child.stdout.on('end', () => {
    passthrough.push(null)
  })
  /** 中文说明：变量 stream 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const stream = ndJsonStream(
    Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
    Readable.toWeb(passthrough) as ReadableStream<Uint8Array>,
  )
  /** 中文说明：变量 inFlightClientCallbacks 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const inFlightClientCallbacks = new Set<Promise<unknown>>()
  /** 中文说明：函数值 trackClientCallback 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const trackClientCallback = <T>(callback: () => T | PromiseLike<T>): Promise<T> => {
    /** 中文说明：变量 pending 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = Promise.resolve().then(callback)
    inFlightClientCallbacks.add(pending)
    /** 中文说明：函数值 untrack 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
    const untrack = (): void => { inFlightClientCallbacks.delete(pending) }
    void pending.then(untrack, untrack)
    return pending
  }
  /** 中文说明：变量 requestPermission 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const requestPermission = options.requestPermission
    ?? (() => Promise.resolve({ outcome: { outcome: 'cancelled' as const } }))
  /** 中文说明：函数值 makeClient 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const makeClient = (_agent: AcpAgent): Client => ({
    sessionUpdate(params: SessionNotification): Promise<void> {
      return trackClientCallback(() => {
        updates.push(params.update)
        /** 中文说明：该循环依次处理事件或输出；循环变量仅在当前循环中有效。 */
        for (let index = updateWaiters.length - 1; index >= 0; index--) {
          /** 中文说明：变量 waiter 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const waiter = updateWaiters[index]
          /* v8 ignore next 1 -- index is bounded by the array length */
          if (waiter === undefined) continue
          /** 中文说明：变量 matches 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          let matches: boolean
          try {
            matches = waiter.match(params.update)
          } catch (error: unknown) {
            updateWaiters.splice(index, 1)
            waiter.reject(error)
            continue
          }
          if (!matches) continue
          updateWaiters.splice(index, 1)
          waiter.resolve(params.update)
        }
      })
    },
    requestPermission: params => trackClientCallback(() => requestPermission(params)),
  })
  /** 中文说明：变量 client 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const client = new ClientSideConnection(makeClient, stream)
  // `exit` only reports the parent process's status. Descendants may retain
  // inherited stdout/stderr handles and buffered ACP frames may still be
  // crossing the SDK parser. Node's `close` follows stdio closure; the SDK's
  // `closed` follows parser exhaustion. Capture both eagerly so a caller that
  // invokes close after process exit still joins the complete drain boundary.
  /** 中文说明：函数值 stdioClosed 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const stdioClosed = new Promise<void>(resolve => child.once('close', () => { resolve() }))
  /** 中文说明：函数值 drained 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const drained = Promise.all([stdioClosed, client.closed]).then(async () => {
    // The ACP SDK's readable loop dispatches client callbacks without awaiting
    // them. Once `closed` settles no new callbacks can start, but callbacks
    // already in flight still belong to this launch's teardown boundary.
    while (inFlightClientCallbacks.size > 0) {
      await Promise.allSettled([...inFlightClientCallbacks])
    }
  })
  // A caller may await a pending update without calling close(). Make natural
  // stream exhaustion terminal for those waiters too, but only after the
  // parser has dispatched every buffered frame.
  void client.closed.then(closeUpdateStream)

  return {
    child,
    spawned,
    client,
    updates,
    rawStdout: () => Buffer.concat(rawBuffers).toString('utf8'),
    stderr: () => stderrChunks.join(''),
    waitForUpdate(match): Promise<SessionNotification['update']> {
      if (updateStreamFailure !== undefined) return Promise.reject(updateStreamFailure)
      return new Promise((resolve, reject) => updateWaiters.push({ match, resolve, reject }))
    },
    async close(signal?: NodeJS.Signals): Promise<void> {
      try {
        await spawned
      } catch (error: unknown) {
        await drained
        closeUpdateStream()
        throw error
      }
      if (!isRunning(child)) {
        await drained
        closeUpdateStream()
        return
      }
      /** 中文说明：变量 exited 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const exited = waitForExit(child)
      if (signal === undefined) child.stdin.end()
      else child.kill(signal)
      /** 中文说明：变量 failure 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const failure = await Promise.race([
        exited.then((): undefined => undefined),
        childFailure,
      ])
      if (failure === undefined) {
        await drained
        closeUpdateStream()
        return
      }

      /** 中文说明：函数值 propagateFailureAfterDrain 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
      const propagateFailureAfterDrain = async (): Promise<never> => {
        await drained
        closeUpdateStream()
        throw failure
      }
      // Windows implements the supported signal names as forced termination. The exit markers
      // may therefore arrive after the error wins the race above but before fallback begins.
      if (!isRunning(child) || await exitMarkerWithinGrace(exited)) return propagateFailureAfterDrain()

      // An `error` after spawn is not an exit edge: in particular, a failed
      // signal can leave the subprocess live. Force termination, await the
      // already-observed exit edge, and only then propagate the child error so
      // callers may safely remove cwd/session resources after close rejects.
      /** 中文说明：变量 fallbackError 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const fallbackError = Promise.withResolvers<Error>()
      /** 中文说明：函数值 observeFallbackError 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
      const observeFallbackError = (error: Error): void => { fallbackError.resolve(error) }
      child.once('error', observeFallbackError)
      if (!child.kill('SIGKILL')) {
        child.off('error', observeFallbackError)
        // A successful earlier signal may win between the live check and this fallback call.
        // In that case `kill()` correctly reports no process to signal; the original child error
        // remains the shutdown result once inherited stdio and callbacks have drained.
        if (!isRunning(child) || await exitMarkerWithinGrace(exited)) return propagateFailureAfterDrain()
        closeUpdateStream()
        throw new AggregateError(
          [failure, new Error('Fallback SIGKILL was not accepted by the child process')],
          'ACP test agent failed and fallback termination was refused',
        )
      }
      /** 中文说明：变量 fallbackFailure 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const fallbackFailure = await Promise.race([
        exited.then((): undefined => undefined),
        fallbackError.promise,
      ])
      child.off('error', observeFallbackError)
      if (fallbackFailure !== undefined) {
        closeUpdateStream()
        throw new AggregateError(
          [failure, fallbackFailure],
          'ACP test agent failed and fallback termination was refused',
        )
      }
      return propagateFailureAfterDrain()
    },
  }
}

/** Resolve once a running child exits. */
/** 中文说明：函数 waitForExit 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function waitForExit(child: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise<void>(resolve => child.once('exit', () => { resolve() }))
}

/** Give an accepted Windows termination request a bounded window to publish its exit marker. */
/** 中文说明：函数 exitMarkerWithinGrace 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function exitMarkerWithinGrace(exited: Promise<void>): Promise<boolean> {
  return Promise.race([
    exited.then(() => true),
    new Promise<false>((resolve) => {
      /** 中文说明：函数值 timer 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
      const timer = setTimeout(() => { resolve(false) }, EXIT_MARKER_GRACE_MS)
      timer.unref()
    }),
  ])
}

/** Whether the child still lacks either OS termination marker. */
/** 中文说明：函数 isRunning 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function isRunning(child: ChildProcessWithoutNullStreams): boolean {
  return child.exitCode === null && child.signalCode === null
}
