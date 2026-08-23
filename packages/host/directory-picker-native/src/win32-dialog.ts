/**
 * ================================ 文件注释 ================================
 * 【文件职责】Win32 文件夹对话框的主线程驱动：派生子进程（阻塞在模态 Show
 * 内），把其消息协议映射为 promise，并通过向对话框线程的窗口投递 WM_CLOSE
 * 服务取消，直到子进程回报。真实进程/窗口表面可注入，因此驱动每条路径都能
 * 在任何平台测试。
 * 【技术维度】子进程消息协议：showing（带线程 id，供取消杠杆）→ done/error；
 * 取消服务按 CLOSE_RETRY_MS 周期重投 WM_CLOSE，超预算（CLOSE_MAX_ATTEMPTS）
 * 后 kill 子进程兜底；worker.unref() 保证卡在原生模态调用里的子进程不会阻塞
 * 进程退出。
 * 【产品维度】Windows 上的现代目录选择器：与桌面一致的体验，且事件循环保持
 * 活跃、可被远程调用方取消。
 * 【逻辑维度】进程表面接口（Win32DialogWorkerLike）→ 可注入内部件 → 常量 →
 * pickWin32Directory（信号预检 → spawn → 消息/错误/退出监听 → 取消服务）。
 * 【关键边界】showing 通知先于阻塞 Show，首次 WM_CLOSE 可能与窗口创建竞速，
 * 因此取消预算无条件运行（abort 先于 showing 也以 kill 收尾，绝不让 promise
 * 悬空）；settle 只执行一次；对话框标题固定为 Select Workspace Directory。
 * 【新手阅读建议】先读 Win32DialogWorkerLike 与消息协议，再读 pickWin32Directory
 * 的 settle/取消服务两条路径。
 * ==========================================================================
 */
/**
 * Main-thread driver for the Win32 folder dialog: spawns the dialog child
 * process (which blocks inside the modal `Show`), maps its message protocol
 * onto a promise, and services aborts by posting `WM_CLOSE` to the dialog
 * thread's windows until the child reports back. The real process/window
 * surface is injectable so every driver path is testable on any platform.
 */

import { closeThreadWindows as hostCloseThreadWindows, spawnDialogWorker } from './win32-dialog-host.ts'
import type { Win32DialogWorkerData, Win32DialogWorkerMessage } from './win32-dialog-worker.ts'

/** The child-process surface the driver drives (satisfied by `node:child_process`). */
// 驱动操作的子进程表面（由 node:child_process 满足）。
export interface Win32DialogWorkerLike {
  /**
   * Subscribe to a child-process event.
   * @param event - `message`, `error`, or `exit`.
   * @param listener - the event consumer.
   */
  on(event: 'message', listener: (message: Win32DialogWorkerMessage) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: 'exit', listener: (code: number) => void): unknown
  /**
   * Force-stop the child; the abort path's last resort when `WM_CLOSE`
   * never lands (e.g. the dialog window was never created).
   * @returns whether a kill signal was delivered.
   */
  kill(): boolean
  /**
   * Release the event-loop reference. Called once the pick settles so a
   * child stuck in the native modal call never blocks process exit.
   */
  unref?(): void
}

/** Injectable process surface for deterministic driver tests. */
export interface Win32DialogInternals {
  /** Replaces the real child spawn (`win32-dialog-host.ts`). */
  spawnWorker?: (data: Win32DialogWorkerData) => Win32DialogWorkerLike
  /** Replaces the real `WM_CLOSE` poster (`win32-dialog-host.ts`). */
  closeThreadWindows?: (threadId: number) => Promise<void>
  /** Abort-service cadence override so tests never wait wall-clock time. */
  closeRetryMs?: number
}

/** The dialog title every host shows. */
// 所有宿主显示的对话框标题。
export const DIALOG_TITLE = 'Select Workspace Directory'

/** `WM_CLOSE` re-post cadence while an abort waits for the worker to unwind. */
// 取消等待子进程收尾期间重投 WM_CLOSE 的周期。
const CLOSE_RETRY_MS = 150
/** Abort-service attempts before force-terminating the worker. */
// 强制终止子进程前的取消服务尝试次数上限。
const CLOSE_MAX_ATTEMPTS = 20

/** Fail loudly if the closed worker-to-driver union gains an unhandled member. */
// 封闭联合兜底：子进程消息种类新增而未处理时编译失败并抛错。
/* v8 ignore start -- closed-union backstop; unreachable without a TypeScript contract violation */
function assertNever(value: never): never {
  throw new TypeError(`unknown win32 dialog worker message kind: ${String(value)}`)
}
/* v8 ignore stop */

/**
 * Open the modern Win32 folder picker off the event loop.
 * @param signal - caller lifetime; abort closes the dialog and rejects.
 * @param internals - Worker/window hooks for deterministic tests.
 * @returns the selected path, or null when the user cancels.
 */
// 在事件循环之外打开现代 Win32 文件夹选择器：spawn 对话框子进程，监听其
// showing/done/error 消息与 error/exit 事件，settle 只结算一次；abort 触发
// 取消服务（周期重投 WM_CLOSE，超预算后 kill 兜底）并以取消错误拒绝。
export async function pickWin32Directory(
  signal: AbortSignal,
  internals: Win32DialogInternals = {},
): Promise<string | null> {
  if (signal.aborted) throw new Error('native directory picker aborted')
  const spawnWorker = internals.spawnWorker ?? spawnDialogWorker
  const closeWindows = internals.closeThreadWindows ?? hostCloseThreadWindows
  const closeRetryMs = internals.closeRetryMs ?? CLOSE_RETRY_MS

  const worker: Win32DialogWorkerLike = spawnWorker({ title: DIALOG_TITLE })
  let dialogThreadId: number | undefined
  let closeTimer: NodeJS.Timeout | undefined
  let settled = false

  return await new Promise<string | null>((resolve, reject) => {
    const settle = (outcome: () => void): void => {
      if (settled) return
      settled = true
      if (closeTimer !== undefined) clearInterval(closeTimer)
      signal.removeEventListener('abort', onAbort)
      worker.unref?.()
      outcome()
    }

    const postClose = (): void => {
      // Before `showing` there is no window to close; the budget below still
      // runs so a child that never reports cannot dangle the pick. A
      // rejected close attempt (EnumThreadWindows/PostMessageW refusing) is
      // discarded: the interval retries it and kill is the backstop.
      if (dialogThreadId !== undefined) void closeWindows(dialogThreadId).catch(() => undefined)
    }

    // Sole caller: the once-registered abort listener, so no re-entry guard.
    const serviceAbort = (): void => {
      let attempts = 0
      // The `showing` notice precedes the blocking `Show`, so the very first
      // WM_CLOSE can race the window's creation; re-post until the child
      // reports back, then force-kill as a last resort. The budget is
      // unconditional — an abort before `showing` (child hung in koffi or
      // COM init) still ends in kill instead of a dangling promise.
      closeTimer = setInterval(() => {
        attempts += 1
        if (attempts > CLOSE_MAX_ATTEMPTS) {
          settle(() => {
            worker.kill()
            reject(new Error('native directory picker aborted (dialog unresponsive; worker killed)'))
          })
          return
        }
        postClose()
      }, closeRetryMs)
      postClose()
    }

    const onAbort = (): void => {
      serviceAbort()
    }
    signal.addEventListener('abort', onAbort, { once: true })

    worker.on('message', (message: Win32DialogWorkerMessage) => {
      switch (message.kind) {
        case 'showing':
          dialogThreadId = message.threadId
          // An abort that raced ahead of this notice now has a window to hit.
          if (signal.aborted) postClose()
          return
        case 'done':
          settle(() => {
            if (signal.aborted) reject(new Error('native directory picker aborted'))
            else resolve(message.path)
          })
          return
        case 'error':
          settle(() => {
            reject(new Error(`win32 folder dialog failed: ${message.message}`))
          })
          return
        /* v8 ignore next 2 -- closed worker-owned union; a fourth kind becomes a compile error */
        default:
          assertNever(message)
      }
    })
    worker.on('error', (error: Error) => {
      settle(() => {
        reject(error)
      })
    })
    worker.on('exit', () => {
      settle(() => {
        reject(new Error('win32 folder dialog worker exited before reporting a result'))
      })
    })
  })
}
