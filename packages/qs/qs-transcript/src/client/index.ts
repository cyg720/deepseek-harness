/** Chat presentation corresponding to official ui-chat: transcript, row renderers and reading position. */
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
import { createProcessFold, type QsProcessFold } from './process-fold.ts'
import type { QsHistorySnapshot, QsScrollPosition, QsTranscriptInjected } from './contract.ts'
import { en, zh } from './locales.ts'
import { ROW_COMPONENTS } from './rows.tsx'
import { Transcript } from './Transcript.tsx'
import { TranscriptViewRow, type TranscriptViewInjected } from './TranscriptViewRow.tsx'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import { turnDataFactory } from './turn-data.ts'

/** 本包的本地化命名空间。 */
const NS = 'qs-transcript'

/** 必需服务：槽注册表、语言、会话面与 Conversation 装配面。 */
export const inject = ['slots', 'locale', 'sessions', 'uiConversation', 'connection', 'sidebarRight', 'chatPresentation']

/** 契约再导出。 */
export type * from './contract.ts'

/** 分页源只需要会话面的读/订阅两面。 */
interface QsHistoryOwner {
  /** 读取会话快照。 */
  getSnapshot(): QsHistorySnapshot
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
    historyLoad: session.getSnapshot().historyLoad,
  }
  return {
    getSnapshot: () => {
      const snapshot = session.getSnapshot()
      if (snapshot.hasMore !== cached.hasMore || snapshot.loadingOlder !== cached.loadingOlder
        || snapshot.historyLoad !== cached.historyLoad) {
        cached = { hasMore: snapshot.hasMore, loadingOlder: snapshot.loadingOlder, historyLoad: snapshot.historyLoad }
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
  // 对应官方 ui-chat 的 transcript-view 注册，卸载只释放呈现而不重置共享偏好。
  ctx.slots.inject('qs.settings.general.item', () => ctx.slots.register({
    name: 'qs.settings.general.item', id: 'transcript-view', order: 12, locale: NS,
    inject: (): TranscriptViewInjected => ({
      hooks: { transcriptView: ctx.chatPresentation.transcriptView },
      setTranscriptView: (mode) => { ctx.chatPresentation.setTranscriptView(mode) },
    }),
  }, TranscriptViewRow))

  // 一个 binding 一份读函数：订阅按会话键隔离，避免跨会话串台。
  const readers = new WeakMap<SessionBinding, () => ChatSnapshot | undefined>()
  const positions = new WeakMap<SessionBinding, QsScrollPosition>()
  // 过程折叠状态按会话创建：同轮展开状态不会跨会话串台。
  const folds = new WeakMap<SessionBinding, QsProcessFold>()
  const foldOf = (binding: SessionBinding): QsProcessFold => {
    let fold = folds.get(binding)
    if (fold === undefined) {
      fold = createProcessFold()
      folds.set(binding, fold)
    }
    return fold
  }
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
      'qs.conversation.message.images': { kind: 'single', scope: 'session' },
      'qs.stage.transcript.row': { kind: 'keyed', scope: 'session', inject: { hooks: { turnData: turnDataFactory } } },
    },
    inject: (sessionId: SessionId): QsTranscriptInjected => {
      const binding = ctx.sessions.binding(sessionId)
      if (binding === undefined) throw new Error(`qs-transcript: unknown session "${sessionId}"`)
      const read = chatReaderOf(binding)
      return {
        useSearchableHidden: ctx.chatPresentation.useSearchableHidden,
        keyedHooks: {
          // target 未就绪时可能是 undefined，按官方同款给空源兜底。
          node: key => read()?.nodes.source(key) ?? EMPTY_NODE_SOURCE,
          process: key => read()?.nodes.processSource(key) ?? EMPTY_PROCESS_SOURCE,
        },
        // 分页读的是会话快照的订阅，不是注入时的固定值。快照对象必须在值不变时保持
        // 同一引用，否则 useSyncExternalStore 会无限重渲。
        hooks: {
          // 直接消费官方同一偏好源，切换界面不建立第二份持久状态。
          qsCompactTranscript: {
            getSnapshot: () => ctx.chatPresentation.transcriptView.getSnapshot() === 'compact',
            subscribe: listener => ctx.chatPresentation.transcriptView.subscribe(listener),
          },
          qsHistoryConnected: {
            getSnapshot: () => (ctx.get('connection') as ConnectionHandle).state.getSnapshot() === 'connected',
            subscribe: listener => (ctx.get('connection') as ConnectionHandle).state.subscribe(listener),
          },
          qsHistory: historySource(binding.session),
          // 有效注册变化才替换数组，保证外部 store 快照引用稳定。
          qsRowKeys: (() => {
            let keys: readonly string[] = []
            return {
              getSnapshot: () => {
                const next = ctx.slots.entriesOfSlot('qs.stage.transcript.row').map(entry => entry.options.key).filter((key): key is string => typeof key === 'string')
                if (next.length !== keys.length || next.some((key, index) => key !== keys[index])) keys = next
                return keys
              },
              subscribe: listener => ctx.slots.subscribe('qs.stage.transcript.row', listener),
            }
          })(),
        },
        loadOlder: () => { void binding.session.loadOlder() },
        // 图片装载按会话签发：行组件只需消费，不拼装资源地址。
        loadImage: attachment => ctx.uiConversation.imageUrl(sessionId, attachment),
        fileMentions: owner => ctx.get('chatFileMentions')?.forClosing({ ...owner, openFile: (path) => {
          const cwd = ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd
          ctx.sidebarRight.openResource(fileAddressFor(sessionId, cwd, path))
        } }, sessionId),
        fold: foldOf(binding),
        retryHistory: () => { (ctx.get('connection') as ConnectionHandle).reconnect() },
        readScroll: () => positions.get(binding),
        saveScroll: (position) => { positions.set(binding, position) },
      }
    },
  }, Transcript))

  // 完备行表保证每个本地行键都有组件；未知扩展由 unknown 行呈现。
  for (const [key, component] of Object.entries(ROW_COMPONENTS)) {
    ctx.slots.inject('qs.stage.transcript.row', () => ctx.slots.register({
      name: 'qs.stage.transcript.row',
      key,
      locale: NS,
      // 动作贡献只挂在轮次收尾，避免同一持久消息出现多个反馈按钮。
      ...(key === 'turn-tail' ? { children: {
        'qs.chat.assistant-actions': { kind: 'list' as const, scope: 'session' as const },
        'qs.chat.turn-tail': { kind: 'chain' as const, scope: 'session' as const },
      } } : {}),
    }, component))
  }
}
