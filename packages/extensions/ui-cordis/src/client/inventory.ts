/*
 * ================================ 文件注释 ================================
 * 【文件职责】浏览器侧"插件库存"（inventory）：以可订阅 observable 的形式持有
 *             Host 定义注册表在本页最近一次读取到的行，供面板/卡片/@ 触发共用，
 *             并负责重读、显式移除记录与重连重置。
 * 【技术维度】HostObservable 约定（getSnapshot/subscribe）；读取走 CordisDynamicPort
 *             （RPC 接缝）；采用"整体重读而非修补"（线缆事件无标签，修补会漂移）；
 *             单飞（single-flight）防止事件风暴成倍发起 RPC；generation 世代计数
 *             保证重连后旧连接的读取结果不会覆盖新连接。
 * 【产品维度】面板是跨会话的全框架表面，不能从任何单个会话推导：直接调全局读取。
 *             失败读取保留旧行并说明原因，避免把瞬时网络故障显示成"什么都没定义"。
 * 【逻辑维度】快照/接口类型 → createCordisInventory：refresh（单飞 + 世代校验 +
 *             removed 推导）→ retire（本地移除）→ reset（世代自增 + 清空）。
 * 【关键边界】removed 集合跨刷新保留，仅用于历史卡片展示；read=false 期间面板
 *             显示加载态，绝不谎报"空"。
 * 【新手阅读建议】先读文件头英文注释理解"为何整体重读 + 单飞 + 世代"，再看
 *             refresh 的实现细节。
 * ==========================================================================
 */

/**
 * The host's definition registry as this page last read it, owned by the
 * plugin's apply closure.
 *
 * The panel is a frame-wide surface, so it cannot derive this from any session:
 * the registry is global and the read is a single global call. The rows are
 * re-read rather than patched, because the wire announcements
 * (`cordis/dynamic-package` / `/retract`) carry no labels and a definition
 * can appear or disappear between them — a patch-in-place cache would drift into
 * showing definitions the host no longer holds.
 *
 * Reads are single-flight: several announcements settling at once, or a badge
 * opening while a reconnect re-reads, must not multiply the call. Single-flight
 * alone would be wrong across a reconnect, though — the in-flight read belongs to
 * the previous connection, so a reset both discards its answer and frees the slot
 * for a fresh one. Without that, a reconnect either loses its re-read to the old
 * call or has the old host's rows published on top of it.
 */

import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { CordisDynamicPort, CordisInventoryRow } from './dynamic-port.ts'
import type { CordisDynamicPluginId } from './events.ts'

/** What the panel reads: the rows, and whether the first read has happened. */
/*
 * 面板读取的库存快照：行集合、本页显式移除的插件（历史卡片保留）、
 * 是否已完成首次读取（未完成前显示加载行而非空态）与最近读取失败信息。
 */
export interface CordisInventorySnapshot {
  readonly rows: readonly CordisInventoryRow[]
  /** Plugins explicitly removed through this page, retained for historical cards. */
  readonly removed: ReadonlySet<CordisDynamicPluginId>
  /**
   * False until a read settles. The panel shows a loading line rather than an
   * empty state, so "nothing defined yet" is never claimed before it is known.
   */
  readonly read: boolean
  /** Last read failure, so the panel can say why it is empty. */
  readonly error?: string | undefined
}

/** Inventory source: an observable of the rows plus the read trigger. */
/*
 * 库存源接口：既是可订阅的 observable（getSnapshot/subscribe），又暴露三个操作——
 * refresh（无在途读取时重读）、retire（记录显式移除并立刻丢行）、reset（丢弃结果，
 * 重连后可能是新 Host）。
 */
export interface CordisInventory extends HostObservable<CordisInventorySnapshot> {
  /** Read the registry unless a read is already in flight. */
  refresh(): void
  /** Record an explicit remove and drop the live row immediately. */
  retire(pluginId: CordisDynamicPluginId): void
  /** Drop what was read; the next refresh starts from nothing (a reconnect may be a new host). */
  reset(): void
}

/**
 * Create the inventory source.
 * @param port - the RPC seam the read goes through.
 * @param onError - reporter for a failed read (console in production, captured in specs).
 * @returns the inventory observable and its read trigger.
 */
/*
 * 创建库存源：返回带 refresh（单飞读取）/retire（本地移除）/reset（丢弃旧结果）的
 * 可订阅 observable。全部行在每次读取时整体重读（而非修补），因为线缆事件不携带
 * 标签，修补式缓存会漂移。
 * @param port 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param onError 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function createCordisInventory(
  port: CordisDynamicPort,
  onError: (error: unknown) => void,
): CordisInventory {
  const listeners = new Set<() => void>()
  let snapshot: CordisInventorySnapshot = { rows: [], removed: new Set(), read: false }
  let inFlight: Promise<void> | undefined
  // Bumped by reset; a read whose generation is stale publishes nothing.
  // 世代计数：reset 时自增；旧世代发出的读取即使返回也不发布（连接可能已换 Host）
  let generation = 0

  const publish = (next: CordisInventorySnapshot): void => {
    snapshot = next
    for (const listener of [...listeners]) listener()
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (fn) => {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
    refresh: () => {
      // 单飞：已有一次读取在途则跳过，避免事件风暴成倍发起 RPC
      if (inFlight !== undefined) return
      const issued = generation
      inFlight = port.inventory().then(
        (rows) => {
          if (issued !== generation) return
          // 本次读取中消失的插件记入 removed（供历史卡片显示"已移除"）
          const removed = new Set(snapshot.removed)
          const live = new Set(rows.map(row => row.pluginId))
          for (const previous of snapshot.rows) {
            if (!live.has(previous.pluginId)) removed.add(previous.pluginId)
          }
          publish({ rows, removed, read: true })
        },
        (error: unknown) => {
          if (issued !== generation) return
          onError(error)
          // A failed read keeps whatever was shown and says why: dropping the
          // rows would turn a transient wire failure into "nothing is defined".
          publish({
            rows: snapshot.rows,
            removed: snapshot.removed,
            read: snapshot.read,
            error: error instanceof Error ? error.message : 'reading the cordis inventory failed',
          })
        },
      ).then(() => { if (issued === generation) inFlight = undefined })
    },
    retire: (pluginId) => {
      const removed = new Set(snapshot.removed)
      removed.add(pluginId)
      publish({ ...snapshot, rows: snapshot.rows.filter(row => row.pluginId !== pluginId), removed })
    },
    reset: () => {
      generation += 1
      inFlight = undefined
      publish({ rows: [], removed: snapshot.removed, read: false })
    },
  }
}
