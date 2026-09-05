// contextBreakdown projection: heuristic system/tools/message composition,
// plus the shared estimator's pricing branches.
/**
 * 文件职责：验证 context-breakdown-projection.spec.ts 覆盖的 LLM 计量、配置、调用与事件处理行为。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件上下文和可控测试替身验证运行时协作。
 * 产品维度：保障模型调用及令牌统计能向 Agent 和使用者提供稳定、可追踪的结果。
 * 逻辑维度：准备上下文与测试数据，触发被测流程，再核对请求、事件、投影结果和清理行为。
 * 关键边界：测试替身必须保持确定性；持久化事件应可重放；异步资源必须在用例结束时释放。
 * 新手阅读建议：先看测试数据和辅助函数，再按 describe/it 场景阅读，最后对照被测插件实现。
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, ToolSchema } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionSeq } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent, SessionSeq as SessionSeqType } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import type { ContextBreakdownProjection } from '@deepseek-ai/dsh-token-meter/client'
import { CompactionId } from '@deepseek-ai/dsh-compaction'
import { contextBreakdownProjectionDefinition } from '../src/breakdown-projection.ts'
import {
  estimateContent,
  estimateHeader,
  estimateMessage,
  estimateSystemTokens,
  estimateToolsTokens,
} from '../src/estimate.ts'

/** 中文说明：常量 CONFIG 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const CONFIG = { provider: 'test', model: 'test-model' }

/** 中文说明：常量 TOOLS 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const TOOLS: ToolSchema[] = [{
  name: 'bash',
  description: 'run a command',
  parameters: { type: 'object', properties: {} },
}]

/** 中文说明：函数 harness 承担本测试场景中的准备或验证工作；参数按签名传入，返回值供后续断言使用；示例见本文件调用。 */
async function harness(): Promise<{ ctx: Context; session: Session }> {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(TokenMeter)
  return { ctx, session: ctx.sessions.create() }
}

/** 中文说明：函数值 projected 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
const projected = (ctx: Context, session: Session): ContextBreakdownProjection => {
  /** 中文说明：变量 value 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const value = ctx.sessionProjections.snapshot(session).values.contextBreakdown
  if (value === undefined) throw new Error('contextBreakdown projection is not registered')
  return value
}

function appendUser(session: Session, text: string): SessionSeqType {
  return session.append('user/message', createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' }).seq
}

/**
 * Meter one upcoming replacement the way compaction-basic does: price the
 * replaced span from the measurement service's own nodes and log the
 * shadow-price event directly before the replace.
 */
function appendSummaryMeter(ctx: Context, session: Session, start: SessionSeqType, end: SessionSeqType): void {
  const nodes = ctx.tokenMeter.measure(session).nodes
  /** 中文说明：函数值 startIdx 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  const startIdx = nodes.findIndex(node => node.seq === start)
  /** 中文说明：函数值 endIdx 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  const endIdx = nodes.findIndex(node => node.seq === end)
  /** 中文说明：变量 shadowed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const shadowed = nodes.slice(startIdx, endIdx + 1)
  session.append('compaction/summary', {
    compactionId: CompactionId('context-breakdown-summary'),
    summary: [{ type: 'text', text: 'summary' }],
    shadowedRange: { start, end },
    shadowedSeqs: shadowed.map(node => node.seq),
    shadowedTokenCount: shadowed.reduce((total, node) => total + node.tokens, 0),
    provider: 'mock',
    model: 'mock',
  })
}

describe('contextBreakdown session projection', () => {
  it('serves zeros for an empty log', async () => {
    const { ctx, session } = await harness()
    expect(projected(ctx, session)).toEqual({ systemTokens: 0, toolsTokens: 0, messageTokens: 0 })
  })

  it('prices the newest envelope last-wins and pushes no change for a restated one', async () => {
    const { ctx, session } = await harness()
    session.append('request/header', {
      header: { config: CONFIG, system: 'You are terse.', tools: TOOLS },
      reason: 'initial',
    })
    expect(projected(ctx, session)).toEqual({
      systemTokens: estimateSystemTokens({ config: CONFIG, system: 'You are terse.' }),
      toolsTokens: estimateToolsTokens({ config: CONFIG, tools: TOOLS }),
      messageTokens: 0,
    })

    /** 中文说明：变量 changed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const changed: string[] = []
    ctx.sessionProjections.onChanged((_session, key) => { changed.push(key) })
    session.append('request/header', {
      header: { config: CONFIG, system: 'You are terse.', tools: TOOLS },
      reason: 'change',
    })
    session.append('session/end-seed', {})
    expect(changed).not.toContain('contextBreakdown')

    // A system-less, tool-less envelope prices back to zero.
    session.append('request/header', { header: { config: CONFIG }, reason: 'change' })
    expect(projected(ctx, session)).toEqual({ systemTokens: 0, toolsTokens: 0, messageTokens: 0 })
  })

  it('sums surface appends and skips an empty-content assistant message', async () => {
    const { ctx, session } = await harness()
    appendUser(session, 'abcd')
    session.append('step/start', { turn: 1, step: 1 })
    session.append('assistant/message', {
      stream: [],
      turn: 1,
      step: 1,
      message: createMessage({
        role: 'assistant',
        content: [],
        source: { kind: 'model', provider: 'mock', model: 'mock' },
      }),
      usage: { inputTokens: 9, outputTokens: 0 },
    }, { surfaceOp: 'append' })
    session.append('step/end', { turn: 1, step: 1 })
    // 'abcd' prices to 9 (1 text + 4 block + 4 role); the usage-only assistant
    // message derives to no transcript entry and adds nothing.
    expect(projected(ctx, session).messageTokens).toBe(9)
  })

  it('shrinks the message figure when a metered replacement compacts the surface', async () => {
    const { ctx, session } = await harness()
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = appendUser(session, 'before compaction, a longer message')
    /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const second = appendUser(session, 'and a second entry')
    /** 中文说明：变量 summary 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const summary = createUserMessage({
      content: [{ type: 'text', text: 'summary' }],
      source: { kind: 'plugin', plugin: 'test' },
    })
    appendSummaryMeter(ctx, session, first, second)
    session.append('user/message', summary, {
      surfaceOp: { op: 'replace', start: first, end: second },
      sourceEventSeqs: [first, second],
    })
    expect(projected(ctx, session).messageTokens).toBe(estimateMessage(summary))
  })

  it('keeps the message figure equal to the service result across appends and a compaction', async () => {
    const { ctx, session } = await harness()
    // The panel's composition rows and `measure()` answer the same question in
    // the same vocabulary; one shared fold is what makes that true.
    /** 中文说明：函数值 agree 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const agree = (): number => {
      /** 中文说明：变量 messageTokens 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const messageTokens = projected(ctx, session).messageTokens
      expect(messageTokens).toBe(ctx.tokenMeter.measure(session).surfaceTokens)
      return messageTokens
    }
    session.append('request/header', {
      header: { config: CONFIG, system: 'You are terse.', tools: TOOLS },
      reason: 'initial',
    })
    expect(agree()).toBe(0)

    /** 中文说明：变量 question 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const question = appendUser(session, 'a first question, long enough to price above zero')
    session.append('step/start', { turn: 1, step: 1 })
    /** 中文说明：变量 answer 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const answer = session.append('assistant/message', {
      stream: [],
      turn: 1,
      step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'a considered answer' }],
        source: { kind: 'model', provider: 'mock', model: 'mock' },
      }),
      usage: { inputTokens: 40, outputTokens: 7 },
    }, { surfaceOp: 'append' }).seq
    session.append('step/end', { turn: 1, step: 1 })
    /** 中文说明：变量 grown 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const grown = agree()
    expect(grown).toBeGreaterThan(0)

    appendSummaryMeter(ctx, session, question, answer)
    // The armed shadow price must not move the published figure by itself.
    expect(agree()).toBe(grown)
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'summary' }],
      source: { kind: 'plugin', plugin: 'test' },
    }), {
      surfaceOp: { op: 'replace', start: question, end: answer },
      sourceEventSeqs: [question, answer],
    })
    expect(agree()).toBeLessThan(grown)
  })

  it('folds a replacement without a claim at zero and fails on a mismatched claim', () => {
    /** 中文说明：变量 definition 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const definition = contextBreakdownProjectionDefinition
    const replace = (start: SessionSeq, end: SessionSeq): SessionEvent => ({
      type: 'user/message',
      seq: SessionSeq(9),
      time: 0,
      data: createUserMessage({ content: [{ type: 'text', text: 'x' }], source: { kind: 'user' } }),
      surfaceOp: { op: 'replace', start, end },
      sourceEventSeqs: [start, end],
    } as unknown as SessionEvent)
    const append = (seq: SessionSeq): SessionEvent => ({
      type: 'user/message',
      seq,
      time: 0,
      data: createUserMessage({ content: [{ type: 'text', text: 'x' }], source: { kind: 'user' } }),
      surfaceOp: 'append',
    } as unknown as SessionEvent)
    const meter = (start: SessionSeq, end: SessionSeq, seq: SessionSeq): SessionEvent => ({
      type: 'compaction/prune',
      seq,
      time: 0,
      data: {
        shadowedRange: { start, end },
        shadowedSeqs: [start, end],
        shadowedTokenCount: 5,
      },
    } as unknown as SessionEvent)
    /** 中文说明：变量 state 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let state = definition.init()
    state = definition.apply(state, append(SessionSeq(1)))
    state = definition.apply(state, append(SessionSeq(3)))
    // No metering event: the replacement contributes zero instead of throwing.
    expect(definition.wire.view(definition.apply(state, replace(SessionSeq(1), SessionSeq(3)))).messageTokens)
      .toBe(definition.wire.view(state).messageTokens)
    // An adjacent claim for another range contradicts the replacement.
    const mismatched = definition.apply(state, meter(SessionSeq(1), SessionSeq(1), SessionSeq(8)))
    expect(() => definition.apply(mismatched, replace(SessionSeq(1), SessionSeq(3))))
      .toThrow('no adjacent shadow price')
    // A claim expires after one intervening event, so replacement delta is zero.
    let expired = definition.apply(state, meter(SessionSeq(1), SessionSeq(3), SessionSeq(8)))
    expired = definition.apply(expired, {
      type: 'session/end-seed', seq: SessionSeq(9), time: 0, data: {},
    })
    expect(definition.wire.view(definition.apply(expired, replace(SessionSeq(1), SessionSeq(3)))).messageTokens)
      .toBe(definition.wire.view(state).messageTokens)
    // The armed claim prices exactly the next event's matching replacement.
    const armed = definition.apply(state, meter(SessionSeq(1), SessionSeq(3), SessionSeq(8)))
    expect(definition.wire.view(definition.apply(armed, replace(SessionSeq(1), SessionSeq(3)))).messageTokens)
      .toBe(definition.wire.view(state).messageTokens - 5 + estimateMessage(
        createUserMessage({ content: [{ type: 'text', text: 'x' }], source: { kind: 'user' } }),
      ))
  })

  it('keeps the persisted checkpoint O(1) as the surface grows and compacts', async () => {
    const { ctx, session } = await harness()
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = appendUser(session, 'the first of many messages')
    /** 中文说明：该循环依次处理场景数据；循环变量仅在当前循环中有效。 */
    for (let index = 0; index < 24; index += 1) appendUser(session, `message number ${index} with some text`)
    /** 中文说明：变量 last 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const last = appendUser(session, 'the last message before compaction')
    /** 中文说明：函数值 stateKeys 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const stateKeys = (): string[] => {
      /** 中文说明：变量 row 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const row = ctx.sessionProjections.checkpoint(session)['contextBreakdown']
      if (row === undefined) throw new Error('contextBreakdown checkpoint row is missing')
      return Object.keys(row.val as Record<string, unknown>).sort()
    }
    // Growth adds no per-node bookkeeping to the durable state.
    expect(stateKeys()).toEqual(['messageTokens', 'systemTokens', 'toolsTokens'])
    /** 中文说明：变量 shadowed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const shadowed = session.surface.nodes.slice(
      session.surface.nodes.indexOf(first),
      session.surface.nodes.indexOf(last) + 1,
    )
    appendSummaryMeter(ctx, session, first, last)
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'summary' }],
      source: { kind: 'plugin', plugin: 'test' },
    }), {
      surfaceOp: { op: 'replace', start: first, end: last },
      sourceEventSeqs: [...shadowed],
    })
    expect(stateKeys()).toEqual(['messageTokens', 'systemTokens', 'toolsTokens'])
    expect(projected(ctx, session).messageTokens)
      .toBe(ctx.tokenMeter.measure(session).surfaceTokens)
  })

  it('restores from a JSON checkpoint and unregisters with the token-meter fiber', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    /** 中文说明：变量 meterFiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const meterFiber = await ctx.plugin(TokenMeter)
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = ctx.sessions.create()
    session.append('request/header', {
      header: { config: CONFIG, system: 'You are terse.' },
      reason: 'initial',
    })
    appendUser(session, 'abcd')
    /** 中文说明：变量 checkpoint 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const checkpoint = JSON.parse(JSON.stringify(
      ctx.sessionProjections.checkpoint(session),
    )) as ReturnType<typeof ctx.sessionProjections.checkpoint>

    await meterFiber.dispose()
    expect(ctx.sessionProjections.snapshot(session).values).not.toHaveProperty('contextBreakdown')

    await ctx.plugin(TokenMeter)
    expect(ctx.sessionProjections.viewCheckpoint(checkpoint).contextBreakdown).toEqual({
      systemTokens: estimateSystemTokens({ config: CONFIG, system: 'You are terse.' }),
      toolsTokens: 0,
      messageTokens: 9,
    })
  })
})

describe('shared estimator', () => {
  it('prices every content-block shape under the fixed heuristic', () => {
    expect(estimateContent([{ type: 'text', text: 'abcd' }])).toBe(5)
    expect(estimateContent([{ type: 'reasoning', text: 'abcdefgh' }] as ContentBlock[])).toBe(6)
    expect(estimateContent([{ type: 'tool-call', id: 'c' as never, name: 'bash', arguments: '{"a":1}' }])).toBe(7)
    expect(estimateContent([{
      type: 'tool-result', toolCallId: 'c' as never,
      content: [{ type: 'text', text: 'abcd' }],
    }])).toBe(9)
    /** 中文说明：变量 unknown 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const unknown = { type: 'mystery', payload: 'abc' } as unknown as ContentBlock
    expect(estimateContent([unknown])).toBe(4 + Math.ceil(JSON.stringify(unknown).length / 4))
  })

  it('prices envelope parts independently and absent parts to zero', () => {
    expect(estimateSystemTokens(undefined)).toBe(0)
    expect(estimateSystemTokens({ config: CONFIG })).toBe(0)
    expect(estimateSystemTokens({ config: CONFIG, system: 'abcdefgh' })).toBe(6)
    expect(estimateToolsTokens(undefined)).toBe(0)
    expect(estimateToolsTokens({ config: CONFIG, tools: [] })).toBe(0)
    expect(estimateToolsTokens({ config: CONFIG, tools: TOOLS }))
      .toBe(Math.ceil(JSON.stringify(TOOLS).length / 4) + 4)
    expect(estimateHeader(undefined)).toBe(0)
    expect(estimateHeader({ config: CONFIG, system: 'abcdefgh', tools: TOOLS }))
      .toBe(6 + Math.ceil(JSON.stringify(TOOLS).length / 4) + 4)
  })
})
