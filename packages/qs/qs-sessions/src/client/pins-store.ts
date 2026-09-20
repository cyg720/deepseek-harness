/**
 * 本地置顶 store。
 *
 * 置顶是**客户端本地**状态：官方公开面没有 pin，所以这里不冒充服务端会话状态，
 * 只把 id 集合持久化在本机；归档时一并清理该会话的置顶。
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionRowView } from './contract.ts'

/** 置顶持久化键。 */
export const PINS_STORE_KEY = 'dsh.qs.pins'

/** 置顶状态。 */
export interface QsPinsState {
  /** 本地置顶的会话 id（有序）。 */
  pinned: SessionId[]
}

/** 置顶 store 的写入集。 */
type QsPinsActions = {
  toggle: (draft: QsPinsState, id: SessionId) => void
  forget: (draft: QsPinsState, id: SessionId) => void
}

/**
 * 声明置顶 store。
 * @returns store 句柄。
 */
export function createQsPinsStore(): EngineStoreHandle<QsPinsState, QsPinsActions> {
  return defineStore({
    init: (): QsPinsState => ({ pinned: [] }),
    persist: PINS_STORE_KEY,
    actions: {
      toggle: (d, id: SessionId) => {
        d.pinned = d.pinned.includes(id) ? d.pinned.filter(item => item !== id) : [...d.pinned, id]
      },
      forget: (d, id: SessionId) => {
        d.pinned = d.pinned.filter(item => item !== id)
      },
    },
  })
}

/**
 * 按置顶集合把会话分成两组。
 *
 * 归档是**集合**（`archivedSessionIds`），因此归档过的会话从两组里都要排除——
 * 只过滤一组会让归档后的会话仍然显示在列表里。
 * @param input - 会话列表、标题、运行、置顶和归档状态。
 * @returns 置顶组与最近组。
 */
export function groupSessions(input: {
  readonly ids: readonly SessionId[]
  readonly titles: Readonly<Record<string, string>>
  readonly running: ReadonlySet<SessionId>
  readonly pinned: readonly SessionId[]
  readonly archived: readonly SessionId[]
}): { pinned: SessionRowView[]; recent: SessionRowView[] } {
  const archivedSet = new Set(input.archived)
  const pinnedSet = new Set(input.pinned)
  const visible = input.ids.filter(id => !archivedSet.has(id))
  const toRow = (id: SessionId): SessionRowView => ({
    id,
    title: input.titles[id] ?? String(id),
    pinned: pinnedSet.has(id),
    running: input.running.has(id),
  })
  return {
    pinned: visible.filter(id => pinnedSet.has(id)).map(toRow),
    recent: visible.filter(id => !pinnedSet.has(id)).map(toRow),
  }
}
