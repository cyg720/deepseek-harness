/** 顶部自动分页：只观察真实滚动容器，失败后由用户显式重试。 */
import { useEffect } from 'react'
import type { OpenState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { QsHistorySnapshot } from './contract.ts'

/** 自动分页只消费已有会话动作和状态，不持有第二份历史或请求控制器。 */
export interface HistoryScrollInput {
  readonly sentinel: { readonly current: HTMLElement | null }
  readonly sessionId: string
  readonly connected: boolean
  readonly openState: OpenState
  readonly history: QsHistorySnapshot
  readonly captureAnchor: () => void
  readonly loadOlder: () => void
}

/**
 * 进入顶部时加载一页；官方分页状态负责串行与失败事实，观察器在卸载后失效。
 * @param input - 本会话滚动入口、连接/分页状态及官方分页动作。
 */
export function useHistoryScroll(input: HistoryScrollInput): void {
  const { sentinel, sessionId, connected, openState, history, captureAnchor, loadOlder } = input
  const { hasMore, loadingOlder, historyLoad } = history
  useEffect(() => {
    if (!connected || openState !== 'open' || !hasMore || loadingOlder) return
    if (historyLoad.phase === 'failed' || historyLoad.phase === 'cancelled' || historyLoad.phase === 'loading'
      || (historyLoad.phase === 'succeeded' && !historyLoad.progressed)) return
    const target = sentinel.current
    const root = target?.closest<HTMLElement>('[data-qs-scroll]')
    if (target == null || root == null || typeof IntersectionObserver !== 'function') return
    let active = true
    let requested = false
    const observer = new IntersectionObserver((entries) => {
      // 同一观察周期最多发起一次；状态发布前的重复回调不能重复捕获锚点。
      if (!active || requested || !entries.some(entry => entry.target === target && entry.isIntersecting)) return
      requested = true
      captureAnchor()
      loadOlder()
    }, { root })
    observer.observe(target)
    return () => { active = false; observer.disconnect() }
  }, [sentinel, sessionId, connected, openState, hasMore, loadingOlder, historyLoad, captureAnchor, loadOlder])
}
