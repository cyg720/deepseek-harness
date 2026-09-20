/** 输入区插件：未归属草稿、创建取消与官方队列适配。 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ISessions, SessionFace, SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
// 仅类型：引入 SlotRegistry 的 ctx.slots 服务合并、会话座席与语言。
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { IQsUiMode } from '@deepseek-ai/dsh-qs-shell/client'
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { ISession } from '@deepseek-ai/dsh-api-session-controller/client'
import type { QsComposerInjected, QsComposerSnapshot } from './contract.ts'
import { newRequestedSessionId, queueRows, type QueueRowView } from './handoff.ts'
import { en, zh } from './locales.ts'
import { createForSend } from './create-session.ts'
import { Composer } from './Composer.tsx'

/** 本包的本地化命名空间。 */
const NS = 'qs-composer'

/** 必需服务：槽注册表、语言、会话面与 Conversation 输入面。 */
export const inject = ['slots', 'locale', 'sessions', 'conversation', 'remote', 'remote.session']

/** 契约再导出。 */
export type * from './contract.ts'
export type { QueueRowView, SubmitOperation } from './handoff.ts'

/** 可写队列动作：逐行引导 / 移除。 */
type QueueItemId = Parameters<ISession['updateQueue']>[0]

/**
 * 安装输入区。
 * @param ctx - 浏览器根上下文。
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'qs-composer: dictionaries')

  let reservedId: string | undefined
  let disposed = false
  ctx.effect(() => () => { disposed = true; (ctx.get('qsShell') as IQsUiMode | undefined)?.setLocalFreeze(undefined) }, 'qs-composer: release freeze')
  const emptyRows: readonly QueueRowView[] = []
  const emptyQueue = { getSnapshot: () => emptyRows, subscribe: () => () => {} }
  const sessions = ctx.get('sessions') as ISessions

  let snapshot: QsComposerSnapshot = { frozen: false, unownedDraft: '', freezeReason: undefined }
  const listeners = new Set<() => void>()
  const publish = (next: QsComposerSnapshot): void => {
    snapshot = next
    for (const listener of [...listeners]) listener()
  }
  const localSource: HostObservable<QsComposerSnapshot> = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }

  const faceOf = (id: string): SessionFace | undefined => sessions.binding(id as never)?.session

  // 队列按会话键隔离：一个会话一份源，订阅随会话切换自动改读。
  const queueSources = new WeakMap<object, HostObservable<readonly QueueRowView[]>>()
  const queueSourceFor = (id: string | undefined): HostObservable<readonly QueueRowView[]> => {
    const binding = id === undefined ? undefined : sessions.binding(id as never)
    if (binding === undefined) {
      return emptyQueue
    }
    let source = queueSources.get(binding)
    if (source === undefined) {
      const session = binding.session
      // 行数组必须引用稳定：每次 getSnapshot 都新建数组会让 useSyncExternalStore 判定
      // 快照一直在变并无限重渲。只在底层 queue 数组换了引用时重建行。
      let cachedQueue: readonly unknown[] | undefined
      let cachedRows: readonly QueueRowView[] = []
      source = {
        getSnapshot: () => {
          const queue = session.getSnapshot().queue
          if (queue !== cachedQueue) {
            cachedQueue = queue
            cachedRows = queueRows(queue)
          }
          return cachedRows
        },
        subscribe: listener => session.subscribe(listener),
      }
      queueSources.set(binding, source)
    }
    return source
  }

  /** 会话快照读面：队列源要跟着当前会话走，因此按当前 id 现取。 */
  const currentQueueSource = (): HostObservable<readonly QueueRowView[]> =>
    queueSourceFor(sessions.list.getSnapshot().current)

  ctx.slots.inject('qs.composer', () => ctx.slots.register({
    name: 'qs.composer',
    locale: NS,
    inject: (sessionId): QsComposerInjected => {
      const scope = sessionId === undefined ? undefined : sessions.scope(sessionId)
      const input = scope === undefined ? undefined : ctx.conversation.input.for(scope)
      const block = sessionId === undefined ? undefined : ctx.conversation.blocks.storeFor(sessionId)
      const connection = ctx.get('connection') as ConnectionHandle | undefined
      const models = sessionId === undefined ? undefined : ctx.get('modelDirectories')?.directoryFor(sessionId)
      return ({
        hooks: {
          qsComposer: localSource,
          qsBlocked: {
            getSnapshot: () => block?.getSnapshot()?.reason,
            subscribe: listener => block?.subscribe(listener) ?? (() => {}),
          },
          qsConnected: {
            getSnapshot: () => connection?.state.getSnapshot() === 'connected',
            subscribe: listener => connection?.state.subscribe(listener) ?? (() => {}),
          },
          qsNotice: {
            getSnapshot: () => input?.notices.getSnapshot()?.text,
            subscribe: listener => input?.notices.subscribe(listener) ?? (() => {}),
          },
          qsModel: {
            getSnapshot: () => models?.store.getSnapshot().current?.model,
            subscribe: listener => models?.store.subscribe(listener) ?? (() => {}),
          },
          // 队列源要随当前会话变化：包一层，让 hooks 每次读取都解析当前会话。
          qsQueue: {
            getSnapshot: () => currentQueueSource().getSnapshot(),
            subscribe: (listener) => {
              let inner = currentQueueSource().subscribe(listener)
              const unsubscribeSession = sessions.list.subscribe(() => {
                inner()
                inner = currentQueueSource().subscribe(listener)
                listener()
              })
              return () => { inner(); unsubscribeSession() }
            },
          },
        },
        loadModel: () => { void models?.load().catch(() => { /* The model directory publishes its load error. */ }) },
        reserveSessionId: () => { reservedId ??= newRequestedSessionId(); return reservedId },
        createSession: (requestedSessionId, signal) => createForSend(sessions, requestedSessionId as never, signal, () => disposed),
        setUnownedDraft: (text: string): void => { if (text === '') reservedId = undefined; publish({ ...snapshot, unownedDraft: text }) },
        setFrozen: (reason): void => {
          const next: QsComposerSnapshot = {
            frozen: reason !== undefined,
            unownedDraft: snapshot.unownedDraft,
          }
          publish(reason === undefined ? next : { ...next, freezeReason: reason })
          // 界面切换的约束落在控制器上：冻结期间切换动作被拒绝，而不仅是按钮变灰。
          const shell = ctx.get('qsShell') as { setLocalFreeze?: (value: string | undefined) => void } | undefined
          shell?.setLocalFreeze?.(reason)
        },
        stop: (): void => {
          const face = sessionId === undefined ? undefined : faceOf(sessionId)
          if (face === undefined) return
          void face.cancel()
        },
        removeQueueItem: async itemId => (await (sessionId === undefined ? undefined : faceOf(sessionId))?.updateQueue(itemId as QueueItemId, { kind: 'remove' }))?.ok === true,
        steerQueueItem: async itemId => (await (sessionId === undefined ? undefined : faceOf(sessionId))?.updateQueue(itemId as QueueItemId, { kind: 'steer' }))?.ok === true,
        editQueueItem: async (itemId, text) => (await (sessionId === undefined ? undefined : faceOf(sessionId))?.updateQueue(itemId as QueueItemId, { kind: 'edit', content: [{ type: 'text', text }] }))?.ok === true,
      })
    },
  }, Composer))
}

/** 会话快照类型再导出，供后续里程碑的行内队列编辑复用。 */
export type QsComposerSessionSnapshot = SessionSnapshot
