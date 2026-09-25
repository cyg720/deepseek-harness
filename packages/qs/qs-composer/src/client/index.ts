/** Conversation presentation corresponding to official ui-conversation: stage, welcome, input and queue. */
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
import { QsSendPreparation } from './preparation.ts'
import { PendingSeat } from './PendingSeat.tsx'
import { Reading, type ReadingInjected } from './Reading.tsx'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type { ViewTab } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { QsStage } from './Stage.tsx'
import { QsWelcomePane } from './WelcomePane.tsx'
import { zh as viewZh, en as viewEn } from './view-locales.ts'
import { ComposerHost } from './ComposerHost.tsx'
import { EnterBehaviorRow, type EnterBehaviorInjected } from './EnterBehaviorRow.tsx'

/** 本包的本地化命名空间。 */
const NS = 'qs-composer'

/** 必需服务：槽注册表、语言、会话面与 Conversation 输入面。 */
export const inject = ['slots', 'locale', 'sessions', 'conversation', 'remote', 'remote.session', 'conversationPresentation']

/** 契约再导出。 */
export type * from './contract.ts'
export type { QsSendPreparation, QsSendPreparationEntry } from './preparation.ts'
export type { QueueRowView, SubmitOperation } from './handoff.ts'

/** 可写队列动作：逐行引导 / 移除。 */
type QueueItemId = Parameters<ISession['updateQueue']>[0]

/**
 * 安装输入区。
 * @param ctx - 浏览器根上下文。
 */
export function apply(ctx: ClientContext): void {
  const preparation = new QsSendPreparation(ctx)
  ctx.effect(() => ctx.locale.register('qs-conversation', { zh: viewZh, en: viewEn }), 'qs-composer: conversation dictionaries')
  ctx.slots.inject('qs.stage', () => ctx.slots.register({
    name: 'qs.stage', locale: 'qs-conversation',
    children: {
      'qs.stage.reading': { kind: 'single', scope: 'session' },
      'qs.stage.header.actions': { kind: 'list', scope: 'session' },
      'qs.stage.body': { kind: 'single', scope: 'session-maybe' },
      'qs.stage.pending': { kind: 'single', scope: 'session' },
      'qs.stage.transcript': { kind: 'single', scope: 'session' },
      'qs.composer.dock': { kind: 'list', scope: 'session' },
      'qs.composer': { kind: 'single', scope: 'session-maybe' },
    },
  }, QsStage))
  ctx.inject(['conversationPresentation'], (scope) => {
    const shared = scope.conversationPresentation
    let version = -1, revision = -1, views: readonly ViewTab[] = []
    const readingViews: HostObservable<readonly ViewTab[]> = {
      getSnapshot: () => {
        const next = scope.slots.getVersion('qs.stage.view'), locale = scope.locale.getSnapshot().revision
        if (next !== version || locale !== revision) {
          version = next; revision = locale
          // list 槽注册已强制要求 id，读取注册后的条目无需再次校验。
          views = scope.slots.entries('qs.stage.view').map(entry => ({
            id: entry.options.id as string, label: resolveSlotLabel(entry.options.label) ?? entry.options.id as string,
          }))
        }
        return views
      },
      subscribe: (listener) => {
        const slots = scope.slots.subscribe('qs.stage.view', listener), locale = scope.locale.subscribe(listener)
        return () => { slots(); locale() }
      },
    }
    scope.slots.inject('qs.stage.reading', () => scope.slots.register({
      name: 'qs.stage.reading', locale: 'qs-conversation', store: shared.store,
      children: { 'qs.stage.view': { kind: 'list', scope: 'session' } },
      inject: (sessionId): ReadingInjected => ({ hooks: { readingViews }, activate: (view) => { shared.activate(sessionId, view) } }),
    }, Reading))
  })
  ctx.slots.inject('qs.stage.pending', () => ctx.slots.register({
    name: 'qs.stage.pending', locale: 'qs-conversation',
    children: { 'qs.stage.interaction': { kind: 'chain', scope: 'session' } },
  }, PendingSeat))
  ctx.slots.inject('qs.stage.body', () => ctx.slots.register({
    name: 'qs.stage.body', locale: 'qs-conversation',
    children: { 'qs.workspace.hero': { kind: 'single', scope: 'root' }, 'qs.workspace.hero.agentPreset': { kind: 'single', scope: 'root' } },
  }, QsWelcomePane))

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'qs-composer: dictionaries')
  // 与官方 ui-conversation 的 composer-enter 注册一一对应；状态不随呈现卸载而重置。
  ctx.slots.inject('qs.settings.general.item', () => ctx.slots.register({
    name: 'qs.settings.general.item', id: 'composer-enter', order: 20, locale: NS,
    inject: (): EnterBehaviorInjected => ({
      hooks: { busyEnter: ctx.conversationPresentation.submission.busyEnter },
      setBusyEnter: (behavior) => { ctx.conversationPresentation.submission.setBusyEnter(behavior) },
    }),
  }, EnterBehaviorRow))


  let reservedId: string | undefined
  let disposed = false
  let sending = false
  const freezeHolders = new Map<symbol, 'command' | 'confirmation'>()
  ctx.effect(() => () => { disposed = true; freezeHolders.clear(); (ctx.get('qsShell') as IQsUiMode | undefined)?.setLocalFreeze(undefined) }, 'qs-composer: release freeze')
  const emptyRows: readonly QueueRowView[] = []
  const emptyQueue = { getSnapshot: () => emptyRows, subscribe: () => () => {} }
  const sessions = ctx.get('sessions') as ISessions

  let snapshot: QsComposerSnapshot = { frozen: false, unownedDraft: '', freezeReason: undefined }
  const listeners = new Set<() => void>()
  const publish = (next: QsComposerSnapshot): void => {
    snapshot = next
    for (const listener of [...listeners]) listener()
  }
  // 创建交接与弹层分别持有冻结原因，任何释放都不能覆盖其他持有者。
  const publishFreeze = (): void => {
    const reason = sending ? 'sending' : freezeHolders.values().next().value
    publish({ ...snapshot, frozen: reason !== undefined, freezeReason: reason })
    ;(ctx.get('qsShell') as IQsUiMode | undefined)?.setLocalFreeze(reason)
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
    children: {
      'qs.composer.overlay': { kind: 'list', scope: 'session' },
      'qs.composer.model': { kind: 'single', scope: 'session' },
      'qs.composer.takeover': { kind: 'chain', scope: 'session' },
    },
    inject: (sessionId): QsComposerInjected => {
      const scope = sessionId === undefined ? undefined : sessions.scope(sessionId)
      const input = scope === undefined ? undefined : ctx.conversation.input.for(scope)
      const block = sessionId === undefined ? undefined : ctx.conversation.blocks.storeFor(sessionId)
      const connection = ctx.get('connection') as ConnectionHandle | undefined
      const models = sessionId === undefined ? undefined : ctx.get('modelDirectories')?.directoryFor(sessionId)
      const resolveMode = (gesture: Parameters<QsComposerInjected['submitGesture']>[0]) => {
        const session = sessionId === undefined ? undefined : faceOf(sessionId)?.getSnapshot()
        return ctx.conversationPresentation.submission.resolve(
          session?.running ?? false, gesture, session?.subagent == null || session.subagent.address.mode === 'continuable',
        )
      }
      return ({
        submitGesture: (gesture) => {
          const session = sessionId === undefined ? undefined : faceOf(sessionId)?.getSnapshot()
          if (sessionId === undefined || input === undefined || session === undefined) return
          // 整队操作由官方输入机执行，保留其队列身份、顺序与失败处理。
          if (input.state.getSnapshot().draft.trim() === '') {
            if (gesture === 'accelerated' && session.running && (session.subagent == null || session.subagent.address.mode === 'continuable')) {
              ctx.conversationPresentation.submission.steerQueue(sessionId)
            }
            return
          }
          // 在发送时读取真实会话与共享偏好，避免渲染后的旧运行状态决定投递方式。
          input.submit(resolveMode(gesture))
        },
        // 仅复用已安装官方触发器；不在 QS 重建来源注册表或控制器。
        acquireTriggerConsumer: () => {
          if (scope === undefined) return undefined
          const triggers = ctx.get('inputTriggers') as { acquireConsumer: (scope: ClientContext, policy: { triggers: readonly ('/' | '@')[] }) => { release: () => void } } | undefined
          return triggers?.acquireConsumer(scope, { triggers: ['/'] }).release
        },
        hooks: {
          qsSubmitMode: {
            getSnapshot: () => resolveMode('enter'),
            subscribe: (listener) => {
              // 偏好和会话状态任一变化均刷新提示；槽卸载释放两份订阅。
              const preference = ctx.conversationPresentation.submission.busyEnter.subscribe(listener)
              const session = sessionId === undefined ? undefined : faceOf(sessionId)?.subscribe(listener)
              return () => { preference(); session?.() }
            },
          },
          qsPreparation: preparation.forSession(sessionId),
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
        acquireFreeze: (reason) => {
          if (disposed) return () => {}
          const holder = Symbol(reason)
          freezeHolders.set(holder, reason)
          publishFreeze()
          return () => { if (freezeHolders.delete(holder)) publishFreeze() }
        },
        setFrozen: (reason): void => {
          if (disposed) return
          sending = reason !== undefined
          publishFreeze()
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
  }, ComposerHost))
}

/** 会话快照类型再导出，供后续里程碑的行内队列编辑复用。 */
export type QsComposerSessionSnapshot = SessionSnapshot
