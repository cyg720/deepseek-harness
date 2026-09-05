

/** Package-owned durable clock-context invariants. @module @deepseek-ai/dsh-time-context/invariant */

/*
 * 【文件职责】检查时间上下文的持久记录与来源关系，保证请求时钟信息具备对应日志证据。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import {
  deriveBrowserTimeZoneContext,
  renderBrowserTimeZoneContext,
} from './request-zone.ts'
import { createTimestampFormatter, formatTimestamp } from './timestamp.ts'

/** 本包在 invariant 登记中的唯一标识名。 */
const PACKAGE_NAME = '@deepseek-ai/dsh-time-context'
/** 时间读取消息的来源插件名（source.plugin 归属标记）。 */
const SOURCE_NAME = 'time-context'
/** 持久化时间读取的规范文本正则：回合/步骤、ISO 时间戳、浏览器时区行、流逝时间行。 */
const READING = new RegExp(
  '^Time sampled while preparing turn (\\d+), step (\\d+): '
  + '(\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:Z|[+-]\\d{2}:\\d{2})\\[[^\\]]+\\])\\n'
  + '(Browser time zone for this request: .+)\\n'
  + 'Elapsed since the preceding (model-visible message|step context): '
  + '(?:unavailable|(?:(?:\\d+d )?(?:\\d+h )?(?:\\d+m )?\\d+s))\\.$',
)

/** Cordis companion plugin name. */
/* 该伴生插件的注册名。 */
export const name = 'time-context-invariant'
/** Service required before the companion can reserve package ownership. */
/* 依赖注入声明：invariants 服务就绪后本插件才会被装载。 */
export const inject = ['invariants']

/** Derive the open step boundary at which a time-context reading may append. */
/* 推导允许追加时间读取的"打开的回合 + 步骤"位置：从事件历史回放状态机。 */
function preparationPosition(history: readonly SessionEvent[], fail: InvariantFailure): { turn: number; step: number } {
  let openTurn: number | undefined
  let openStep: number | undefined
  let requestStarted = false
  for (const event of history) {
    switch (event.type) {
      case 'turn/start': {
        openTurn = event.data.turn
        openStep = undefined
        requestStarted = false
        break
      }
      case 'step/start': {
        openStep = event.data.step
        requestStarted = false
        break
      }
      case 'request/header': {
        requestStarted = true
        break
      }
      case 'step/end': {
        openStep = undefined
        requestStarted = false
        break
      }
      case 'turn/end': {
        openTurn = undefined
        openStep = undefined
        requestStarted = false
        break
      }
      default:
        break
    }
  }
  if (openTurn === undefined) fail('time-context reading must be appended inside an open turn')
  if (openStep === undefined) fail('time-context reading must follow step/start')
  if (requestStarted) fail('time-context reading must precede request/header')
  return { turn: openTurn, step: openStep }
}

/** Collect the entered user messages belonging to one open turn. */
/* 收集属于某个打开回合的已进入用户消息（供浏览器时区推导）。 */
function requestMessages(history: readonly SessionEvent[], turn: number) {
  const start = history.findLastIndex(event => event.type === 'turn/start' && event.data.turn === turn)
  return history.slice(start + 1)
    .flatMap(event => event.type === 'user/message' ? [event.data] : [])
}

/** Validate one plugin-attributed time reading against its session position and timestamp. */
/* 校验一条带插件归属的时间读取：块结构、文本正则、回合/步骤位置、来源与时间戳。 */
function validateReading(
  history: readonly SessionEvent[],
  event: SessionEvent<'user/message'>,
  fail: InvariantFailure,
): void {
  // 内容必须是恰好一个文本块（文本类型 + 两个键：type/text）
  const blockValue: unknown = event.data.content[0]
  const block = typeof blockValue === 'object' && blockValue !== null
    ? blockValue as Record<string, unknown>
    : undefined
  const blockText = block?.text
  if (event.data.content.length !== 1
    || block === undefined
    || Object.keys(block).length !== 2
    || block.type !== 'text'
    || typeof blockText !== 'string') {
    fail('time-context messages must contain exactly one text block')
  }
  // 文本必须完全匹配规范格式，并从中提取回合/步骤号
  const match = READING.exec(blockText)
  if (match === null) fail('time-context message does not match the durable reading format')
  const turn = Number(match[1])
  const step = Number(match[2])
  if (!Number.isSafeInteger(turn) || turn < 1 || !Number.isSafeInteger(step) || step < 1) {
    fail('time-context turn and step must be positive safe integers')
  }
  // 声明的回合/步骤必须与事件历史推导出的打开位置一致
  const expected = preparationPosition(history, fail)
  if (turn !== expected.turn || step !== expected.step) {
    fail(`time-context reading names turn ${turn}/step ${step}, expected turn ${expected.turn}/step ${expected.step}`)
  }
  // 来源必须保持包归属（plugin: time-context），且只携带精确的快照文本
  const source = event.data.source
  /* v8 ignore next 2 -- replay and dispatch callers select this exact package-owned source before validation. */
  if (source.kind !== 'plugin' || source.plugin !== SOURCE_NAME) {
    fail('time-context source must retain package ownership')
  }
  const sections: unknown = 'sections' in source ? source.sections : undefined
  const sectionValue: unknown = Array.isArray(sections) ? sections[0] : undefined
  const section = typeof sectionValue === 'object' && sectionValue !== null
    ? sectionValue as Record<string, unknown>
    : undefined
  if (Object.keys(source).length !== 4
    || source.form !== 'snapshot'
    || !Array.isArray(sections)
    || sections.length !== 1
    || section === undefined
    || Object.keys(section).length !== 2
    || section.name !== SOURCE_NAME
    || section.text !== blockText) {
    fail('time-context source must carry only the exact snapshot text, not request authority')
  }
  // 浏览器时区文本必须与当前回合用户消息推导结果一致
  const renderedBrowserContext = match[4]
  const browserContext = deriveBrowserTimeZoneContext(requestMessages(history, turn))
  const expectedBrowserContext = renderBrowserTimeZoneContext(browserContext)
  if (renderedBrowserContext !== expectedBrowserContext) {
    fail('time-context browser-zone text does not match current-turn user messages')
  }
  // 步骤 1 必须以"上一条模型可见消息"为流逝基线，其余步骤以"上一步上下文"为基线
  const baseline = match[5]
  if ((step === 1) !== (baseline === 'model-visible message')) {
    fail(`time-context step ${step} uses the wrong elapsed-time baseline ${JSON.stringify(baseline)}`)
  }
  const rendered = match[3]
  /* v8 ignore next -- the preceding fixed regexp always supplies capture group three. */
  if (rendered === undefined) fail('time-context reading omitted its rendered timestamp')
  // 渲染时间戳必须可解析，且不得晚于持久化事件时间（回放不能"未来注入"）
  const renderedTime = Date.parse(rendered.replace(/\[[^\]]+\]$/, ''))
  if (!Number.isFinite(renderedTime) || !Number.isSafeInteger(event.time)
    || event.time < renderedTime) {
    fail('time-context rendered timestamp must parse and not postdate its durable event')
  }
  // 当浏览器时区唯一确定时，渲染时间戳必须能用该时区精确复现
  if (browserContext.kind === 'resolved') {
    let expectedTimestamp: string
    try {
      expectedTimestamp = formatTimestamp(
        renderedTime,
        createTimestampFormatter(browserContext.timeZone),
        browserContext.timeZone,
      )
    } catch (error: unknown) {
      fail(`time-context browser zone cannot format its durable timestamp: ${String(error)}`)
    }
    if (rendered !== expectedTimestamp) {
      fail('time-context rendered timestamp does not match the unique browser zone')
    }
  }
}

/* jscpd:ignore-start -- package companions share replay and dispatch plumbing */
/** Validate all package-owned readings already present in one session. */
/* 校验一个会话中已存在的全部包归属时间读取（逐个按历史位置校验）。 */
function validateSession(session: Session, fail: InvariantFailure): void {
  const events = session.snapshotEvents()
  for (const [index, event] of events.entries()) {
    if (event.type !== 'user/message'
      || event.data.source.kind !== 'plugin'
      || event.data.source.plugin !== SOURCE_NAME) continue
    validateReading(events.slice(0, index), event, fail)
  }
}

/** Install validation for loaded and newly appended context readings. */
/* 安装校验：已加载会话逐个校验，新会话与实时派发的读取事件即时校验。 */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  for (const session of ctx.sessions.list()) validateSession(session, fail)
  ctx.on('session/created', (session) => { validateSession(session, fail) }, { global: true })
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    if (event.type !== 'user/message'
      || event.data.source.kind !== 'plugin'
      || event.data.source.plugin !== SOURCE_NAME) return
    validateReading(session.snapshotEvents(), event, fail)
  }, { global: true })
}, { inject: ['sessions'] })
/* jscpd:ignore-end */

/**
 * Register the time-context invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
/*
 * 登记 time-context 的 invariant 伴生插件。
 * @param ctx 携带 invariants 服务的 Cordis 上下文
 * @returns 登记成功后的注销函数
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
