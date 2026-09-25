/** 双入口目录请求：每次选择持有独立身份，撤销只停止本地采纳，不撤销 Host 已接受的登记。 */
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'

/** 目录入口的可见状态，不保存第二份工作区数据。 */
export interface DirectoryFlowState {
  readonly owner: symbol | undefined
  readonly request: symbol | undefined
  readonly phase: 'idle' | 'picking' | 'adopting' | 'failed'
}

/** Host 登记与官方导航分别负责持久工作区和会话选择。 */
export interface DirectoryFlowActions {
  /**
   * 登记已选 Host 目录。
   * @param path - 选择器返回的 Host 路径。
   * @returns 正式工作区标识。
   */
  create(path: string): Promise<WorkspaceId>
  /**
   * 打开已登记工作区。
   * @param id - 官方登记结果。
   * @param isCurrent - 提交选择前再次判断本请求是否有效。
   * @returns 官方导航完成。
   */
  open(id: WorkspaceId, isCurrent: () => boolean): Promise<void>
}

/** 每个入口与每次请求都使用不同身份，迟到回调不能采纳到另一个入口。 */
export interface DirectoryFlow {
  readonly state: HostObservable<DirectoryFlowState>
  /**
   * 在当前没有活动选择时打开目录流程，失败状态允许重试。
   * @param owner - 已挂载入口的身份。
   * @returns 本次请求身份；另一个活动流程存在或已销毁时返回 undefined。
   */
  begin(owner: symbol): symbol | undefined
  /**
   * 撤销指定入口；不影响另一入口的新请求。
   * @param owner - 待撤销的入口身份。
   */
  withdraw(owner: symbol): void
  /**
   * 处理选择器取消，仅当前请求可结算。
   * @param request - 选择器所属请求。
   */
  dismiss(request: symbol): void
  /** 撤销所有本地目录采纳，用于显式导航或插件卸载。 */
  cancel(): void
  /**
   * 采纳选择器返回的目录；重复或过期回调无副作用。
   * @param request - 本次请求身份。
   * @param path - Host 路径。
   * @returns 登记及导航完成；过期结果不触发导航。
   */
  picked(request: symbol, path: string): Promise<void>
  /**
   * 将当前选择器失败转为可重试状态，不呈现远端诊断。
   * @param request - 失败请求身份。
   */
  failed(request: symbol): void
  /** 永久关闭本实例；后续回调和打开请求不产生操作。 */
  dispose(): void
}

/**
 * 创建共享的双入口目录流程控制器。
 * @param actions - 官方工作区登记与导航动作。
 * @returns 可订阅状态和具有请求身份校验的操作。
 */
export function createDirectoryFlow(actions: DirectoryFlowActions): DirectoryFlow {
  const idle: DirectoryFlowState = { owner: undefined, request: undefined, phase: 'idle' }
  let snapshot = idle
  let disposed = false
  const listeners = new Set<() => void>()
  const publish = (next: DirectoryFlowState): void => {
    if (snapshot === next) return
    snapshot = next
    for (const listener of listeners) listener()
  }
  const current = (request: symbol): boolean => !disposed && snapshot.request === request
  const cancel = (): void => { publish(idle) }
  return {
    state: {
      getSnapshot: () => snapshot,
      subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    },
    begin(owner) {
      if (disposed || snapshot.phase === 'picking' || snapshot.phase === 'adopting') return undefined
      const request = Symbol('directory request')
      publish({ owner, request, phase: 'picking' })
      return request
    },
    withdraw(owner) { if (snapshot.owner === owner) cancel() },
    dismiss(request) { if (current(request)) cancel() },
    cancel,
    async picked(request, path) {
      if (!current(request) || snapshot.phase !== 'picking') return
      publish({ ...snapshot, phase: 'adopting' })
      try {
        const id = await actions.create(path)
        // 工作区登记可能已持久化；只禁止旧请求再次发起导航。
        if (!current(request)) return
        await actions.open(id, () => current(request))
        if (current(request)) cancel()
      } catch {
        // 仅包围目录登记和导航；失败细节不进入页面状态，允许用户重试。
        if (current(request)) publish({ ...snapshot, phase: 'failed' })
      }
    },
    failed(request) {
      if (current(request) && snapshot.phase === 'picking') publish({ ...snapshot, phase: 'failed' })
    },
    dispose() { disposed = true; cancel(); listeners.clear() },
  }
}
