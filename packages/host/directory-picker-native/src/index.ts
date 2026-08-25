/*
 * ================================ 文件注释 ================================
 * 【文件职责】directory-picker 接缝的 native 后端：以 native 能力注册
 * ctx.directoryPicker，每次拾取在宿主显示器上打开一个原生 OS 选择器——
 * macOS 用 osascript、Linux 用 Zenity（KDialog 兜底）、Windows 在派生子进程里
 * 打开现代 IFileOpenDialog（子进程主线程上 koffi 驱动的 COM 会话）。
 * 【技术维度】Cordis 插件：继承抽象 DirectoryPicker，实现 capability() 返回
 * 稳定的 native 能力对象；实际拾取逻辑委托给 native-picker.ts 的
 * pickNativeDirectory。
 * 【产品维度】操作者坐在宿主屏幕前的本地场景：系统原生目录选择器；远程部署
 * 组合 browse 后端代替。
 * 【逻辑维度】导入能力接缝与拾取函数 → NativeDirectoryPicker 类（能力对象 +
 * capability()）。
 * 【关键边界】仅在操作者在宿主屏幕前时可行；能力对象在服务生命周期内稳定。
 * 【新手阅读建议】与 native-picker.ts 的平台分派及接缝目录的抽象类对照阅读。
 * ==========================================================================
 */
/**
 * Native backend of the directory-picker seam: registers `ctx.directoryPicker`
 * with the `native` capability, opening one native OS chooser on the host
 * display per pick (macOS `osascript`, Linux Zenity with a KDialog fallback;
 * Windows opens the modern `IFileOpenDialog` in a spawned child process — a
 * koffi-driven COM conversation on the child's main thread). Only viable when
 * the operator sits at the host's screen; remote deployments compose the
 * browse backend instead.
 * @module @deepseek-ai/dsh-host-directory-picker-native
 */

import { DirectoryPicker } from '@deepseek-ai/dsh-host-directory-picker'
import type { DirectoryPickerCapability } from '@deepseek-ai/dsh-host-directory-picker'
import { pickNativeDirectory } from './native-picker.ts'

export type { DirectoryPickerInternals, DirectoryPickerRunner } from './native-picker.ts'
export { pickNativeDirectory } from './native-picker.ts'

/** The `ctx.directoryPicker` native implementation (stable capability object per service life). */
// ctx.directoryPicker 的 native 实现（能力对象在服务生命周期内稳定）。
export default class NativeDirectoryPicker extends DirectoryPicker {
  /** 稳定的 native 能力对象：把拾取委托给 pickNativeDirectory。 */
  private readonly nativeCapability: DirectoryPickerCapability = {
    kind: 'native',
    /* v8 ignore next -- pure forward to pickNativeDirectory (its spec owns behavior); invoking here opens a real chooser. */
    pick: signal => pickNativeDirectory(signal),
  }

  /**
   * The native interaction capability.
   * @returns the stable `native` capability object.
   */
  capability(): DirectoryPickerCapability {
    return this.nativeCapability
  }
}
