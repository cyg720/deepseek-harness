/*
 * ================================ 文件注释 ================================
 * 【文件职责】host 域契约：宿主级一元方法（describe / pickDirectory /
 * listDirectory / createDirectory / openPath）与目录条目/列表类型。
 * 【技术维度】纯类型契约；当前无协议版本号——客户端与宿主同发同署，只有出现
 * 独立发布的客户端时才需要引入 protocolVersion。
 * 【产品维度】远程 GUI 的"宿主"面板能力：查看宿主快照、系统目录选择器、应用
 * 内目录浏览器（含面包屑）、新建文件夹、用系统默认应用打开路径。
 * 【逻辑维度】DirectoryEntry（单行条目）→ DirectoryListing（一层目录 + 祖先链）
 * → HostApi 五个一元方法。
 * 【关键边界】pickDirectory 仅在 native 能力下服务；listDirectory/createDirectory
 * 仅在 browse 能力下服务；openPath 受浏览器载体前缀级信任栅栏保护；客户端从不
 * 自行拼接路径段（host 总是返回绝对路径）。
 * 【新手阅读建议】先看 HostApi 各方法的 JSDoc 语义，再对照 api-proxy.ts 的 host
 * 域实现理解能力分派与错误映射。
 * ==========================================================================
 */
/**
 * host domain contract. No protocol version: client and host ship
 * together; introduce protocolVersion only when an independently released client appears.
 */

import type { RpcRequest, RpcResponse } from './rpc.ts'

/** One directory row of a listing: a child entry or a breadcrumb ancestor. */
// 目录列表的一行：可以是子条目，也可以是面包屑祖先。
export interface DirectoryEntry {
  /** Base name shown in a browser row (a root crumb carries its full path). */
  // 浏览器行中显示的基名（根面包屑携带完整路径）。
  name: string
  /** Absolute host path — the client never joins path segments itself. */
  // 宿主绝对路径——客户端绝不自行拼接路径段。
  path: string
  /** Hidden by the host platform's convention (dot-prefixed on POSIX); the client owns whether to show it. */
  // 宿主平台惯例判定是否隐藏（POSIX 点前缀）；是否展示由客户端决定。
  hidden: boolean
}

/** host.listDirectory response value: one directory level plus its ancestry. */
// host.listDirectory 的响应值：一层目录内容 + 祖先链。
export interface DirectoryListing {
  /** Absolute path of the listed directory. */
  // 被列出目录的绝对路径。
  path: string
  /** The host account's home directory (breadcrumb "Home" rooting). */
  // 宿主账户的主目录（面包屑 "Home" 的根）。
  home: string
  /**
   * Ancestor chain from the filesystem root to the listed directory
   * inclusive; every crumb is a jump target (crumb `hidden` is always false).
   */
  // 从文件系统根到被列出目录（含）的祖先链；每个面包屑都是跳转目标。
  crumbs: DirectoryEntry[]
  /** Direct child directories, name-sorted; symlinks to directories included. */
  // 直接子目录（按名排序，含指向目录的符号链接）。
  entries: DirectoryEntry[]
  /** True when the backend cut `entries` at its complete-result bound (the name-sorted tail is absent). */
  // 后端在完整结果边界处截断 entries 时为 true（按名排序的尾部缺失）。
  truncated: boolean
}

/** Host-level unary methods. */
// 宿主级一元方法接口。
export interface HostApi {
  /**
   * One-shot host snapshot. Empty payload uses the literal `{}` (extend in place when fields arrive).
   * version = the host app's (apps/cli) package.json version; cwd = the host process working
   * directory (root for session persistence and tool execution); provider/model = the defaults
   * applied when a new agent doesn't specify them explicitly, absent when the host configures
   * no explicit default (the adapter falls back internally);
   * attachedSessions = count of currently attached sessions (those with a live agent);
   * home = the host account home directory (Web display abbreviation on POSIX);
   * canOpenPath = whether this deployment can hand a path to a user-visible native desktop.
   */
  describe(request: RpcRequest<{}>): Promise<RpcResponse<{
    version: string
    cwd: string
    provider?: string
    model?: string
    attachedSessions: number
    home: string
    canOpenPath: boolean
  }>>

  /**
   * Open the operating system's single-directory picker; cancellation returns
   * null. Only served under the `native` capability.
   */
  pickDirectory(
    request: RpcRequest<{}>,
    signal: AbortSignal,
  ): Promise<RpcResponse<{ path: string | null }>>

  /**
   * List one directory level for the in-app browser; an absent path lists the
   * host account's home directory. Only served under the `browse` capability;
   * unreadable or missing targets fail with `directory-unreadable`. The
   * carrier's request signal follows the caller, stopping the backend's scan
   * on disconnect or timeout.
   */
  listDirectory(
    request: RpcRequest<{ path?: string }>,
    signal: AbortSignal,
  ): Promise<RpcResponse<DirectoryListing>>

  /**
   * Create one child directory under an existing parent (the browser's
   * "New folder"). Only served under the `browse` capability; an existing
   * child fails with `directory-exists`, every other filesystem failure with
   * `directory-create-failed`.
   */
  createDirectory(
    request: RpcRequest<{ path: string; name: string }>,
  ): Promise<RpcResponse<{ path: string }>>

  /**
   * Open a filesystem path with the operating system's default application
   * (Finder / Explorer / xdg-open hand-off). The browser carrier's
   * prefix-wide trust fence covers this privileged method like every other
   * `/api` request.
   */
  openPath(
    request: RpcRequest<{ path: string }>,
    signal: AbortSignal,
  ): Promise<RpcResponse<{ opened: true }>>
}
