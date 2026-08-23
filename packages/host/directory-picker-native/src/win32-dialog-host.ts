/**
 * ================================ 文件注释 ================================
 * 【文件职责】Win32 对话框驱动的"真实进程"半边：派生对话框子进程（源码或内建
 * 平面）并关闭对话框线程的窗口。模块本身处处可加载（从 native-picker.ts 到
 * 它的导入链是静态的）；只有 koffi 保持 win32 专属——它在绑定函数内部动态导入。
 * 驱动逻辑改用此表面的假实现测试。
 * 【技术维度】spawnDialogWorker：内建消费者以普通 node 启动本模块旁的打包 CJS
 * 入口；未构建（源码）消费者先引导 tsx（镜像 dsh CLI 的源码启动）。对话框是
 * 子进程的第一个窗口，因此 Windows 无需前台调用即可激活它。
 * 【产品维度】Windows 现代目录选择器子进程的派生与取消通道装配。
 * 【逻辑维度】spawnDialogWorker（按源码/内建平面选启动方式）→ 重导出
 * closeThreadWindows。
 * 【关键边界】stdio 配置为 ['ignore','inherit','inherit','ipc']（子进程经 IPC
 * 通道回报）；windowsHide 隐藏控制台窗口。
 * 【新手阅读建议】与 win32-dialog.ts 的驱动与 win32-dialog-worker.ts 的入口
 * 对照阅读。
 * ==========================================================================
 */
/**
 * Real-process half of the Win32 dialog driver: spawn the dialog child
 * process (source or built plane) and close a dialog thread's windows. The
 * module itself loads everywhere (the import chain from native-picker.ts is
 * static); what stays win32-only is koffi, imported dynamically inside the
 * bindings' functions. The driver's logic is tested against fakes of this
 * surface instead.
 */

import { spawn, type StdioOptions } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { Win32DialogWorkerData } from './win32-dialog-worker.ts'

/**
 * Spawn the dialog child process. Built consumers launch the bundled CJS
 * entry next to this module under plain node; unbuilt (source) consumers
 * bootstrap tsx first, mirroring the dsh CLI's source launch. The dialog is
 * the child's first window, so Windows activates it without a foreground
 * call.
 * @param data - the child payload (dialog title).
 * @returns the spawned child process.
 */
// 派生对话框子进程：内建消费者以普通 node 启动本模块旁的打包 CJS 入口；未构建
// （源码）消费者先引导 tsx（镜像 dsh CLI 的源码启动）。对话框是子进程的第一个
// 窗口，Windows 无需前台调用即可激活它。
export function spawnDialogWorker(data: Win32DialogWorkerData): ReturnType<typeof spawn> {
  const env = { ...process.env, DSH_DIALOG_TITLE: data.title }
  const stdio: StdioOptions = ['ignore', 'inherit', 'inherit', 'ipc']
  /* v8 ignore next 3 -- the built-output arm: tests always run unbuilt (src/) */
  if (!import.meta.url.endsWith('.ts')) {
    return spawn(process.execPath, [fileURLToPath(new URL('./worker.cjs', import.meta.url))], { env, stdio, windowsHide: true })
  }
  return spawn(process.execPath, ['--import', import.meta.resolve('tsx/esm'), fileURLToPath(new URL('./win32-dialog-worker.ts', import.meta.url))], { env, stdio, windowsHide: true })
}

export { closeThreadWindows } from './win32-dialog-bindings.ts'
