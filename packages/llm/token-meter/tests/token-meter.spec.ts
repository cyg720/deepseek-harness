/**
 * 文件职责：验证 token-meter.spec.ts 覆盖的 LLM 计量、配置、调用与事件处理行为。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件上下文和可控测试替身验证运行时协作。
 * 产品维度：保障模型调用及令牌统计能向 Agent 和使用者提供稳定、可追踪的结果。
 * 逻辑维度：准备上下文与测试数据，触发被测流程，再核对请求、事件、投影结果和清理行为。
 * 关键边界：测试替身必须保持确定性；持久化事件应可重放；异步资源必须在用例结束时释放。
 * 新手阅读建议：先看测试数据和辅助函数，再按 describe/it 场景阅读，最后对照被测插件实现。
 */
import { describe, expect, expectTypeOf, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { AssistantStreamAccumulator, createUserMessage, ToolCallId, createMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, Message, TokenUsage } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId, SessionSeq, canonicalHeader } from '@deepseek-ai/dsh-session'
import type { EpochHeader, SessionEvent, SessionSeq as SessionSeqType } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import type { TokenMeasurement, TokenMeterConfig } from '@deepseek-ai/dsh-token-meter'

/** 中文说明：函数 header 承担本测试场景中的准备或验证工作；参数按签名传入，返回值供后续断言使用；示例见本文件调用。 */
function header(model: string, extras: Omit<EpochHeader, 'config'> = {}): EpochHeader {
  return canonicalHeader({ config: { provider: 'mock', model }, ...extras })
}

/** 中文说明：函数 textMessage 承担本测试场景中的准备或验证工作；参数按签名传入，返回值供后续断言使用；示例见本文件调用。 */
function textMessage(text: string, role: Message['role'] = 'user'): Message {
  return createMessage({
    role,
    content: [{ type: 'text', text }],
    source: role === 'assistant'
      ? { kind: 'model', provider: 'mock', model: 'mock' }
      : { kind: 'user' },
  })
}

/** 中文说明：函数 appendHeader 承担本测试场景中的准备或验证工作；参数按签名传入，返回值供后续断言使用；示例见本文件调用。 */
function appendHeader(session: Session, value: EpochHeader): void {
  session.append('request/header', { header: value, reason: 'initial' })
}

/** Inject malformed persisted history after the live append boundary for defensive replay tests. */
/* 中文说明：函数 appendUnchecked 承担本测试场景中的准备或验证工作；参数按签名传入，返回值供后续断言使用；示例见本文件调用。 */
function appendUnchecked(session: Session, event: SessionEvent): void {
  /** 中文说明：变量 log 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const log = (session as unknown as { log: SessionEvent[] }).log
  log.push(event)
}

/** 中文说明：interface SuccessfulCallOptions 定义本测试所需的数据或行为，用于表达当前协议场景。 */
interface SuccessfulCallOptions {
  turn?: number
  step?: number
  providerText?: string
  durableText?: string
  usage?: TokenUsage
}

/** 中文说明：函数 appendSuccessfulCall 承担本测试场景中的准备或验证工作；参数按签名传入，返回值供后续断言使用；示例见本文件调用。 */
function appendSuccessfulCall(
  session: Session,
  value: EpochHeader,
  options: SuccessfulCallOptions = {},
): void {
  /** 中文说明：变量 turn 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const turn = options.turn ?? 1
  /** 中文说明：变量 step 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const step = options.step ?? 1
  /** 中文说明：变量 providerText 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const providerText = options.providerText ?? 'provider answer'
  /** 中文说明：变量 durableText 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const durableText = options.durableText ?? providerText
  session.append('step/start', { turn, step })
  appendHeader(session, value)

  const chunks = [
    { type: 'block-start' as const, index: 0, blockType: 'text' as const },
    { type: 'text-delta' as const, index: 0, text: providerText },
    { type: 'block-end' as const, index: 0, block: { type: 'text' as const, text: providerText } },
    ...options.usage === undefined ? [] : [{ type: 'usage' as const, usage: options.usage }],
    { type: 'finish' as const, reason: { kind: 'stop' as const } },
  ]
  const accumulator = new AssistantStreamAccumulator()
  for (const [index, chunk] of chunks.entries()) accumulator.push({ time: index, chunk })
  session.append('assistant/message', {
    stream: [...accumulator.snapshot()],
    turn,
    step,
    message: createMessage({
      role: 'assistant',
      content: durableText.length === 0 ? [] : [{ type: 'text', text: durableText }],
      source: {
        kind: 'model',
        ...{
          provider: value.config.provider,
          model: value.config.model,
        },
      },
    }),
    ...options.usage === undefined ? {} : { usage: options.usage },
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn, step })
}

/** 中文说明：函数 meter 承担本测试场景中的准备或验证工作；参数按签名传入，返回值供后续断言使用；示例见本文件调用。 */
function meter(config: TokenMeterConfig = {}): TokenMeter {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  // The registry is a required injection of the service (its three projection
  // units register in the constructor); mount it synchronously.
  new SessionProjectionRegistry(ctx)
  return new TokenMeter(ctx, config)
}

/** 中文说明：函数 expectSurfaceTotal 承担本测试场景中的准备或验证工作；参数按签名传入，返回值供后续断言使用；示例见本文件调用。 */
function expectSurfaceTotal(measurement: TokenMeasurement): void {
  expect(measurement.nodes.reduce((total, node) => total + node.tokens, 0))
    .toBe(measurement.surfaceTokens)
}

describe('TokenMeter configuration and registration', () => {
  it('exposes an empty public configuration type', () => {
    expectTypeOf<{}>().toExtend<TokenMeterConfig>()
    expectTypeOf<{ contextWindow: number }>().not.toExtend<TokenMeterConfig>()
  })

  it.each(['models', 'contextWindow', 'contextWidow'])(
    'rejects stale or unknown top-level config key %s',
    (key) => {
      expect(() => meter({ [key]: {} } as unknown as TokenMeterConfig))
        .toThrow(`TokenMeterConfig: unknown key "${key}"`)
    },
  )

  it('registers and unregisters ctx.tokenMeter with its plugin fiber', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = await ctx.plugin(TokenMeter)
    expect(ctx.get('tokenMeter')).toBeInstanceOf(TokenMeter)
    await fiber.dispose()
    expect(ctx.get('tokenMeter')).toBeUndefined()
  })
})

describe('TokenMeter pricing', () => {
  it('prices every built-in content shape and merge-extended blocks with one fixed heuristic', () => {
    /** 中文说明：变量 service 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const service = meter()
    /** 中文说明：变量 blocks 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const blocks: ContentBlock[] = [
      { type: 'text', text: 'abcd' },
      { type: 'reasoning', text: 'ab' },
      { type: 'tool-call', id: ToolCallId('c'), name: 'read', arguments: '{"x":1}' },
      {
        type: 'tool-result',
        toolCallId: ToolCallId('c'),
        content: [{ type: 'text', text: 'xy' }],
        isError: false,
      },
      { type: 'future-block', payload: 'abcd' } as unknown as ContentBlock,
    ]
    /** 中文说明：变量 estimated 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const estimated = service.estimateMessage(createMessage({
      role: 'assistant', content: blocks,
      source: { kind: 'plugin', plugin: 'test' },
    }))
    expect(estimated).toBeGreaterThan(30)
    expect(service.estimateMessage(textMessage('abcd'))).toBe(9)
  })

  it('returns a detached deeply immutable empty measurement', () => {
    /** 中文说明：变量 service 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const service = meter()
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = Session.create(SessionId('empty'))
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = service.measure(session)
    expect(result).toEqual({
      logRevision: 0,
      baseline: { kind: 'none', tokens: 0 },
      surfaceDeltaTokens: 0,
      totalTokens: 0,
      surfaceTokens: 0,
      nodes: [],
    })
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.baseline)).toBe(true)
    expect(Object.isFrozen(result.nodes)).toBe(true)
    expectSurfaceTotal(result)
    expect(() => {
      ;(result as { totalTokens: number }).totalTokens = 1
    }).toThrow(TypeError)
  })

  it('keeps an earlier unified snapshot detached from later replay', () => {
    /** 中文说明：变量 service 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const service = meter()
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = Session.create(SessionId('detached'))
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'first' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    /** 中文说明：变量 snapshot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const snapshot = service.measure(session)
    /** 中文说明：变量 snapshotCopy 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const snapshotCopy = structuredClone(snapshot)
    expect(Object.isFrozen(snapshot.nodes)).toBe(true)
    expect(Object.isFrozen(snapshot.nodes[0])).toBe(true)
    expectSurfaceTotal(snapshot)
    expect(() => {
      ;(snapshot.nodes as Array<{ seq: SessionSeqType; tokens: number; heuristicTokens: number }>)
        .push({ seq: SessionSeq(99), tokens: 1, heuristicTokens: 1 })
    }).toThrow(TypeError)
    expect(() => {
      ;(snapshot.nodes[0] as { seq: number; tokens: number }).tokens = 1
    }).toThrow(TypeError)

    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'second' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    /** 中文说明：变量 advanced 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const advanced = service.measure(session)
    expect(advanced.logRevision).toBe(2)
    expect(advanced.nodes).toHaveLength(2)
    expectSurfaceTotal(advanced)
    expect(snapshot).toEqual(snapshotCopy)
    expect(snapshot.logRevision).toBe(1)
    expect(snapshot.nodes).toHaveLength(1)
  })

  it('prices header, tools, and surface when no reusable usage exists', () => {
    /** 中文说明：变量 service 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const service = meter()
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = Session.create(SessionId('heuristic'))
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'question' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    appendHeader(session, header('deepseek-v4-flash', {
      system: 'system',
      tools: [{ name: 'read', description: 'read', parameters: { type: 'object' } }],
    }))
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = service.measure(session)
    expect(result.baseline.kind).toBe('estimated')
    expect(result.totalTokens).toBeGreaterThan(result.surfaceTokens)
    expect(result.logRevision).toBe(session.snapshotEvents().length)
    expectSurfaceTotal(result)
  })

  it('keeps request-header overrides out of the returned surface', () => {
    /** 中文说明：变量 service 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const service = meter()
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = Session.create(SessionId('override-surface'))
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'question' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    /** 中文说明：变量 logged 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const logged = service.measure(session)
    /** 中文说明：变量 overridden 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const overridden = service.measure(session, header('another-model', {
      system: 'large override '.repeat(100),
    }))
    expect(overridden.totalTokens).toBeGreaterThan(logged.totalTokens)
    expect(overridden.surfaceTokens).toBe(logged.surfaceTokens)
    expect(overridden.nodes).toEqual(logged.nodes)
    expectSurfaceTotal(overridden)
  })
})

describe('replay anchors and surface folds', () => {
  /** 中文说明：常量 USAGE 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
  const USAGE: TokenUsage = {
    inputTokens: 20,
    cacheReadTokens: 3,
    cacheWriteTokens: 4,
    outputTokens: 7,
    reasoningTokens: 6,
  }

  it('uses disjoint provider usage and signed durable-output rewrites', () => {
    /** 中文说明：变量 service 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const service = meter()
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = Session.create(SessionId('usage'))
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'before' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    appendSuccessfulCall(session, header('deepseek-v4-flash'), {
      providerText: 'short',
      durableText: 'a much longer rewritten durable assistant answer',
      usage: USAGE,
    })
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = service.measure(session)
    expect(result.baseline).toMatchObject({ kind: 'usage', tokens: 34, usage: USAGE })
    expect(result.surfaceDeltaTokens).toBeGreaterThan(0)
    expect(result.totalTokens).toBe(34 + result.surfaceDeltaTokens)
    expect(() => {
      ;((result.baseline as { usage: { inputTokens: number } }).usage.inputTokens) = 1
    }).toThrow(TypeError)
  })

  it('selects a heuristic anchor when provider usage would undercut its scale', () => {
    /** 中文说明：变量 service 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const service = meter()
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = Session.create(SessionId('low-usage-anchor'))
    /** 中文说明：变量 system 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const system = 'system context'
    /** 中文说明：变量 requestHeader 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const requestHeader = header('deepseek-v4-flash', { system })
    appendSuccessfulCall(session, requestHeader, {
      providerText: 'abcd'.repeat(512),
      usage: { inputTokens: 20, outputTokens: 7 },
    })

    /** 中文说明：变量 anchored 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const anchored = service.measure(session)
    expect(anchored.baseline.kind).toBe('estimated')
    /** 中文说明：变量 assistant 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const assistant = anchored.nodes[0]!.seq
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'short' }],
      source: { kind: 'plugin', plugin: 'test' },
    }), {
      surfaceOp: { op: 'replace', start: assistant, end: assistant },
      sourceEventSeqs: [assistant],
    })

    /** 中文说明：变量 shrunken 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const shrunken = service.measure(session)
    expect(27 + shrunken.surfaceDeltaTokens).toBeLessThan(0)
    expect(shrunken.totalTokens).toBeGreaterThan(0)
    expect(shrunken.totalTokens).toBe(service.measure(
      session,
      header('different-model', { system }),
    ).totalTokens)
  })

  it('uses an estimated anchor when provider usage is absent', () => {
    /** 中文说明：变量 service 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const service = meter()
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = Session.create(SessionId('missing-usage'))
    appendSuccessfulCall(session, header('deepseek-v4-flash', { system: 's' }), {
      providerText: 'provider',
      durableText: 'rewritten',
    })
    /** 中文说明：变量 anchored 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const anchored = service.measure(session)
    expect(anchored.baseline.kind).toBe('estimated')
    expect(anchored.surfaceDeltaTokens).toBe(0)
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'later' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    /** 中文说明：变量 advanced 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const advanced = service.measure(session)
    expect(advanced.surfaceDeltaTokens).toBeGreaterThan(0)
  })

  it('keeps only the latest successful request anchor across model switches', () => {
    /** 中文说明：变量 service 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const service = meter()
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = Session.create(SessionId('switch'))
    /** 中文说明：变量 alphaHeader 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const alphaHeader = header('alpha', { system: 'same envelope' })
    appendSuccessfulCall(session, alphaHeader, { usage: USAGE, providerText: 'alpha' })
    expect(service.measure(session).baseline).toMatchObject({ kind: 'usage', tokens: 34 })

    appendSuccessfulCall(session, header('beta'), {
      turn: 1,
      step: 2,
      usage: { inputTokens: 100, outputTokens: 50 },
      providerText: 'beta response',
    })
    expect(service.measure(session).baseline).toMatchObject({ kind: 'usage', tokens: 150 })

    appendHeader(session, alphaHeader)
    /** 中文说明：变量 switchedBack 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const switchedBack = service.measure(session)
    expect(switchedBack.baseline.kind).toBe('estimated')
    expect(switchedBack.surfaceDeltaTokens).toBe(0)
  })

  it('invalidates usage for any canonical envelope change or explicit override', () => {
    /** 中文说明：变量 service 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const service = meter()
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = Session.create(SessionId('envelope'))
    /** 中文说明：变量 anchoredHeader 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const anchoredHeader = header('deepseek-v4-flash', { system: 'one' })
    appendSuccessfulCall(session, anchoredHeader, { usage: USAGE })
    expect(service.measure(session, { ...anchoredHeader, tools: [] }).baseline.kind).toBe('usage')
    expect(service.measure(session, header('deepseek-v4-flash', { system: 'two' })).baseline.kind)
      .toBe('estimated')
    expect(service.measure(session, header('deepseek-v4-pro', { system: 'one' })).baseline.kind)
      .toBe('estimated')
    expect(service.measure(session, {
      ...anchoredHeader,
      config: { ...anchoredHeader.config, temperature: 0.2 },
    }).baseline.kind).toBe('estimated')
    expect(service.measure(session, {
      ...anchoredHeader,
      tools: [{ name: 'read', description: 'read', parameters: { type: 'object' } }],
    }).baseline.kind).toBe('estimated')
  })

  it('folds the latest full header snapshot into the effective envelope', () => {
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = Session.create(SessionId('header-snapshot'))
    appendHeader(session, header('deepseek-v4-flash'))
    session.append('request/header', {
      header: header('deepseek-v4-pro'),
      reason: 'change',
    })
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = meter().measure(session)
    expect(result.baseline.kind).toBe('estimated')
    expect(result.logRevision).toBe(2)
  })

  it('replays seeded append and replace operations with signed deltas', () => {
    /** 中文说明：变量 service 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const service = meter()
    /** 中文说明：变量 original 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const original = Session.create(SessionId('surface-original'))
    appendSuccessfulCall(original, header('deepseek-v4-flash'), {
      usage: USAGE,
      providerText: 'long provider answer '.repeat(100),
    })
    original.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'new tail' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    const seeded = Session.create(SessionId('surface-seeded'), original.snapshotEvents())
    const before = service.measure(seeded)
    expect(before.nodes).toHaveLength(2)
    expect(before.surfaceDeltaTokens).toBeGreaterThan(0)
    expectSurfaceTotal(before)

    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = seeded.surface.nodes[0]!
    seeded.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'replacement' }],
      source: { kind: 'plugin', plugin: 'test' },
    }), { surfaceOp: { op: 'replace', start: first, end: first }, sourceEventSeqs: [first] })
    /** 中文说明：变量 after 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const after = service.measure(seeded)
    expect(after.nodes).toHaveLength(2)
    expect(after.nodes[0]!.seq).toBe(seeded.snapshotEvents().length - 1)
    expect(after.logRevision).toBe(seeded.snapshotEvents().length)
    expect(Object.isFrozen(after.nodes)).toBe(true)
    expect(Object.isFrozen(after.nodes[0])).toBe(true)
    expect(after.surfaceDeltaTokens).toBeLessThan(0)
    expectSurfaceTotal(after)
    expect(before.nodes).toHaveLength(2)
    // The earlier snapshot still reports the log it measured: seed + boundary.
    expect(before.logRevision).toBe(original.snapshotEvents().length + 1)
    expect(before.surfaceDeltaTokens).toBeGreaterThan(0)
  })

  it('prices an empty assistant surface anchor as zero', () => {
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = Session.create(SessionId('empty-assistant'))
    appendSuccessfulCall(session, header('deepseek-v4-flash'), {
      providerText: '',
      durableText: '',
    })
    /** 中文说明：变量 measurement 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const measurement = meter().measure(session)
    const assistant = session.snapshotEvents().find(event => event.type === 'assistant/message')!
    expect(measurement.nodes).toEqual([{ seq: assistant.seq, tokens: 0, heuristicTokens: 0 }])
    expect(measurement.surfaceTokens).toBe(0)
    expectSurfaceTotal(measurement)
  })
})

describe('malformed replay and listener lifecycle', () => {
  /** 中文说明：函数 expectRepeatedFailure 承担本测试场景中的准备或验证工作；参数按签名传入，返回值供后续断言使用；示例见本文件调用。 */
  function expectRepeatedFailure(service: TokenMeter, session: Session, pattern: RegExp): void {
    expect(() => service.measure(session)).toThrow(pattern)
    expect(() => service.measure(session)).toThrow(pattern)
  }

  it('rejects an assistant without its step boundary transactionally', () => {
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = Session.create(SessionId('bad-step'))
    appendHeader(session, header('deepseek-v4-flash'))
    session.append('assistant/message', {
      stream: [],
      turn: 1,
      step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'bad' }],
        source: {
          kind: 'model',
          ...{ provider: 'mock', model: 'deepseek-v4-flash' },
        },
      }),
    }, { surfaceOp: 'append' })
    expectRepeatedFailure(meter(), session, /no matching step\/start/)
  })

  it('leaves the priced surface uncommitted when a later validation step rejects the event', () => {
    // A valid append plan whose anchor validation throws: only commit
    // ordering keeps the surface from double-counting across retries.
    const session = Session.create(SessionId('bad-step-surface'))
    appendHeader(session, header('deepseek-v4-flash'))
    session.append('assistant/message', {
      stream: [],
      turn: 1,
      step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'planned but never committed' }],
        source: {
          kind: 'model',
          ...{ provider: 'mock', model: 'deepseek-v4-flash' },
        },
      }),
    }, { surfaceOp: 'append' })
    const service = meter()
    const states = (service as unknown as {
      states: WeakMap<Session, { surface: unknown[] }>
    }).states
    expectRepeatedFailure(service, session, /no matching step\/start/)
    const state = states.get(session)
    expect(state?.surface).toEqual([])
  })

  it('clears completed step boundaries and rejects overlapping or late step events', () => {
    /** 中文说明：变量 overlapping 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const overlapping = Session.create(SessionId('overlapping-step'))
    overlapping.append('step/start', { turn: 1, step: 1 })
    overlapping.append('step/start', { turn: 1, step: 2 })
    expectRepeatedFailure(
      meter(),
      overlapping,
      /arrived before turn 1\/step 1 ended/,
    )

    /** 中文说明：变量 late 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const late = Session.create(SessionId('late-assistant'))
    late.append('step/start', { turn: 1, step: 1 })
    appendHeader(late, header('deepseek-v4-flash'))
    late.append('step/end', { turn: 1, step: 1 })
    late.append('assistant/message', {
      stream: [],
      turn: 1,
      step: 1,
      message: createMessage({
        role: 'assistant',
        content: [],
        source: {
          kind: 'model',
          ...{ provider: 'mock', model: 'deepseek-v4-flash' },
        },
      }),
    }, { surfaceOp: 'append' })
    expectRepeatedFailure(
      meter(),
      late,
      /no matching step\/start/,
    )

    /** 中文说明：变量 mismatchedEnd 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mismatchedEnd = Session.create(SessionId('mismatched-end'))
    mismatchedEnd.append('step/start', { turn: 1, step: 1 })
    mismatchedEnd.append('step/end', { turn: 1, step: 2 })
    expectRepeatedFailure(
      meter(),
      mismatchedEnd,
      /step\/end .* no matching step\/start/,
    )
  })

  it('does not partially apply a malformed assistant replacement', () => {
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = Session.create(SessionId('transactional-replace'))
    const head = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'head' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' }).seq
    appendHeader(session, header('deepseek-v4-flash'))
    appendUnchecked(session, {
      type: 'assistant/message',
      seq: SessionSeq(session.seq),
      time: 0,
      data: {
        stream: [],
        turn: 1,
        step: 1,
        message: createMessage({
          role: 'assistant',
          content: [{ type: 'text', text: 'replacement' }],
          source: {
            kind: 'model',
            ...{ provider: 'mock', model: 'deepseek-v4-flash' },
          },
        }),
      },
      surfaceOp: { op: 'replace', start: head, end: head },
      sourceEventSeqs: [head],
    })
    expectRepeatedFailure(
      meter(),
      session,
      /no matching step\/start/,
    )
  })

  it('rejects corrupt replacement ranges without advancing the replay cursor', () => {
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = Session.create(SessionId('bad-replace'))
    /** 中文说明：变量 head 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const head = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'head' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' }).seq
    appendUnchecked(session, {
      type: 'user/message',
      seq: SessionSeq(session.seq),
      time: 0,
      data: createUserMessage({
        content: [{ type: 'text', text: 'bad' }],
        source: { kind: 'user' },
      }),
      surfaceOp: { op: 'replace', start: SessionSeq(99), end: SessionSeq(99) },
      sourceEventSeqs: [head],
    })
    expectRepeatedFailure(meter(), session, /invalid current range/)
  })

  it('handles earlier-reader catch-up, eager observation, and service reload', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    /** 中文说明：变量 activeMeter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let activeMeter: TokenMeter | undefined
    /** 中文说明：变量 revisions 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const revisions: number[] = []
    ctx.on('session/event', (session) => {
      if (activeMeter !== undefined) revisions.push(activeMeter.measure(session).logRevision)
    })
    /** 中文说明：变量 firstFiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const firstFiber = await ctx.plugin(TokenMeter)
    activeMeter = ctx.tokenMeter
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = ctx.sessions.create(SessionId('listener-order'), { seed: [{
      type: 'turn/start',
      seq: SessionSeq(0),
      time: 1,
      data: { turn: 1 },
    }] })
    activeMeter.measure(session)
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'one' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    // Seed, end-seed, then one live append. Only the last event published:
    // end-seed predates store attachment, like the seed.
    expect(revisions).toEqual([3])
    expect(activeMeter.measure(session).logRevision).toBe(3)

    await firstFiber.dispose()
    /** 中文说明：变量 secondFiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const secondFiber = await ctx.plugin(TokenMeter)
    activeMeter = ctx.tokenMeter
    expect(activeMeter.measure(session).logRevision).toBe(3)
    await secondFiber.dispose()
  })
})
