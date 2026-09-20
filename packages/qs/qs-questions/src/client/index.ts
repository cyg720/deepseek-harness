/**
 * 提问包的浏览器入口。
 *
 * 与审批共用卡片位，priority 排在审批之后；`select` 只在当前会话存在且 pending 是
 * 提问 / 方案确认时返回非空。表单草稿按 `sessionId + pending.key` 归本包所有
 * （HMR 后丢失，属已知代价）。
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
// 仅类型：引入 SlotRegistry 的 ctx.slots 服务合并与语言。
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { PendingQuestion } from '@deepseek-ai/dsh-client-ui-user-questions/client'
import type { QsInteractionOwnerProps } from '@deepseek-ai/dsh-qs-transcript/client'
import type { QsQuestionDraftMap, QsQuestionsInjected } from './contract.ts'
import { DRAFT_KEY_SEPARATOR, draftKey } from './contract.ts'
import { en, zh } from './locales.ts'
import { QuestionCard } from './QuestionCard.tsx'

/** 本包的本地化命名空间。 */
const NS = 'qs-questions'

/** 必需服务：槽注册表与语言。 */
export const inject = ['slots', 'locale', 'uiSession']

/** 契约再导出。 */
export type * from './contract.ts'
export type { QuestionDraft } from './answer.ts'

/** 提问卡在卡片位上的选举优先级（审批为 1，升序先到先得）。 */
export const QS_QUESTIONS_PRIORITY = 2

/**
 * 安装提问卡。
 * @param ctx - 浏览器根上下文。
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'qs-questions: dictionaries')
  // 草稿按 `sessionId + pending.key + questionId` 归属：卡片换请求不卸载、切会话会
  // 卸载，组件本地状态在两种情况下都会串台或丢失，所以草稿放在 apply 持有的表里。
  // HMR 后丢失属于已知代价（见 06-槽位与状态设计 第七节）。
  let drafts: QsQuestionDraftMap = new Map()
  const draftListeners = new Set<() => void>()
  const draftSource: HostObservable<QsQuestionDraftMap> = {
    getSnapshot: () => drafts,
    subscribe: (listener) => { draftListeners.add(listener); return () => { draftListeners.delete(listener) } },
  }
  const publishDrafts = (next: QsQuestionDraftMap): void => {
    drafts = next
    for (const listener of [...draftListeners]) listener()
  }

  ctx.effect(() => {
    const pending = ctx.uiSession.pendingInteractions
    const observed = new WeakSet<PendingQuestion>()
    let disposed = false
    const observe = (): void => {
      for (const [id, request] of pending.getSnapshot()) {
        if (request.kind !== 'question' && request.kind !== 'plan-review') continue
        if (observed.has(request)) continue
        observed.add(request)
        const settled = (): void => {
          if (disposed) return
          const prefix = `${id}${DRAFT_KEY_SEPARATOR}${request.key}${DRAFT_KEY_SEPARATOR}`
          const next = new Map([...drafts].filter(([key]) => !key.startsWith(prefix)))
          if (next.size !== drafts.size) publishDrafts(next)
        }
        void request.result.then(settled, settled)
      }
    }
    const unsubscribe = pending.subscribe(observe)
    observe()
    return () => { disposed = true; unsubscribe() }
  }, 'qs-questions: release settled drafts')

  ctx.slots.inject('qs.stage.interaction', () => ctx.slots.register({
    name: 'qs.stage.interaction',
    priority: QS_QUESTIONS_PRIORITY,
    locale: NS,
    inject: (): QsQuestionsInjected => ({
      hooks: { questionDraft: draftSource },
      writeDraft: (sessionId, requestKey, questionId, draft) => {
        const key = draftKey(sessionId, requestKey, questionId)
        const next = new Map(drafts)
        if (draft === undefined) next.delete(key)
        else next.set(key, draft)
        publishDrafts(next)
      },
      clearDrafts: (sessionId, requestKey) => {
        const prefix = `${sessionId ?? ''}${DRAFT_KEY_SEPARATOR}${requestKey}${DRAFT_KEY_SEPARATOR}`
        publishDrafts(new Map([...drafts].filter(([key]) => !key.startsWith(prefix))))
      },
    }),
    select: ({ sessionId, pendingInteraction }: QsInteractionOwnerProps): PendingQuestion | null =>
      sessionId !== undefined
        && (pendingInteraction?.kind === 'question' || pendingInteraction?.kind === 'plan-review')
        ? pendingInteraction
        : null,
  }, QuestionCard))
}
