/**
 * ================================ 文件注释 ================================
 * 【文件职责】`ctx.directoryPicker` 能力接缝的 Service Definition：Web GUI 宿主
 * 如何让操作者选择一个工作区目录。后端在交互形态（而非仅机制）上不同，因此
 * 服务暴露的是判别能力联合而非单一方法集。
 * 【技术维度】Cordis Service 抽象类 + 声明合并注册 Context.directoryPicker；
 * 能力映射 DirectoryPickerCapabilities 可合并扩展（新后端声明合并自己的形状，
 * 无需改本包）；DirectoryPickerError 携带封闭业务码供消费者做类型化映射。
 * 【产品维度】native 后端在宿主显示器上打开一个 OS 选择器；browse 后端为应用
 * 内浏览器提供列表/创建原语（从而也服务远程客户端——OS 对话框无法触达）。
 * 【逻辑维度】native 能力（pick）→ 目录条目/列表类型 → browse 能力（list/
 * createDirectory）→ 能力映射与派生联合 → 错误词汇 → DirectoryPicker 抽象服务。
 * 【关键边界】消费者按 capability().kind 切换；联合可合并扩展，未知 kind 的
 * 文档化默认是"隐藏拾取控件"而非失败；能力对象必须在服务生命周期内稳定
 * （消费者可跨调用捕获它）；每 context 只能装载一个实现。
 * 【新手阅读建议】先读两个能力接口，再看 DirectoryPickerCapabilities 的扩展
 * 机制，最后读 DirectoryPickerError 与抽象服务类。
 * ==========================================================================
 */
/**
 * Service Definition for the `ctx.directoryPicker` capability seam: how the web-GUI host lets an operator
 * select a workspace directory. Backends differ in interaction shape, not
 * just mechanism, so the service exposes a discriminated capability instead
 * of one method set: a `native` backend opens one OS chooser on the
 * host's display, while a `browse` backend serves listing/creation primitives
 * for an in-app browser (and thereby works for remote clients no OS dialog
 * can reach). Consumers switch on `capability().kind`; the union is
 * merge-extensible, and the documented default for an unknown kind is to
 * hide the picking affordance rather than fail.
 * @module @deepseek-ai/dsh-host-directory-picker
 */

import { Context, Service } from '@deepseek-ai/cordis'

/** The native interaction: one OS directory chooser on the host display. */
// native 交互：宿主显示器上的一个 OS 目录选择器。
export interface DirectoryPickerNativeCapability {
  kind: 'native'
  /**
   * Open the chooser and wait for the operator.
   * @param signal - caller/connection lifetime; abort terminates the chooser.
   * @returns the chosen absolute path, or null when the operator cancels.
   */
  pick(signal: AbortSignal): Promise<string | null>
}

/** One directory row: a listing child or a breadcrumb ancestor. */
export interface DirectoryEntry {
  /** Base name shown in a browser row (a root crumb carries its full path). */
  name: string
  /** Absolute host path — clients never join path segments themselves. */
  path: string
  /** Hidden by the host platform's convention (dot-prefixed on POSIX); the client owns whether to show it. */
  hidden: boolean
}

/** One directory level plus its ancestry, as a browse backend reports it. */
export interface DirectoryListing {
  /** Absolute path of the listed directory. */
  path: string
  /** The host account's home directory (breadcrumb "Home" rooting). */
  home: string
  /**
   * Ancestor chain from the filesystem root to the listed directory
   * inclusive; every crumb is a jump target (crumb `hidden` is always false).
   */
  crumbs: DirectoryEntry[]
  /** Direct child directories, name-sorted; symlinks to directories included. */
  entries: DirectoryEntry[]
  /**
   * True when the backend cut `entries` at its complete-result bound: the
   * level has more child directories than reported, and the missing rows are
   * the name-sorted tail (hidden rows count toward the bound).
   */
  truncated: boolean
}

/**
 * The browse interaction: listing/creation primitives an in-app browser
 * drives one level at a time. Works for remote clients — nothing renders on
 * the host display.
 */
// browse 交互：应用内浏览器逐层驱动的列表/创建原语，也服务远程客户端。
export interface DirectoryPickerBrowseCapability {
  kind: 'browse'
  /**
   * List one directory level.
   * @param path - absolute directory to list; absent lists the home directory.
   * @param signal - caller lifetime; abort stops the scan (a stalled network
   * directory must not outlive a disconnected caller) and rejects with the
   * abort reason.
   * @returns the level's listing with ancestry; backends bound the complete
   * result, and a cut level reports `truncated`.
   * @throws {DirectoryPickerError} `directory-unreadable` when the target is not fully
   * qualified (a wire value must never resolve against the host cwd or, on
   * Windows, its current drive) or cannot be listed.
   */
  list(path?: string, signal?: AbortSignal): Promise<DirectoryListing>
  /**
   * Create one child directory under an existing parent.
   * @param path - absolute existing parent directory.
   * @param name - single non-blank path segment (no separators, not `.`/`..`).
   * @returns the created directory's absolute path.
   * @throws {DirectoryPickerError} `directory-exists` for an existing child,
   * `directory-create-failed` for a parent that is not fully qualified or any other failure.
   */
  createDirectory(path: string, name: string): Promise<string>
}

/**
 * Merge-extensible registry of interaction shapes keyed by capability kind: a
 * new backend declaration-merges its shape here (the entry's `kind` literal
 * must equal its key) instead of editing this package.
 */
// 按能力 kind 键控的可合并扩展交互形状注册表：新后端声明合并其形状（条目
// kind 字面量必须等于键）即可，无需编辑本包。
export interface DirectoryPickerCapabilities {
  native: DirectoryPickerNativeCapability
  browse: DirectoryPickerBrowseCapability
}

/** Union of interaction shapes a backend can provide, derived from the merge-extensible {@link DirectoryPickerCapabilities} map. */
// 后端可提供的交互形状联合：从可合并扩展的映射派生。
export type DirectoryPickerCapability = DirectoryPickerCapabilities[keyof DirectoryPickerCapabilities]

/** Closed failure vocabulary of the browse primitives (mirrored onto the wire by consumers). */
// browse 原语的封闭失败词汇（消费者会镜像到线上）。
export type DirectoryPickerErrorCode = 'directory-unreadable' | 'directory-exists' | 'directory-create-failed'

/** Typed failure thrown by browse primitives so consumers can map business codes without string matching. */
// browse 原语抛出的类型化失败：消费者无需字符串匹配即可映射业务码。
export class DirectoryPickerError extends Error {
  /**
   * @param code - closed business code of the failure.
   * @param path - the absolute path the failure is about.
   * @param message - operator-facing description.
   */
  constructor(readonly code: DirectoryPickerErrorCode, readonly path: string, message: string) {
    super(message)
    this.name = 'DirectoryPickerError'
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    directoryPicker: DirectoryPicker
  }
}

/**
 * Abstract directory-picking service. Subclass, implement `capability()`, and
 * load the subclass as a plugin — it registers as `ctx.directoryPicker` (one
 * implementation per context; loading a second throws, cordis' standard
 * duplicate-service behavior). The capability object must be stable for the
 * service lifetime: consumers may capture it across calls.
 */
// 抽象目录选择服务：子类实现 capability() 并作为插件装载，注册为
// ctx.directoryPicker（每 context 一个实现，装载第二个会抛重复服务错误）。
// 能力对象必须在服务生命周期内稳定——消费者可能跨调用捕获它。
export abstract class DirectoryPicker extends Service {
  constructor(ctx: Context) {
    super(ctx, 'directoryPicker')
  }

  /**
   * The backend's interaction capability.
   * @returns the discriminated capability consumers switch on.
   */
  abstract capability(): DirectoryPickerCapability
}

export default DirectoryPicker
