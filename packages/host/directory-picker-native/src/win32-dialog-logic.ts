/*
 * ================================ 文件注释 ================================
 * 【文件职责】Win32 IFileOpenDialog 文件夹选择器 COM 对话的纯编排：在可注入的
 * 平台绑定之上运行，使每条结果路径（选择/取消/HRESULT 失败/清理顺序）都能在
 * 任何平台测试。koffi 背书的绑定位于 win32-dialog-bindings.ts，只有真实 win32
 * 进程才会加载它。
 * 【技术维度】纯同步编排：DPI 感知 → STA COM 初始化 → 创建对话框 → SetOptions
 * （FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_NOCHANGEDIR）→ SetTitle →
 * 通知 showing（带线程 id）→ 阻塞 Show → 取消返回 null → 取结果路径；对话框与
 * COM 公寓在 finally 中保证释放/反初始化。
 * 【产品维度】Windows 现代目录选择器的"对话脚本"：只选目录、只允许文件系统
 * 结果、不改进程工作目录。
 * 【逻辑维度】HRESULT/选项常量 → Win32FolderDialog 与 Win32DialogBindings 接口
 * → check（HRESULT 校验）→ runFolderDialog（完整对话序列）。
 * 【关键边界】HRESULT_CANCELLED（0x800704c7）是用户关闭对话框的信号，返回
 * null 而非报错；Show 成功后 GetResult/GetDisplayName 失败会抛错。
 * 【新手阅读建议】与 win32-dialog-bindings.ts 的绑定实现对照阅读。
 * ==========================================================================
 */
/**
 * Pure sequencing of the Win32 `IFileOpenDialog` folder-picker COM
 * conversation over injectable platform bindings, so every outcome path
 * (selection, cancellation, HRESULT failure, cleanup ordering) is testable on
 * any platform. The koffi-backed bindings live in
 * `win32-dialog-bindings.ts`, which only a real win32 process ever loads.
 */

/** `HRESULT_FROM_WIN32(ERROR_CANCELLED)`: the user dismissed the dialog. */
// HRESULT_FROM_WIN32(ERROR_CANCELLED)：用户关闭了对话框。
export const HRESULT_CANCELLED = 0x800704c7 | 0

/** `FOS_PICKFOLDERS`: the dialog selects directories, not files. */
// FOS_PICKFOLDERS：对话框选择目录而非文件。
export const FOS_PICKFOLDERS = 0x20
/** `FOS_FORCEFILESYSTEM`: only results with a filesystem path can be chosen. */
// FOS_FORCEFILESYSTEM：只允许带文件系统路径的结果。
export const FOS_FORCEFILESYSTEM = 0x40
/** `FOS_NOCHANGEDIR`: never mutate the process working directory. */
// FOS_NOCHANGEDIR：绝不改动进程工作目录。
export const FOS_NOCHANGEDIR = 0x8

/** One created folder dialog: the vtable calls the sequencing needs. */
// 一个已创建的文件夹对话框：编排所需的 vtable 调用集合。
export interface Win32FolderDialog {
  /**
   * `IFileDialog::SetOptions`.
   * @param options - the `FOS_*` flag union to apply.
   * @returns the call's HRESULT.
   */
  setOptions(options: number): number
  /**
   * `IFileDialog::SetTitle`.
   * @param title - the dialog title text.
   * @returns the call's HRESULT.
   */
  setTitle(title: string): number
  /**
   * `IModalWindow::Show` with no owner window; blocks the calling thread
   * until the user selects or dismisses.
   * @returns the call's HRESULT (`HRESULT_CANCELLED` on dismissal).
   */
  show(): number
  /**
   * `IFileDialog::GetResult` + `IShellItem::GetDisplayName(SIGDN_FILESYSPATH)`,
   * releasing the shell item and freeing the COM string.
   * @returns the call chain's HRESULT and, on success, the selected path.
   */
  resultPath(): { hr: number; path?: string }
  /** Release the dialog's COM reference. */
  release(): void
}

/** The thread-level native surface the dialog sequencing runs against. */
// 对话框编排运行的线程级原生表面。
export interface Win32DialogBindings {
  /**
   * Opt the calling thread into the best supported DPI awareness
   * (per-monitor-v2, then per-monitor, then system-aware), checking each
   * call's result. Best-effort on purpose: a host accepting none of them
   * (or lacking the API, pre-1607) still shows the modern dialog — possibly
   * blurry above 100 % scaling — because a cosmetic degradation must not
   * cost the tier.
   */
  setThreadDpiAwareness(): void
  /**
   * `CoInitializeEx(COINIT_APARTMENTTHREADED)` on the calling thread.
   * @returns the call's HRESULT (`S_FALSE` re-entry is still a success).
   */
  coInitializeSta(): number
  /**
   * `CoUninitialize` on the calling thread — COM requires one pairing call
   * for every successful (including `S_FALSE`) `CoInitializeEx`, even on a
   * thread that exits right after the conversation.
   */
  coUninitialize(): void
  /**
   * `CoCreateInstance(CLSID_FileOpenDialog)`.
   * @returns the created dialog surface; throws when creation fails.
   */
  createFolderDialog(): Win32FolderDialog
  /**
   * `GetCurrentThreadId` — the native id a driver needs to close this
   * thread's windows from outside.
   * @returns the calling thread's native id.
   */
  currentThreadId(): number
}

/**
 * Throw when an HRESULT signals failure.
 * @param hr - the HRESULT to check.
 * @param what - the failing call's name for the error message.
 * @returns the (successful) HRESULT unchanged.
 */
// HRESULT 失败即抛错（附调用名与十六进制码），成功原样返回。
function check(hr: number, what: string): number {
  if (hr < 0) throw new Error(`${what} failed: HRESULT 0x${(hr >>> 0).toString(16)}`)
  return hr
}

/**
 * Run one modal folder-picker conversation on the calling thread: DPI opt-in,
 * STA init, dialog creation, `Show`, and result extraction, releasing the
 * dialog on every path.
 * @param bindings - the native surface (koffi-backed in production, fakes in tests).
 * @param title - the dialog title text.
 * @param onShowing - called with the native thread id immediately before the
 *   blocking `Show`, so a driver on another thread can close the dialog.
 * @returns the selected filesystem path, or null when the user cancels.
 */
// 在调用线程上跑完一次模态文件夹选择对话：DPI 选入 → STA 初始化 → 创建对话框
// → 选项/标题 → 阻塞 Show → 取结果；对话框与 COM 公寓在每条路径上都保证释放/
// 反初始化（S_OK 与 S_FALSE 都算初始化成功，必须成对反初始化一次）。
export function runFolderDialog(
  bindings: Win32DialogBindings,
  title: string,
  onShowing: (threadId: number) => void,
): string | null {
  bindings.setThreadDpiAwareness()
  check(bindings.coInitializeSta(), 'CoInitializeEx')
  // From here the apartment is initialized (S_OK or S_FALSE) and must be
  // uninitialized exactly once on every path.
  try {
    const dialog = bindings.createFolderDialog()
    try {
      check(dialog.setOptions(FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_NOCHANGEDIR), 'SetOptions')
      check(dialog.setTitle(title), 'SetTitle')
      onShowing(bindings.currentThreadId())
      const shown = dialog.show()
      if (shown === HRESULT_CANCELLED) return null
      check(shown, 'Show')
      const result = dialog.resultPath()
      check(result.hr, 'GetResult')
      return result.path as string
    } finally {
      dialog.release()
    }
  } finally {
    bindings.coUninitialize()
  }
}
