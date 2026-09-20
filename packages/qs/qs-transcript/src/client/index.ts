/**
 * 转写包的浏览器入口。
 *
 * 数据链（见 06-槽位与状态设计 第五节）：
 * `ctx.sessions.binding(sessionId)` → `ctx.uiConversation.binding(binding).target('chat')`
 * → `getSnapshot().nodes.source(key)` → 作为本 entry 的 `inject.keyedHooks` 交给框架绑定。
 * target 未就绪时 `getSnapshot()` 可能是 undefined，因此保留一份身份稳定的空源。
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  ChatConversationViewNode, ChatNodeProcessSource, ChatNodeSource, ChatSnapshot,
  ChatTurnProcessPresentation,
} from '@deepseek-ai/dsh-client-ui-chat/client'
// 仅类型：引入 SlotRegistry 的 ctx.slots 服务合并、ui-session 的会话座席与语言。
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { QsHistorySnapshot, QsScrollPosition, QsTranscriptInjected } from './contract.ts'
import { NATIVE_ROW_KINDS } from './adapter.ts'
import { en, zh } from './locales.ts'
import { ROW_COMPONENTS } from './rows.tsx'
import { Transcript } from './Transcript.tsx'

/** 本包的本地化命名空间。 */
const NS = 'qs-transcript'

/** 必需服务：槽注册表、语言、会话面与 Conversation 装配面。 */
export const inject = ['slots', 'locale', 'sessions', 'uiConversation', 'connection']

/** 契约再导出。 */
export type * from './contract.ts'

/** 分页源只需要会话面的读/订阅两面。 */
interface QsHistoryOwner {
  /** 读取会话快照。 */
  getSnapshot(): { hasMore: boolean; loadingOlder: boolean }
  /** 订阅会话快照变化。 */
  subscribe(listener: () => void): () => void
}

/**
 * 建立一条会话的历史分页源。
 *
 * 快照引用稳定性是硬要求：`useSyncExternalStore` 在每次渲染后重新读取快照，返回新对象
 * 会被判定为"又变了"，触发无限重渲。这里只在两个字段真的变化时换对象。
 * @param session - 会话面。
 * @returns 分页源。
 */
function historySource(session: QsHistoryOwner): HostObservable<QsHistorySnapshot> {
  let cached: QsHistorySnapshot = {
    hasMore: session.getSnapshot().hasMore,
    loadingOlder: session.getSnapshot().loadingOlder,
  }
  return {
    getSnapshot: () => {
      const snapshot = session.getSnapshot()
      if (snapshot.hasMore !== cached.hasMore || snapshot.loadingOlder !== cached.loadingOlder) {
        cached = { hasMore: snapshot.hasMore, loadingOlder: snapshot.loadingOlder }
      }
      return cached
    },
    subscribe: listener => session.subscribe(listener),
  }
}

/** 身份稳定的空节点源：target 未就绪时行组件得到 undefined 而不是崩溃。 */
const EMPTY_NODE_SOURCE: ChatNodeSource = {
  getSnapshot: (): ChatConversationViewNode | undefined => undefined,
  subscribe: () => () => {},
}

/** 身份稳定的空 Turn-process 源。 */
const EMPTY_PROCESS_SOURCE: ChatNodeProcessSource = {
  getSnapshot: (): ChatTurnProcessPresentation | undefined => undefined,
  subscribe: () => () => {},
}

/**
 * 安装转写。
 * @param ctx - 浏览器根上下文。
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'qs-transcript: dictionaries')

  // 一个 binding 一份读函数：订阅按会话键隔离，避免跨会话串台。
  const readers = new WeakMap<SessionBinding, () => ChatSnapshot | undefined>()
  const positions = new WeakMap<SessionBinding, QsScrollPosition>()
  const chatReaderOf = (binding: SessionBinding): (() => ChatSnapshot | undefined) => {
    let read = readers.get(binding)
    if (read === undefined) {
      const target = ctx.uiConversation.binding(binding).target('chat')
      read = () => target.getSnapshot()
      readers.set(binding, read)
    }
    return read
  }

  ctx.slots.inject('qs.stage.transcript', () => ctx.slots.register({
    name: 'qs.stage.transcript',
    locale: NS,
    children: {
      'qs.stage.transcript.row': { kind: 'keyed', scope: 'session' },
      'qs.stage.interaction': { kind: 'chain', scope: 'session' },
    },
    inject: (sessionId: SessionId): QsTranscriptInjected => {
      const binding = ctx.sessions.binding(sessionId)
      if (binding === undefined) throw new Error(`qs-transcript: unknown session "${sessionId}"`)
      const read = chatReaderOf(binding)
      return {
        keyedHooks: {
          // target 未就绪时可能是 undefined，按官方同款给空源兜底。
          node: key => read()?.nodes.source(key) ?? EMPTY_NODE_SOURCE,
          process: key => read()?.nodes.processSource(key) ?? EMPTY_PROCESS_SOURCE,
        },
        // 分页读的是会话快照的订阅，不是注入时的固定值。快照对象必须在值不变时保持
        // 同一引用，否则 useSyncExternalStore 会无限重渲。
        hooks: { qsHistory: historySource(binding.session) },
        loadOlder: () => { void binding.session.loadOlder() },
        retryHistory: () => { (ctx.get('connection') as ConnectionHandle).reconnect() },
        readScroll: () => positions.get(binding),
        saveScroll: (position) => { positions.set(binding, position) },
      }
    },
  }, Transcript))

  for (const key of [...NATIVE_ROW_KINDS, 'unknown'] as const) {
    const component = ROW_COMPONENTS[key]
    if (component === undefined) continue
    ctx.slots.inject('qs.stage.transcript.row', () => ctx.slots.register({
      name: 'qs.stage.transcript.row',
      key,
      locale: NS,
    }, component))
  }
}
