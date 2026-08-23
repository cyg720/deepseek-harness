/**
 * ================================ 文件注释 ================================
 * 【文件职责】uSES 桥：把任意"裸可观察快照源"变成带选择器的类型化 React hook。
 * 【技术维度】use-sync-external-store/shim + 选择器；客户端渲染专用（无服务端快照）；
 *             subscribe/getSnapshot 每源捕获一次为稳定闭包（同时为方法源重绑 this），
 *             组件跨渲染不重订阅。
 * 【产品维度】引擎/宿主以裸源（engine store、Session 对象、store 实例）交流，
 *             由本桥在 React 侧完成绑定。
 * 【逻辑维度】bindSnapshotSelector 返回 useSelector(sel, eq)：用
 *             useSyncExternalStoreWithSelector 订阅并选择子状态。
 * 【关键边界】本文件是客户端栈中唯一的 hook 构造器。
 * 【新手阅读建议】理解"源侧裸、React 侧绑定"的分工即可。
 * ==========================================================================
 */
/**
 * uSES bridge: turns any bare observable snapshot source into a typed
 * selector hook. Client-side-rendered only, so no server snapshot is wired.
 * This is the ONE hook constructor in the client stack — engines and hosts
 * traffic in bare sources; binding happens on the React side.
 */
import { useSyncExternalStoreWithSelector } from 'use-sync-external-store/shim/with-selector.js'
import type { HostObservable, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'

/**
 * Bind a bare observable source to a typed uSES selector hook.
 * subscribe/getSnapshot are captured once per source into stable closures
 * (also re-binds `this` for method-based sources), so components never
 * resubscribe across renders. Equality defaults to Object.is.
 * @param w - snapshot source (engine store, Session object, store instance).
 * @returns the selector hook.
 */
export function bindSnapshotSelector<T>(w: HostObservable<T>): SnapshotSelectorHook<T> {
  const subscribe = (fn: () => void) => w.subscribe(fn)
  const getSnapshot = () => w.getSnapshot()
  return function useSelector<S>(sel: (s: T) => S, eq?: (a: S, b: S) => boolean): S {
    return useSyncExternalStoreWithSelector(subscribe, getSnapshot, undefined, sel, eq)
  }
}
