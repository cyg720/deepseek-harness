

/** Package-owned durable retry-event invariants. @module @deepseek-ai/dsh-llm-retry/invariant */

/*
 * 【文件职责】检查模型重试持久事件的身份和生命周期关联，保证重试链可从日志还原。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { LlmFailure } from '@deepseek-ai/dsh-llm'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { providerForOpenStep } from './history.ts'
import type {} from './index.ts'

// 中文：注册不变量时使用的包名标识。
const PACKAGE_NAME = '@deepseek-ai/dsh-llm-retry'

/** Cordis companion plugin name. */
// 中文：Cordis 伴生插件名。
export const name = 'llm-retry-invariant'
/** Service required before the companion can reserve package ownership. */
// 中文：要求 invariants 服务先就绪。
export const inject = ['invariants']

/** Validate the complete provider-neutral failure payload at the durable boundary. */
// 中文：在持久边界校验完整的 provider 中立失败负载（message/code 非空、
// status 为 100~599 整数、延迟为正有限数、requestId 非空）。
function validateFailure(value: unknown, fail: InvariantFailure): asserts value is LlmFailure {
  if (typeof value !== 'object' || value === null) {
    fail('llm/retry failure must be an object')
  }
  const failure = value as Partial<LlmFailure>
  if (typeof failure.message !== 'string' || failure.message.length === 0) {
    fail('llm/retry failure.message must be a non-empty string')
  }
  if (typeof failure.code !== 'string' || failure.code.length === 0) {
    fail('llm/retry failure.code must be a non-empty string')
  }
  if (failure.status !== undefined
    && (!Number.isInteger(failure.status) || failure.status < 100 || failure.status > 599)) {
    fail('llm/retry failure.status must be an integer from 100 through 599 when present')
  }
  if (failure.providerRetryAfterMs !== undefined
    && (!Number.isFinite(failure.providerRetryAfterMs) || failure.providerRetryAfterMs <= 0)) {
    fail('llm/retry failure.providerRetryAfterMs must be a positive finite number when present')
  }
  if (failure.requestId !== undefined
    && (typeof failure.requestId !== 'string' || failure.requestId.length === 0)) {
    fail('llm/retry failure.requestId must be a non-empty string when present')
  }
}

/** Validate one retry record against the currently open request step. */
// 中文：对照当前打开的请求步骤校验一条调度记录：字段合法性、normal/always
// 模式约束、必须在打开的 turn/step 内、provider 与失败请求一致、retry 序号
// 连续、retryId 跨链不重用。
function validateRetry(
  history: readonly SessionEvent[],
  event: SessionEvent<'llm/retry'>,
  fail: InvariantFailure,
): void {
  const { retryId, turn, step, provider, mode, policyKey, retry, delayMs } = event.data
  if (typeof retryId !== 'string' || retryId.length === 0) {
    fail('llm/retry retryId must be a non-empty string')
  }
  const failure: unknown = event.data.failure
  validateFailure(failure, fail)
  if (!Number.isSafeInteger(retry) || retry < 1) {
    fail('llm/retry retry must be a positive safe integer')
  }
  if (typeof provider !== 'string' || provider.length === 0) {
    fail('llm/retry provider must be a non-empty string')
  }
  if (typeof policyKey !== 'string' || policyKey.length === 0) {
    fail('llm/retry policyKey must be a non-empty string')
  }
  // 中文：模式约束：normal 的 retry 不得超过 maxRetries；always 不得携带
  // maxRetries；模式取值只能是两者之一。
  switch (mode) {
    case 'normal': {
      const { maxRetries } = event.data
      if (!Number.isSafeInteger(maxRetries) || maxRetries < 1 || retry > maxRetries) {
        fail(`llm/retry retry ${retry} must not exceed a positive safe maxRetries ${maxRetries}`)
      }
      break
    }
    case 'always':
      if ('maxRetries' in event.data) fail('llm/retry always mode must omit maxRetries')
      break
    default:
      fail(`llm/retry mode must be normal or always, got ${String(mode)}`)
  }
  if (typeof delayMs !== 'number' || !Number.isFinite(delayMs)
    || delayMs < 0 || delayMs > MAX_TIMER_DELAY_MS) {
    fail(`llm/retry delayMs must be a finite number within 0..${MAX_TIMER_DELAY_MS}`)
  }

  // 中文：上下文边界：记录必须在打开的 turn/step 内，且 turn/step 一致。
  const turnBoundary = history.findLast(prior =>
    prior.type === 'turn/start' || prior.type === 'turn/end')
  if (turnBoundary?.type !== 'turn/start') {
    fail('llm/retry must be appended inside an open turn')
  }
  if (turn !== turnBoundary.data.turn) {
    fail(`llm/retry names turn ${turn}, but the open turn is ${turnBoundary.data.turn}`)
  }

  const stepBoundary = history.findLast(prior =>
    prior.type === 'step/start' || prior.type === 'step/end')
  if (stepBoundary?.type !== 'step/start') {
    fail('llm/retry must be appended inside an open step')
  }
  if (step !== stepBoundary.data.step || turn !== stepBoundary.data.turn) {
    fail(`llm/retry names turn ${turn}/step ${step}, but the open step is ${stepBoundary.data.turn}/${stepBoundary.data.step}`)
  }
  // 中文：provider 路由必须与失败请求一致（从历史请求头解析）。
  const routedProvider = providerForOpenStep(history, turn, step)
  if (routedProvider !== provider) {
    fail(`llm/retry provider ${provider} does not match the failed request provider ${String(routedProvider)}`)
  }

  // 中文：链一致性：retry 序号必须等于同策略链前一条 +1；同一策略链必须
  // 复用同一个 retryId；新链的 retryId 不得被其他链占用。
  const priorPolicyRetry = history.findLast((prior): prior is SessionEvent<'llm/retry'> =>
    prior.type === 'llm/retry'
    && prior.data.turn === turn
    && prior.data.step === step
    && prior.data.provider === provider
    && prior.data.policyKey === policyKey)
  const expectedRetry = (priorPolicyRetry?.data.retry ?? 0) + 1
  if (retry !== expectedRetry) {
    fail(`llm/retry retry ${retry} must equal provider policy retry ${expectedRetry}`)
  }
  if (priorPolicyRetry !== undefined && priorPolicyRetry.data.retryId !== retryId) {
    fail('llm/retry must preserve retryId across one provider-policy chain')
  }
  if (priorPolicyRetry === undefined && history.some(prior =>
    (prior.type === 'llm/retry' || prior.type === 'llm/retry-started')
    && prior.data.retryId === retryId)) {
    fail(`llm/retry retryId ${JSON.stringify(retryId)} is already owned by another chain`)
  }
}

/** Validate one wait-complete transition against its scheduled attempt. */
// 中文：对照其调度记录校验一条"等待完成"转换：必须能找到同 retryId/retry 的
// 调度记录、turn/step 一致、且同一调度不得重复启动。
function validateStarted(
  history: readonly SessionEvent[],
  event: SessionEvent<'llm/retry-started'>,
  fail: InvariantFailure,
): void {
  const { retryId, turn, step, retry } = event.data
  if (typeof retryId !== 'string' || retryId.length === 0) {
    fail('llm/retry-started retryId must be a non-empty string')
  }
  const scheduled = history.findLast((prior): prior is SessionEvent<'llm/retry'> =>
    prior.type === 'llm/retry' && prior.data.retryId === retryId && prior.data.retry === retry)
  if (scheduled === undefined) fail('llm/retry-started pairs no prior scheduled attempt')
  if (scheduled.data.turn !== turn || scheduled.data.step !== step) {
    fail('llm/retry-started turn/step must match its scheduled attempt')
  }
  if (history.some(prior => prior.type === 'llm/retry-started'
    && prior.data.retryId === retryId && prior.data.retry === retry)) {
    fail('llm/retry-started repeats one scheduled attempt')
  }
}

/** Validate every retry record already present in one loaded session. */
// 中文：校验一个已加载会话里已有的每条重试记录（每条都只对"其之前的事件"
// 做校验）。
function validateSession(session: Session, fail: InvariantFailure): void {
  const events = session.snapshotEvents()
  for (const [index, event] of events.entries()) {
    if (event.type === 'llm/retry') validateRetry(events.slice(0, index), event, fail)
    else if (event.type === 'llm/retry-started') validateStarted(events.slice(0, index), event, fail)
  }
}

/** Install validation for loaded and newly appended retry records. */
// 中文：安装校验：对已加载会话全量校验，并挂三个全局钩子——session/created
// 校验新会话、internal/dispatch 拦截新追加事件做增量校验。
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  for (const session of ctx.sessions.list()) validateSession(session, fail)
  ctx.on('session/created', (session) => { validateSession(session, fail) }, { global: true })
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    if (event.type === 'llm/retry') validateRetry(session.snapshotEvents(), event, fail)
    else if (event.type === 'llm/retry-started') validateStarted(session.snapshotEvents(), event, fail)
  }, { global: true })
}, { inject: ['sessions'] })

/*
 * （中文）注册 LLM 重试不变量伴生插件。
 * @param ctx 携带 invariants 服务的 Cordis 上下文。
 * @returns 安装成功后返回可撤销登记的 disposer。
 */
/**
 * Register the LLM retry invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
