/** Session-local ownership index for Package business views on `cordis_run` cards. */

/*
 * ================================ 文件注释 ================================
 * 【文件职责】会话级"运行卡片指针"所有权索引：追踪每次成功的 cordis_run 结果，
 *             决定哪个卡片承载该插件的业务视图（tool.view.cordis），并保证同一
 *             插件同时只有"最新"的运行卡片生效（按日志序列号淘汰旧卡）。
 * 【技术维度】CordisRunCardStore 是 HostObservable 约定的可订阅索引；observe 用
 *             seq（日志序列号）比较新旧——只有更大序列才能替换；Registry 按会话
 *             缓存 Store，页面生命周期内所有卡片共享同一份。
 * 【产品维度】用户连续运行同一插件多次时，只有最新一张卡片承载可交互业务视图，
 *             旧卡显示"已有更新的运行卡片"提示，避免视图错位。
 * 【逻辑维度】类型（Key/Pointer/Store）→ createStore 工厂 → Registry 按会话分发。
 * 【关键边界】seq 单调比较（等值/更小不替换）；Pointer 只含稳定身份字段，可安全
 *             跨会话日志回放。
 * 【新手阅读建议】先看 CordisRunCardPointer 与 observe 的淘汰逻辑，再看 Registry。
 * ==========================================================================
 */

import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  CordisDynamicPackageId, CordisDynamicPluginId, CordisDynamicPluginRunId,
} from './events.ts'

/** Stable keyed-slot identity of one Package-owned business view. */
export type CordisToolViewKey = `${CordisDynamicPluginId}.${CordisDynamicPackageId}`

/** One successful tool result competing to host a Package business view. */
export interface CordisRunCardPointer {
  readonly key: CordisToolViewKey
  readonly callId: string
  readonly seq: number
  readonly pluginRunId: CordisDynamicPluginRunId
}

/** Per-session observable index consumed by every mounted Run card. */
export interface CordisRunCardStore extends HostObservable<ReadonlyMap<CordisToolViewKey, CordisRunCardPointer>> {
  /** Publish one successful Run result; only a greater log sequence can replace it. */
  observe(pointer: CordisRunCardPointer): void
}

function createStore(): CordisRunCardStore {
  const pointers = new Map<CordisToolViewKey, CordisRunCardPointer>()
  const listeners = new Set<() => void>()
  let cache: ReadonlyMap<CordisToolViewKey, CordisRunCardPointer> | undefined
  return {
    getSnapshot: () => cache ??= new Map(pointers),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    observe: (pointer) => {
      const current = pointers.get(pointer.key)
      if (current !== undefined && current.seq >= pointer.seq) return
      pointers.set(pointer.key, pointer)
      cache = undefined
      for (const listener of [...listeners]) listener()
    },
  }
}

/** Page-lifetime registry that gives all cards of one session the same Store. */
export class CordisRunCardRegistry {
  private readonly sessions = new Map<SessionId, CordisRunCardStore>()

  /**
   * Return the persistent page-local Store for a session.
   * @param sessionId - session whose cards share supersession state.
   * @returns the page-local Store retained for that session.
   */
  forSession(sessionId: SessionId): CordisRunCardStore {
    let store = this.sessions.get(sessionId)
    if (store === undefined) {
      store = createStore()
      this.sessions.set(sessionId, store)
    }
    return store
  }
}

/**
 * Build the Package business-view key shared by registrations and Run cards.
 * @param pluginId - stable Plugin identity.
 * @param packageId - immutable Package identity.
 * @returns the shared business-view key.
 */
export function cordisToolViewKey(
  pluginId: CordisDynamicPluginId,
  packageId: CordisDynamicPackageId,
): CordisToolViewKey {
  return `${pluginId}.${packageId}`
}
