/** Read-only projection of the current Cordis Loader plugin entries. */

/*
 * ================================ 文件注释 ================================
 * 【文件职责】当前 Cordis Loader 插件条目的只读投影：把 Loader 的非组条目
 * 状态暴露为一个 Typert Remote 服务（pluginInventory.list），供受信客户端
 * 枚举已装插件。
 * 【技术维度】TypertRemoteService 远程服务（@Remote('list') 装饰器）；每次
 * 调用直接读 Loader（不缓存——Cordis 内部 plugin/status 事件已维护 fiber 状态，
 * 再加缓存只会多出一个需要同步的生命周期真相）；FiberState 是跨包 const enum，
 * 这里做运行时镜像并投影为字符串阶段。
 * 【产品维度】宿主 GUI 的"已装插件"面板：名称、启用状态与生命周期阶段
 * （pending/loading/active/failed/unloading），驱动插件管理与诊断界面。
 * 【逻辑维度】类型导出 → 品牌函数（pluginEntryId）→ Fiber 状态/阶段映射表 →
 * PluginInventoryGateway 远程服务（list 方法枚举并投影）。
 * 【关键边界】只投影非组条目（entry.options.group 跳过）；entry.fiber 缺失时
 * 阶段为 null；DISPOSED 状态投影为 null（已卸载的根 fiber 没有可展示阶段）。
 * 【新手阅读建议】先看 types.ts 的契约类型，再看 list() 如何从 Loader 条目
 * 投影成快照；与 invariant.ts 的"无运行时不变量"理由对照阅读。
 * ==========================================================================
 */

import type { Context, FiberState } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
// Type-only: the optional agent-preset roster resolved through `ctx.get`.
import type {} from '@deepseek-ai/dsh-agent-presets'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
// Typert-generated ./typert and ./remote artifacts import Zod at runtime.
import type {} from 'zod'
import type {
  AgentPresetPluginGroup,
  PluginEntryId,
  PluginFiberPhase,
  PluginInventoryEntry,
  PluginInventorySnapshot,
} from './types.ts'

export type * from './types.ts'

/** Brand an existing Loader-tree entry id at the owning boundary. */
function pluginEntryId(value: string): PluginEntryId {
  return value as PluginEntryId
}

/** Runtime mirror: FiberState is a cross-package const enum. */
const FIBER_STATE = {
  PENDING: 0 as FiberState.PENDING,
  LOADING: 1 as FiberState.LOADING,
  ACTIVE: 2 as FiberState.ACTIVE,
  FAILED: 3 as FiberState.FAILED,
  DISPOSED: 4 as FiberState.DISPOSED,
  UNLOADING: 5 as FiberState.UNLOADING,
} as const

/** Complete public projection of Cordis Fiber states. */
const FIBER_PHASE = {
  [FIBER_STATE.PENDING]: 'pending',
  [FIBER_STATE.LOADING]: 'loading',
  [FIBER_STATE.ACTIVE]: 'active',
  [FIBER_STATE.FAILED]: 'failed',
  [FIBER_STATE.DISPOSED]: null,
  [FIBER_STATE.UNLOADING]: 'unloading',
} as const satisfies Record<FiberState, PluginFiberPhase>

/** Remote-only service exposing the Loader's current non-group entry state. */
export class PluginInventoryGateway extends TypertRemoteService {
  static inject = ['loader']

  constructor(ctx: Context) {
    super(ctx, 'pluginInventory')
  }

  /**
   * Read the Loader directly on every call. Cordis's internal plugin/status
   * events already maintain Entry.fiber and Fiber.state, so a second cache
   * would only add another lifecycle truth to keep synchronized.
   *
   * When an agent-preset roster is composed, the snapshot also carries each
   * preset's composition rows, because those rows — not the Loader's own
   * entries — are where a deployment that mounts the roster runs its
   * model-facing plugins.
   * @returns Current non-group Loader entries in Loader order, with per-preset
   * compositions when a roster is composed.
   */
  @Remote('list')
  async list(): Promise<PluginInventorySnapshot> {
    const entries: PluginInventoryEntry[] = []
    for (const entry of this.ctx.loader.entries()) {
      if (entry.options.group) continue
      entries.push({
        entryId: pluginEntryId(entry.id),
        moduleName: entry.options.name,
        enabled: !entry.disabled,
        fiberPhase: entry.fiber === undefined ? null : FIBER_PHASE[entry.fiber.state],
      })
    }
    const presets = this.ctx.get('agentPresets')
    if (presets === undefined) return { entries }
    const agentPresets: AgentPresetPluginGroup[] = (await presets.compositionInventory()).map(
      composition => ({
        ...composition,
        rows: composition.rows.map(({ fiberState, ...row }) => ({
          ...row,
          fiberPhase: fiberState === undefined ? null : FIBER_PHASE[fiberState],
        })),
      }),
    )
    return { entries, agentPresets }
  }
}

export default PluginInventoryGateway
