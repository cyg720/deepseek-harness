/**
 * Private teardown ladder for the runtime subprocess: stdin EOF (cooperative
 * quiesce), then SIGTERM, then SIGKILL, resolving only after the process has
 * actually exited. The SDK client runs OUTSIDE any harness context, so it
 * cannot ride the `dsh-subprocess` service — this module is the seam's
 * documented exception for SDK-managed transports.
 *
 * @module @deepseek-ai/dsh-sdk-client/dispose
 */
/*
 * 文件职责：实现 dispose.ts 覆盖的SDK 通信行为与生命周期。
 * 技术维度：使用 TypeScript、Cordis 插件、Vitest、事件日志或异步传输。
 * 产品维度：保障 Agent 的SDK 通信能力稳定、可追踪且可恢复。
 * 逻辑维度：准备或解析输入，执行核心流程，再处理结果、错误与资源清理。
 * 关键边界：跨进程数据不可信；持久化状态必须可重放；异步资源必须完全释放。
 * 新手阅读建议：先看导出类型和辅助函数，再读主流程，最后关注错误、恢复和清理。
 */

import type { ChildProcess } from 'node:child_process'

/**
 * Race the child's exit against a timer. Neither outcome leaves anything
 * behind on the child: the exit listener is removed on timeout and the timer
 * is cleared on exit, so the ladder's tiers never accumulate listeners.
 */
/* 中文说明：函数 exitsWithin 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function exitsWithin(child: ChildProcess, ms: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)
  return new Promise<boolean>((resolve) => {
    /** 中文说明：函数值 onExit 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
    const onExit = (): void => {
      clearTimeout(timer)
      resolve(true)
    }
    // `.unref()` so a pending grace timer never keeps the parent's loop alive.
    /** 中文说明：函数值 timer 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit)
      resolve(false)
    }, ms).unref()
    child.once('exit', onExit)
  })
}

/** Force-terminate the runtime and reject if no exit edge arrives within the grace. */
/* 中文说明：函数 forceTerminateWithin 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function forceTerminateWithin(child: ChildProcess, ms: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    /** 中文说明：变量 accepted 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let accepted = false
    /** 中文说明：变量 settled 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let settled = false
    /** 中文说明：函数值 cleanup 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
    const cleanup = (): void => {
      clearTimeout(timer)
      child.off('exit', onExit)
      child.off('error', onError)
    }
    /** 中文说明：函数值 settle 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
    const settle = (complete: () => void): void => {
      if (settled) return
      settled = true
      cleanup()
      complete()
    }
    /** 中文说明：函数值 onExit 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
    const onExit = (): void => { settle(resolve) }
    /** 中文说明：函数值 onError 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
    const onError = (error: Error): void => { settle(() => { reject(error) }) }
    child.once('exit', onExit)
    child.once('error', onError)
    /** 中文说明：函数值 timer 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
    const timer = setTimeout(() => {
      /** 中文说明：变量 disposition 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const disposition = accepted ? 'accepted' : 'refused'
      settle(() => {
        reject(new Error(`runtime process did not exit within ${ms}ms after SIGKILL was ${disposition}`))
      })
    }, ms).unref()
    try {
      accepted = child.kill('SIGKILL')
      if (child.exitCode !== null || child.signalCode !== null) settle(resolve)
    } catch (error: unknown) {
      settle(() => { reject(new Error('SIGKILL failed', { cause: error })) })
    }
  })
}

/**
 * Tear the runtime down to quiescence, resolving only after exit: close stdin
 * and allow cooperative flush, then use the host's graceful and forced
 * termination semantics. POSIX sends `SIGTERM` before `SIGKILL`; Windows
 * skips directly to forced termination because Node maps both signals to
 * `TerminateProcess`.
 * @param child - the runtime child process to tear down.
 * @param graces - the EOF and termination-confirmation windows (ms).
 * @param platform - the host platform, injectable for unit coverage.
 * @throws When forced termination errors or the child does not report exit
 * within `disposeGraceMs`.
 */
/* 中文说明：函数 disposeRuntimeProcess 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export async function disposeRuntimeProcess(
  child: ChildProcess,
  graces: { disposeEofGraceMs: number; disposeGraceMs: number },
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  // Already gone: nothing to reap.
  if (child.exitCode !== null || child.signalCode !== null) return
  // 1. Close stdin and allow cooperative teardown and durable-state flush.
  child.stdin?.end()
  if (await exitsWithin(child, graces.disposeEofGraceMs)) return
  // 2. POSIX gets a catchable graceful signal; Windows signals all force-terminate.
  if (platform !== 'win32') {
    child.kill('SIGTERM')
    if (await exitsWithin(child, graces.disposeGraceMs)) return
  }
  // 3. Force-kill and await a bounded exit edge.
  await forceTerminateWithin(child, graces.disposeGraceMs)
}
