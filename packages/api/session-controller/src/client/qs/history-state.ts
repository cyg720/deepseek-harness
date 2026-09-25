/** 二开分页读面：请求身份仅在当前 Session 实例内有效，不改变持久 Session 格式。 */
import type { SessionSeq } from '@deepseek-ai/dsh-session/types'

/** 当前分页请求的本地身份和连接代次。 */
export interface HistoryLoadRequest {
  readonly requestId: number
  /** 本地历史窗口代次；重连、连续性修复、重新打开或销毁均使旧分页身份失效。 */
  readonly connectionEpoch: number
  readonly kind: 'older' | 'through'
  readonly targetSeq?: SessionSeq
}

/** 分页结算区别于初次 open；失败不清空既有窗口，也不自动重试。 */
export type HistoryLoadState =
  | { readonly phase: 'idle' }
  | (HistoryLoadRequest & { readonly phase: 'loading' | 'failed' | 'cancelled' })
  | (HistoryLoadRequest & { readonly phase: 'succeeded'; readonly progressed: boolean; readonly hasMore: boolean })
