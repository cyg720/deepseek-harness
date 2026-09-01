/** Injected faces and the Package-owned `tool.view.cordis` slot declaration. */

/*
 * ================================ 文件注释 ================================
 * 【文件职责】ui-cordis 各 UI 面（face）的注入类型契约，以及包自有的
 *             `tool.view.cordis` 槽位声明：动态包 Client 代码注册业务视图的锚点。
 * 【技术维度】slots 系统的 keyed 槽位声明（kind: 'keyed'、scope: 'session'、owner
 *             载荷）；各 face 接口承载组件所需的 hooks 与回调；声明合并把新槽位
 *             注册进 SlotMap。
 * 【产品维度】让动态插件可以在"最新一次成功的 cordis_run 卡片"里渲染可交互的
 *             业务 UI（表单/按钮等），用户直接在对话流里操作，而不是只读文本。
 * 【逻辑维度】owner 载荷 → 槽位声明 → 三种 face（Define/Run/Panel）契约。
 * 【关键边界】业务视图必须由 Client 守卫把 key:'self' 绑定到当前插件/包；face
 *             只承载数据与回调，不承载组件实现。
 * 【新手阅读建议】先看槽位声明理解业务视图挂载点，再看三个 face 的字段。
 * ==========================================================================
 */

import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  CordisRunActivity, CordisRunFailure, CordisUserRunRequest, DynamicCordisLivePackage,
  DynamicCordisRenderFailure,
} from '@deepseek-ai/dsh-cordis-client-runner/client'
import type { CordisActionResult } from './dynamic-port.ts'
import type { CordisInventory } from './inventory.ts'
import type { CordisRunCardPointer, CordisRunCardStore } from './run-card-index.ts'
import type {
  ApprovalRequestId, CordisDynamicPackageId, CordisDynamicPluginId, CordisDynamicPluginRunId,
} from './events.ts'

/** Owner currency delivered to a dynamic Package's business view. */
export interface CordisToolViewOwnerProps {
  readonly pluginId: CordisDynamicPluginId
  readonly packageId: CordisDynamicPackageId
  readonly pluginRunId: CordisDynamicPluginRunId
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * Interactive Package-owned region rendered inside the latest eligible
     * `cordis_run` card in the conversation flow. Use it for controls and other
     * UI the user can interact with. Dynamic Client code registers with
     * `key: 'self'`; the Guard binds that key to the current Plugin and Package.
     */
    'tool.view.cordis': {
      kind: 'keyed'
      scope: 'session'
      owner: CordisToolViewOwnerProps
    }
  }
}

/** Live facts used by the read-only Define card. */
export interface CordisCardFace {
  hooks: {
    inventory: CordisInventory
    loaded: HostObservable<readonly DynamicCordisLivePackage[]>
  }
}

/** Live facts used by the Run card and its business-view ownership index. */
export interface CordisRunCardFace extends CordisCardFace {
  hooks: CordisCardFace['hooks'] & {
    runCards: CordisRunCardStore
    activeRuns: HostObservable<ReadonlyMap<CordisDynamicPluginId, CordisRunActivity>>
  }
  /** Publish this successful result into the session's latest-card index. */
  onObserveRunCard(pointer: CordisRunCardPointer): void
}

/** Frame-wide panel state and lifecycle verbs. */
export interface CordisPanelFace {
  hooks: {
    inventory: CordisInventory
    activeRuns: HostObservable<ReadonlyMap<CordisDynamicPluginId, CordisRunActivity>>
    runErrors: HostObservable<ReadonlyMap<CordisDynamicPluginId, CordisRunFailure>>
    renderFailures: HostObservable<ReadonlyMap<CordisDynamicPluginId, DynamicCordisRenderFailure>>
    loaded: HostObservable<readonly DynamicCordisLivePackage[]>
  }
  onApprove(requestId: ApprovalRequestId, approveFutureVersions: boolean): Promise<void>
  onDecline(requestId: ApprovalRequestId): Promise<void>
  onRun(request: CordisUserRunRequest): Promise<void>
  onStop(sessionId: SessionId, pluginId: CordisDynamicPluginId): Promise<CordisActionResult>
  onRemove(sessionId: SessionId, pluginId: CordisDynamicPluginId): Promise<CordisActionResult>
  onRefresh(): void
}
