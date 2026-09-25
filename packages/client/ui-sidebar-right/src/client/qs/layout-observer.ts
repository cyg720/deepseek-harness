/** 只观察官方已提交布局；监听生命周期不依赖任何一套界面是否挂载。 */
import { notifySubscribers } from '@deepseek-ai/dsh-client-store'
import type { LayoutState } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SidebarRightSurfaceStore } from '../service.ts'

/** 已提交的会话布局通知，不提供额外写入接口。 */
export type LayoutListener = (sessionId: SessionId, layout: LayoutState) => void

/** 共享 store 所有者持有实例订阅，消费者只持有自己的观察订阅。 */
export interface LayoutObserver {
  /** @param id - 会话身份。 @param store - 官方创建的唯一实例。 */
  attach(id: SessionId, store: SidebarRightSurfaceStore): void
  /** @param listener - 同步接收已有布局及后续提交。 @returns 取消本观察订阅。 */
  watch(listener: LayoutListener): () => void
  /** 释放实例订阅和消费者监听；不操作布局或资源。 */
  dispose(): void
}

/**
 * 创建共享布局观察者，不复制状态、不触发恢复或创建空会话。
 * @returns 与官方呈现服务同生命周期的观察者。
 */
export function createLayoutObserver(): LayoutObserver {
  const listeners = new Set<LayoutListener>()
  const stores = new Map<SessionId, { store: SidebarRightSurfaceStore; unsubscribe: () => void }>()
  return {
    attach(id, store) {
      stores.get(id)?.unsubscribe()
      let prior: LayoutState | undefined
      const publish = (): void => {
        const layout = store.getSnapshot().bySession[id]?.layout
        if (layout === undefined || layout === prior) return
        prior = layout
        notifySubscribers(listeners, '[sidebar-layout]', id, layout)
      }
      stores.set(id, { store, unsubscribe: store.subscribe(publish) })
      publish()
    },
    watch(listener) {
      listeners.add(listener)
      for (const [id, { store }] of stores) {
        const layout = store.getSnapshot().bySession[id]?.layout
        if (layout !== undefined) notifySubscribers([listener], '[sidebar-layout]', id, layout)
      }
      return () => { listeners.delete(listener) }
    },
    dispose() {
      listeners.clear()
      for (const { unsubscribe } of stores.values()) unsubscribe()
      stores.clear()
    },
  }
}
