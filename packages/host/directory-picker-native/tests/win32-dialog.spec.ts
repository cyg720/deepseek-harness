/**
 * Driver tests: the child-process message protocol mapped onto the promise,
 * the WM_CLOSE abort service (including the show-race retry and the kill
 * last resort) against fakes, plus the real spawn plumbing — POSIX hosts
 * prove the default path rejects cleanly (koffi cannot load ole32 there),
 * and win32 hosts briefly open and auto-abort a real dialog.
 */
/*
 * 文件职责：验证宿主服务的 win32-dialog.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis 服务、会话事件、持久状态、Node 宿主接口和 Vitest。
 * 产品维度：保证宿主服务在授权、等待、失败和清理场景中可靠。
 * 逻辑维度：构造服务和状态，驱动操作并断言事件与结果。
 * 关键边界：匿名标识不是认证；模型可见审批、提问和任务信息必须写入会话日志。
 * 新手阅读建议：先读类型与事件，再按注册、请求、状态变化和清理流程阅读。
 */

import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { pickWin32Directory, type Win32DialogInternals, type Win32DialogWorkerLike } from '../src/win32-dialog.ts'
import type { Win32DialogWorkerMessage } from '../src/win32-dialog-worker.ts'

/** 中文说明：类型或类 FakeWorker 约束宿主、交互或任务数据职责。 */
class FakeWorker extends EventEmitter implements Win32DialogWorkerLike {
  kill = vi.fn(() => true)
  post(message: Win32DialogWorkerMessage): void {
    this.emit('message', message)
  }
}

/** 中文说明：类型或类 Harness 约束宿主、交互或任务数据职责。 */
interface Harness {
  worker: FakeWorker
  internals: Win32DialogInternals
  close: ReturnType<typeof vi.fn>
}

/** 中文说明：函数 harness 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function harness(overrides: Partial<Win32DialogInternals> = {}): Harness {
  /** 中文说明：测试局部值 worker，由紧邻初始化决定。 */
  const worker = new FakeWorker()
  /** 中文说明：测试局部值 close，由紧邻初始化决定。 */
  const close = vi.fn(async () => undefined)
  return {
    worker,
    close,
    internals: {
      spawnWorker: () => worker,
      closeThreadWindows: close,
      closeRetryMs: 1,
      ...overrides,
    },
  }
}

/** 中文说明：测试局部值 live，由紧邻初始化决定。 */
const live = (): AbortSignal => new AbortController().signal

describe('pickWin32Directory', () => {
  it('resolves the selected path and the cancellation null', async () => {
    /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
    const first = harness()
    /** 中文说明：测试局部值 picked，由紧邻初始化决定。 */
    const picked = pickWin32Directory(live(), first.internals)
    first.worker.post({ kind: 'showing', threadId: 7 })
    first.worker.post({ kind: 'done', path: 'C:\\picked' })
    await expect(picked).resolves.toBe('C:\\picked')
    expect(first.close).not.toHaveBeenCalled()

    /** 中文说明：测试局部值 second，由紧邻初始化决定。 */
    const second = harness()
    /** 中文说明：测试局部值 cancelled，由紧邻初始化决定。 */
    const cancelled = pickWin32Directory(live(), second.internals)
    second.worker.post({ kind: 'done', path: null })
    await expect(cancelled).resolves.toBeNull()
  })

  it('rejects on a reported dialog failure, a worker crash, and a silent exit', async () => {
    /** 中文说明：测试局部值 reported，由紧邻初始化决定。 */
    const reported = harness()
    /** 中文说明：测试局部值 failing，由紧邻初始化决定。 */
    const failing = pickWin32Directory(live(), reported.internals)
    reported.worker.post({ kind: 'error', message: 'CoCreateInstance failed' })
    await expect(failing).rejects.toThrow('win32 folder dialog failed: CoCreateInstance failed')

    /** 中文说明：测试局部值 crashed，由紧邻初始化决定。 */
    const crashed = harness()
    /** 中文说明：测试局部值 crashing，由紧邻初始化决定。 */
    const crashing = pickWin32Directory(live(), crashed.internals)
    crashed.worker.emit('error', new Error('worker blew up'))
    await expect(crashing).rejects.toThrow('worker blew up')

    /** 中文说明：测试局部值 silent，由紧邻初始化决定。 */
    const silent = harness()
    /** 中文说明：测试局部值 exiting，由紧邻初始化决定。 */
    const exiting = pickWin32Directory(live(), silent.internals)
    silent.worker.emit('exit', 0)
    await expect(exiting).rejects.toThrow('exited before reporting a result')
  })

  it('settles once: a late exit after the result is inert', async () => {
    /** 中文说明：测试局部值 { worker, internals }，由紧邻初始化决定。 */
    const { worker, internals } = harness()
    /** 中文说明：测试局部值 picked，由紧邻初始化决定。 */
    const picked = pickWin32Directory(live(), internals)
    worker.post({ kind: 'done', path: 'C:\\once' })
    worker.emit('exit', 0)
    await expect(picked).resolves.toBe('C:\\once')
  })

  it('throws immediately on an already-aborted signal without spawning', async () => {
    /** 中文说明：测试局部值 spawnWorker，由紧邻初始化决定。 */
    const spawnWorker = vi.fn()
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new AbortController()
    controller.abort()
    await expect(pickWin32Directory(controller.signal, { spawnWorker, closeThreadWindows: async () => undefined }))
      .rejects.toThrow('native directory picker aborted')
    expect(spawnWorker).not.toHaveBeenCalled()
  })

  it('services an abort by closing the dialog thread windows until the worker reports', async () => {
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    const { worker, internals, close } = harness()
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new AbortController()
    // Attach the expectation BEFORE driving the race: on a fast host the
    // close budget can exhaust (and reject) between waitFor ticks, and a
    // rejection with no listener yet would count as unhandled.
    /** 中文说明：测试局部值 picked，由紧邻初始化决定。 */
    const picked = expect(pickWin32Directory(controller.signal, internals)).rejects.toThrow('native directory picker aborted')
    worker.post({ kind: 'showing', threadId: 99 })
    controller.abort()
    await vi.waitFor(() => {
      expect(close).toHaveBeenCalledWith(99)
    })
    worker.post({ kind: 'done', path: null })
    await picked
  })

  it('starts the close service on the showing notice when the abort came first', async () => {
    /** 中文说明：测试局部值 closeFailures，由紧邻初始化决定。 */
    const closeFailures = vi.fn(async () => { throw new Error('window not there yet') })
    /** 中文说明：测试局部值 { worker, internals }，由紧邻初始化决定。 */
    const { worker, internals } = harness({ closeThreadWindows: closeFailures })
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new AbortController()
    // Attached before the race for the same unhandled-rejection reason above.
    /** 中文说明：测试局部值 picked，由紧邻初始化决定。 */
    const picked = expect(pickWin32Directory(controller.signal, internals)).rejects.toThrow('native directory picker aborted')
    controller.abort()
    expect(closeFailures).not.toHaveBeenCalled()
    worker.post({ kind: 'showing', threadId: 12 })
    await vi.waitFor(() => {
      expect(closeFailures.mock.calls.length).toBeGreaterThan(1)
    })
    worker.post({ kind: 'done', path: null })
    await picked
  })

  it('kills a worker that never reports showing after an abort', async () => {
    // The budget runs without a thread id (nothing to WM_CLOSE yet), so a
    // worker hung before `showing` cannot dangle the pick.
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    const { worker, internals, close } = harness()
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new AbortController()
    /** 中文说明：测试局部值 picked，由紧邻初始化决定。 */
    const picked = expect(pickWin32Directory(controller.signal, internals)).rejects.toThrow('dialog unresponsive; worker killed')
    controller.abort()
    await picked
    expect(worker.kill).toHaveBeenCalledOnce()
    expect(close).not.toHaveBeenCalled()
  })

  it('kills an unresponsive worker after the close budget', async () => {
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    const { worker, internals, close } = harness()
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new AbortController()
    /** 中文说明：测试局部值 picked，由紧邻初始化决定。 */
    const picked = pickWin32Directory(controller.signal, internals)
    worker.post({ kind: 'showing', threadId: 5 })
    controller.abort()
    await expect(picked).rejects.toThrow('dialog unresponsive; worker killed')
    expect(worker.kill).toHaveBeenCalledOnce()
    expect(close.mock.calls.length).toBeGreaterThan(10)
  })

  // POSIX hosts exercise the REAL default plumbing end to end: the tsx-bootstrapped
  // worker spawns, loads koffi, fails to load ole32.dll, and reports the error.
  it.skipIf(process.platform === 'win32')('rejects through the real worker where the Win32 surface is unavailable', async () => {
    await expect(pickWin32Directory(live())).rejects.toThrow('win32 folder dialog failed')
  }, 30_000)

  // win32 hosts run the true COM smoke instead: a real dialog opens briefly
  // and the abort service closes it (the same lever a disconnecting client pulls).
  it.skipIf(process.platform !== 'win32')('opens and abort-closes a real dialog', async () => {
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new AbortController()
    setTimeout(() => {
      controller.abort()
    }, 400)
    await expect(pickWin32Directory(controller.signal)).rejects.toThrow('native directory picker aborted')
  }, 30_000)
})
