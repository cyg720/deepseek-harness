/*
 * ================================ 文件注释 ================================
 * 【文件职责】Win32 文件夹对话框的子进程入口：让本进程阻塞在模态 Show 内，使
 * 宿主事件循环保持活跃，经 IPC 通道回报。作为子进程（而非 worker 线程）派生，
 * 让对话框成为进程的第一个窗口，Windows 无需手动前台调用即可激活它。
 * 【技术维度】协议：阻塞调用前先发 {kind:'showing',threadId}（驱动的取消杠杆
 * 需要原生线程 id），随后恰好一条 {kind:'done',path} 或 {kind:'error',message}；
 * 标题经环境变量 DSH_DIALOG_TITLE 传入；发送后刷新通道；父进程断开则退出。
 * 【产品维度】Windows 现代目录选择器的子进程半边。
 * 【逻辑维度】载荷/消息类型 → 标题与 IPC 前置校验 → post（发送并刷新）→
 * disconnect 退出守卫 → 异步主流程（加载绑定 → 跑对话 → 回报 done/error）。
 * 【关键边界】标题缺失或非子进程（无 IPC 通道）直接抛错；无顶层 await——内建
 * worker 以 CJS 分发，不能携带 TLA。
 * 【新手阅读建议】与 win32-dialog.ts 的驱动与 win32-dialog-logic.ts 的对话序列
 * 对照阅读。
 * ==========================================================================
 */
/**
 * Child-process entry for the Win32 folder dialog: blocks THIS process
 * inside the modal `Show` so the host event loop stays live, reporting over
 * the IPC channel. Spawned as a child process (not a worker thread) so the
 * dialog is the process's first window and Windows activates it without a
 * manual foreground call. Protocol: `{kind:'showing',threadId}` right
 * before the blocking call (the driver's abort lever needs the native
 * thread id), then exactly one of `{kind:'done',path}` or
 * `{kind:'error',message}`.
 */

import { loadWin32DialogBindings } from './win32-dialog-bindings.ts'
import { runFolderDialog } from './win32-dialog-logic.ts'

/** The driver-to-child payload: the dialog title (passed via env). */
// 驱动发给子进程的载荷：对话框标题（经环境变量传递）。
export interface Win32DialogWorkerData { title: string }

/** One notice or outcome posted back to the driver. */
// 回报给驱动的一条通知或结果。
export type Win32DialogWorkerMessage =
  | { kind: 'showing'; threadId: number }
  | { kind: 'done'; path: string | null }
  | { kind: 'error'; message: string }

const title = process.env.DSH_DIALOG_TITLE ?? ''
if (title === '') throw new Error('win32-dialog-worker: DSH_DIALOG_TITLE is required')
if (process.send === undefined) throw new Error('win32-dialog-worker must run as a child process with an IPC channel')
// node's internal `send` reads `this.connected`, so bind the receiver.
// node 内部的 send 读取 this.connected，因此绑定接收者。
const send = process.send.bind(process)

// 发送一条消息：发送后刷新通道（循环排空时进程退出）。
const post = (message: Win32DialogWorkerMessage): void => {
  // Flush before closing the channel; the process exits when the loop drains.
  /* v8 ignore next 3 -- disconnect needs a live IPC channel the unit lane must not sever (built-worker.e2e.ts owns the real close path). */
  send(message, () => { if (process.connected) process.disconnect() })
}

// A settled driver (or a dead parent) must not orphan a dialog still on screen.
// 已结算的驱动（或已死父进程）绝不能留下仍挂在屏幕上的对话框——父断开即退出。
/* v8 ignore next 3 -- the handler exits(0), which would kill the unit lane; built-worker.e2e.ts owns the real disconnect lifecycle. */
process.on('disconnect', () => process.exit(0))

// No top-level await: the built worker ships as CJS, which cannot carry TLA.
// 无顶层 await：内建 worker 以 CJS 分发，无法携带 TLA。主流程：加载绑定 →
// 跑对话（阻塞前先回报 showing）→ 回报 done；异常回报 error（含栈）。
void (async () => {
  try {
    const bindings = await loadWin32DialogBindings()
    const path = runFolderDialog(bindings, title, (threadId) => {
      post({ kind: 'showing', threadId } satisfies Win32DialogWorkerMessage)
    })
    post({ kind: 'done', path } satisfies Win32DialogWorkerMessage)
  } catch (error: unknown) {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
    post({ kind: 'error', message } satisfies Win32DialogWorkerMessage)
  }
})()
