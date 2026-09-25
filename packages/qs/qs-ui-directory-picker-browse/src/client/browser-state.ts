/** 浏览目录只使用 Host 返回的完整路径；扫描和创建结果受当前流程生命周期约束。 */
import type { DirectoryListing } from '@deepseek-ai/dsh-api-remotes/client'

/** 官方工作区服务向浏览器提供的文件操作。 */
export interface BrowseOperations {
  /** 读取目录；省略路径表示 Host 主目录。 */
  listDirectory: (path?: string, signal?: AbortSignal) => Promise<DirectoryListing>
  /** 创建子目录并返回 Host 规范化后的完整路径。 */
  createDirectory: (path: string, name: string) => Promise<string>
}

/** 最近一次成功的目录保留显示，错误和等待期间不得确认旧路径。 */
export interface BrowseSnapshot {
  readonly listing: DirectoryListing | undefined
  readonly loading: boolean
  readonly creating: boolean
  readonly error: 'list' | 'create' | undefined
}

/** 一个已打开窗口的操作与订阅；窗口关闭后必须释放。 */
export interface BrowseController {
  /** 返回供 React 订阅的稳定快照。
   * @returns 当前目录和操作状态。
   */
  getSnapshot(this: void): BrowseSnapshot
  /** 订阅状态变化。
   * @param listener - 界面刷新回调。
   * @returns 取消订阅函数。
   */
  subscribe(this: void, listener: () => void): () => void
  /** 跳转到完整 Host 路径并取消前一次扫描。
   * @param path - Host 路径，省略时使用 Host 主目录。
   * @returns 扫描完成或被替代后结算。
   */
  navigate(path?: string): Promise<void>
  /** 重试失败的目录读取，不重放目录创建。
   * @returns 重试扫描的完成信号。
   */
  retry(): Promise<void>
  /** 在当前目录创建一个子目录并浏览新目录。
   * @param name - 用户输入的子目录名称，由 Host 验证合法性。
   * @returns 创建及后续扫描完成；失败保留可重试界面。
   */
  create(name: string): Promise<void>
  /** 终止扫描并使在途创建失去导航权；不会删除已经创建的目录。 */
  dispose(): void
}

/**
 * 管理一个浏览窗口；创建不支持 RPC 取消，关闭只撤销其后续界面操作。
 * @param operations - 绑定到唯一官方 uiWorkspace 服务的操作。
 * @returns 仅在本窗口存活期间发布状态的控制器。
 */
export function createBrowseController(operations: BrowseOperations): BrowseController {
  let state: BrowseSnapshot = { listing: undefined, loading: false, creating: false, error: undefined }
  const listeners = new Set<() => void>()
  let disposed = false
  const isDisposed = (): boolean => disposed
  let scan: AbortController | undefined
  let requestedPath: string | undefined
  const publish = (next: BrowseSnapshot): void => {
    state = next
    for (const listener of listeners) listener()
  }
  const navigate = async (path?: string): Promise<void> => {
    if (isDisposed() || state.creating) return
    scan?.abort()
    const current = new AbortController()
    scan = current
    requestedPath = path
    publish({ ...state, loading: true, error: undefined })
    try {
      const listing = await operations.listDirectory(path, current.signal)
      if (isDisposed() || scan !== current) return
      publish({ listing, loading: false, creating: false, error: undefined })
    } catch {
      // 取消/过期扫描不属于当前窗口的错误；Host 诊断不直接写入产品界面。
      if (isDisposed() || scan !== current) return
      publish({ ...state, loading: false, error: 'list' })
    }
  }
  return {
    getSnapshot: () => state,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    navigate,
    retry: () => navigate(requestedPath),
    async create(name) {
      if (isDisposed() || state.loading || state.creating || state.listing === undefined || state.error === 'list') return
      const parent = state.listing.path
      publish({ ...state, creating: true, error: undefined })
      try {
        const path = await operations.createDirectory(parent, name)
        if (isDisposed()) return
        publish({ ...state, creating: false })
        await navigate(path)
      } catch {
        // 创建无撤销接口；失败只允许用户明确重试，不能因重绘自动重放副作用。
        if (isDisposed()) return
        publish({ ...state, creating: false, error: 'create' })
      }
    },
    dispose() {
      disposed = true
      scan?.abort()
      listeners.clear()
    },
  }
}
