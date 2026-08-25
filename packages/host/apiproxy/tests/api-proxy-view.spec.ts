/**
 * Tool-card view computation over the mux live path: three standard card types
 * arrive on the frame, a presenterless tool ships no view field, a call-only
 * presenter keeps raw result content out of the view payload, and a throwing
 * presenter soft-falls to no view (the event still ships). Result pairing
 * works both through the live open-call table and the backscan fallback after
 * turn/end cleared it.
 */
/*
 * 文件职责：验证Host API Proxy的 api-proxy-view.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis、Fetch/RPC 信封、运行时模式校验、Node/Windows 宿主接口。
 * 产品维度：保证浏览器 API、Hook 或目录操作在各种状态下可靠且可诊断。
 * 逻辑维度：构造请求与宿主服务，调用端点并断言响应和清理。
 * 关键边界：网络与路径输入必须校验；原生对话框和宿主路径操作只允许受信调用。
 * 新手阅读建议：先读请求/响应夹具，再按 API 域、错误码和生命周期场景阅读。
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { CallId, createMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import type { MuxFrame, RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { createApiProxy } from '@deepseek-ai/dsh-host-apiproxy'

/** 中文说明：测试局部值 reply，由紧邻初始化决定。 */
const reply = (text: string): Promise<ContentBlock[]> => Promise.resolve([{ type: 'text', text }])

/** 中文说明：函数 tool 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function tool(name: string, presenters: Pick<ToolDefinition, 'presentCall' | 'presentResult'>): ToolDefinition {
  return defineContentToolFixture({
    name,
    description: `tool ${name}`,
    parameters: {},
    execute: () => reply(`ran:${name}`),
    ...presenters,
  })
}

/** Append a production-shaped human prompt to the session surface. */
/* 中文说明：函数 appendUserText 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function appendUserText(session: Session, text: string): SessionEvent {
  return session.append('user/message', createUserMessage({
    content: [{ type: 'text', text }], source: { kind: 'user' },
  }), { surfaceOp: 'append' })
}

/** Append a production-shaped assistant message to the session surface. */
/* 中文说明：函数 appendAssistantText 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function appendAssistantText(session: Session, text: string, step: number): SessionEvent {
  return session.append('assistant/message', {
    turn: 1,
    step,
    message: createMessage({
      role: 'assistant',
      content: [{ type: 'text', text }],
      source: { kind: 'model', provider: 'p', model: 'm' },
    }),
  }, { surfaceOp: 'append' })
}

/**
 * Append a plugin-owned log-only event. The host proxy is projection-only, so it
 * declares no compaction vocabulary; the cast writes the real event shape without
 * depending on the owning package.
 */
/* 中文说明：函数 appendExtension 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function appendExtension(session: Session, type: string, data: unknown): SessionEvent {
  return (session.append as unknown as (type: string, data: unknown) => SessionEvent)(type, data)
}

/** 中文说明：函数 harness 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function harness(): Promise<{ ctx: Context }> {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(AgentRegistry)
  ctx.tools.register(tool('gen', {
    presentCall: () => ({ card: 'generic', title: 'gen call' }),
    presentResult: (_args, result) => ({ card: 'generic', title: result.isError ? 'gen failed' : 'gen done' }),
  }))
  ctx.tools.register(tool('term', {
    presentCall: args => ({ card: 'terminal', title: (args as { cmd?: string }).cmd ?? '' }),
    presentResult: () => ({ card: 'terminal', output: 'done' }),
  }))
  ctx.tools.register(tool('diffy', {
    presentCall: () => ({ card: 'diff', title: 'Write f.txt', diffs: [{ path: 'f.txt', oldText: null, newText: 'x' }] }),
  }))
  ctx.tools.register(tool('call-only', {
    presentCall: () => ({ card: 'generic', title: 'program', kind: 'execute', rawInput: 'return value' }),
  }))
  ctx.tools.register(tool('plain', {}))
  ctx.tools.register(tool('boom', {
    presentCall: () => { throw new Error('presenter exploded') },
  }))
  return { ctx }
}

/** Drain frames from an open mux stream until `count` session/event frames arrived. */
/* 中文说明：函数 collect 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function collect(iterable: AsyncIterable<RpcRequest<MuxFrame>>, count: number, abort: AbortController): Promise<MuxFrame[]> {
  /** 中文说明：测试局部值 frames，由紧邻初始化决定。 */
  const frames: MuxFrame[] = []
  /** 中文说明：测试局部值 frame，由紧邻初始化决定。 */
  for await (const frame of iterable) {
    frames.push(frame.payload)
    if (frames.filter(f => f.type === 'session/event').length >= count) abort.abort()
  }
  return frames
}

describe('mux live view computation', () => {
  it('attaches the three standard card views, omits view without a presenter, soft-falls on throw', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await harness()
    /** 中文说明：测试局部值 api，由紧邻初始化决定。 */
    const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })
    /** 中文说明：测试局部值 abort，由紧邻初始化决定。 */
    const abort = new AbortController()
    /** 中文说明：测试局部值 stream，由紧邻初始化决定。 */
    const stream = api.events.mux({ rpcId: RpcId('t-mux'), payload: {} }, abort.signal)
    /** 中文说明：测试局部值 collected，由紧邻初始化决定。 */
    const collected = collect(stream, 9, abort)
    /** 中文说明：测试局部值 rawResult，由紧邻初始化决定。 */
    const rawResult = `RAW_RESULT:${'x'.repeat(64 * 1024)}`

    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = ctx.sessions.create()
    session.append('turn/start', { turn: 1 })
    session.append('tool/call', { turn: 1, step: 1, callId: CallId('c-gen'), name: 'gen', arguments: '{}' })
    session.append('tool/call', { turn: 1, step: 1, callId: CallId('c-term'), name: 'term', arguments: '{"cmd":"echo hi"}' })
    session.append('tool/call', { turn: 1, step: 1, callId: CallId('c-diff'), name: 'diffy', arguments: '{}' })
    session.append('tool/call', { turn: 1, step: 1, callId: CallId('c-call-only'), name: 'call-only', arguments: '{}' })
    session.append('tool/result', {
      turn: 1, step: 1,
      message: createToolResultMessage({
        callId: CallId('c-call-only'),
        content: [{ type: 'text', text: rawResult }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })
    session.append('tool/call', { turn: 1, step: 1, callId: CallId('c-plain'), name: 'plain', arguments: '{}' })
    session.append('tool/call', { turn: 1, step: 1, callId: CallId('c-boom'), name: 'boom', arguments: '{}' })
    session.append('tool/result', {
      turn: 1, step: 1,
      message: createToolResultMessage({
        callId: CallId('c-gen'),
        content: [{ type: 'text', text: 'ok' }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })

    /** 中文说明：测试局部值 frames，由紧邻初始化决定。 */
    const frames = await collected
    /** 中文说明：测试局部值 events，由紧邻初始化决定。 */
    const events = frames.filter(f => f.type === 'session/event')
    /** 中文说明：测试局部值 byCall，由紧邻初始化决定。 */
    const byCall = new Map(events
      .filter(f => f.event.type === 'tool/call' || f.event.type === 'tool/result')
      .map(f => [
        `${f.event.type}:${f.event.type === 'tool/call'
          ? f.event.data.callId
          : (f.event.data as SessionEvent<'tool/result'>['data']).message.source.callId}`,
        f,
      ]))

    expect(byCall.get('tool/call:c-gen')?.view).toEqual({ for: 'call', view: { card: 'generic', title: 'gen call' } })
    expect(byCall.get('tool/call:c-term')?.view).toEqual({ for: 'call', view: { card: 'terminal', title: 'echo hi' } })
    expect(byCall.get('tool/call:c-diff')?.view?.view.card).toBe('diff')
    expect(byCall.get('tool/call:c-call-only')?.view).toEqual({
      for: 'call',
      view: { card: 'generic', title: 'program', kind: 'execute', rawInput: 'return value' },
    })
    /** 中文说明：测试局部值 callOnlyResult，由紧邻初始化决定。 */
    const callOnlyResult = byCall.get('tool/result:c-call-only')
    expect('view' in (callOnlyResult ?? {})).toBe(false)
    /** 中文说明：测试局部值 serializedResult，由紧邻初始化决定。 */
    const serializedResult = JSON.stringify(callOnlyResult)
    expect(serializedResult.indexOf(rawResult)).toBeGreaterThanOrEqual(0)
    expect(serializedResult.indexOf(rawResult)).toBe(serializedResult.lastIndexOf(rawResult))
    // No presenter → the frame carries no view property at all.
    expect('view' in (byCall.get('tool/call:c-plain') ?? {})).toBe(false)
    // Throwing presenter → soft-fall: event ships, no view.
    expect(byCall.get('tool/call:c-boom')).toBeDefined()
    expect('view' in (byCall.get('tool/call:c-boom') ?? {})).toBe(false)
    // Result pairing through the live table: presentResult saw the call's args.
    expect(byCall.get('tool/result:c-gen')?.view).toEqual({ for: 'result', view: { card: 'generic', title: 'gen done' } })
  })

  it('serves history entries with call/result views, backscan pairing, and soft-falls', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await harness()
    /** 中文说明：测试局部值 api，由紧邻初始化决定。 */
    const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = ctx.sessions.create()
    // history resolves the agent first; a live structural stub is enough (only
    // .session is read on this path).
    ctx.agents.register({ id: session.id, session, status: 'idle', ctx } as Agent)
    session.append('turn/start', { turn: 1 })
    session.append('tool/call', { turn: 1, step: 1, callId: CallId('h-term'), name: 'term', arguments: '{"cmd":"ls"}' })
    // meta rides through to presentResult's ToolResult (the spread arm).
    session.append('tool/result', {
      turn: 1, step: 1,
      message: createToolResultMessage({
        callId: CallId('h-term'),
        content: [{ type: 'text', text: 'ok' }],
        isError: false,
      }),
      meta: { n: 1 },
    }, { surfaceOp: 'append' })
    // Unpaired result: no tool/call with this id anywhere in the page.
    session.append('tool/result', {
      turn: 1, step: 1,
      message: createToolResultMessage({
        callId: CallId('h-orphan'),
        content: [{ type: 'text', text: 'x' }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })
    // Paired, but the call's stored arguments do not parse: backscan soft-falls.
    session.append('tool/call', { turn: 1, step: 1, callId: CallId('h-bad'), name: 'term', arguments: '{broken' })
    session.append('tool/result', {
      turn: 1, step: 1,
      message: createToolResultMessage({
        callId: CallId('h-bad'),
        content: [{ type: 'text', text: 'y' }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })
    // Presenterless tool: pairing succeeds but presentResult is absent.
    session.append('tool/call', { turn: 1, step: 1, callId: CallId('h-plain'), name: 'plain', arguments: '{}' })
    session.append('tool/result', {
      turn: 1, step: 1,
      message: createToolResultMessage({
        callId: CallId('h-plain'),
        content: [{ type: 'text', text: 'z' }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })

    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await api.sessions.history({ rpcId: RpcId('t-hist'), payload: { sessionId: session.id } })
    expect(response.result.ok).toBe(true)
    if (!response.result.ok) throw new Error('unreachable')
    /** 中文说明：测试局部值 entries，由紧邻初始化决定。 */
    const entries = response.result.value.events
    /** 中文说明：测试局部值 byKey，由紧邻初始化决定。 */
    const byKey = new Map(entries
      .filter(entry => entry.event.type === 'tool/call' || entry.event.type === 'tool/result')
      .map(entry => [
        `${entry.event.type}:${entry.event.type === 'tool/call'
          ? entry.event.data.callId
          : (entry.event.data as SessionEvent<'tool/result'>['data']).message.source.callId}`,
        entry,
      ]))
    expect(byKey.get('tool/call:h-term')?.view).toEqual({ for: 'call', view: { card: 'terminal', title: 'ls' } })
    expect(byKey.get('tool/result:h-term')?.view).toEqual({ for: 'result', view: { card: 'terminal', output: 'done' } })
    expect('view' in (byKey.get('tool/result:h-orphan') ?? {})).toBe(false)
    expect('view' in (byKey.get('tool/result:h-bad') ?? {})).toBe(false)
    expect('view' in (byKey.get('tool/result:h-plain') ?? {})).toBe(false)
  })

  it('counts only append-origin messages toward maxMessages and keeps each compaction summary with its replacement', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await harness()
    /** 中文说明：测试局部值 api，由紧邻初始化决定。 */
    const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = ctx.sessions.create()
    ctx.agents.register({ id: session.id, session, status: 'idle', ctx } as Agent)
    session.append('turn/start', { turn: 1 })
    /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
    const first = appendUserText(session, 'first prompt')
    appendAssistantText(session, 'first reply', 1)
    /** 中文说明：测试局部值 third，由紧邻初始化决定。 */
    const third = appendUserText(session, 'second prompt')
    appendAssistantText(session, 'second reply', 2)
    /** 中文说明：测试局部值 shadowed，由紧邻初始化决定。 */
    const shadowed = [...session.surface.nodes]
    // A compaction transaction: a log-only summary record immediately followed by the
    // replacement that shadows the range.
    /** 中文说明：测试局部值 summary，由紧邻初始化决定。 */
    const summary = appendExtension(session, 'compaction/summary', {
      summary: [{ type: 'text', text: 'summary' }],
      shadowedRange: { start: shadowed[0], end: shadowed.at(-1) },
      shadowedSeqs: shadowed,
      shadowedTokenCount: 0,
      provider: 'p',
      model: 'm',
    })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '<context_checkpoint>summary</context_checkpoint>' }],
      source: { kind: 'plugin', plugin: 'compact' },
    }), {
      surfaceOp: { op: 'replace', start: shadowed[0] as number, end: shadowed.at(-1) as number },
      sourceEventSeqs: [...shadowed, summary.seq],
    })

    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await api.sessions.history({
      rpcId: RpcId('t-hist-compact'),
      payload: { sessionId: session.id, maxMessages: 2 },
    })
    if (!response.result.ok) throw new Error('unreachable')
    /** 中文说明：测试局部值 page，由紧邻初始化决定。 */
    const page = response.result.value.events.map(entry => entry.event)
    // Two append-origin messages fill the page even though a replacement copy of
    // the same event type sits in the window: the copy is model-only.
    /** 中文说明：测试局部值 messages，由紧邻初始化决定。 */
    const messages = page.filter(event => event.type === 'user/message' || event.type === 'assistant/message')
    expect(messages.map(event => event.seq)).toEqual([third.seq, third.seq + 1, third.seq + 3])
    expect(page.some(event => event.seq === first.seq)).toBe(false)
    expect(response.result.value.hasMore).toBe(true)
    // The range stays contiguous, so the checkpoint's summary record is readable on
    // the same page as the checkpoint itself.
    /** 中文说明：测试局部值 summaryIndex，由紧邻初始化决定。 */
    const summaryIndex = page.findIndex(event => event.seq === summary.seq)
    expect(summaryIndex).toBeGreaterThan(-1)
    expect(page[summaryIndex + 1]?.seq).toBe(summary.seq + 1)
    expect(page.map(event => event.seq)).toEqual(page.map((_event, index) => third.seq + index))
  })

  it('paginates a message with many provenance sources without variadic argument expansion', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await harness()
    /** 中文说明：测试局部值 api，由紧邻初始化决定。 */
    const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = ctx.sessions.create()
    ctx.agents.register({ id: session.id, session, status: 'idle', ctx } as Agent)
    session.append('turn/start', { turn: 1 })
    /** 中文说明：测试局部值 sources，由紧邻初始化决定。 */
    const sources = Array.from({ length: 128 }, (_unused, index) => session.append('assistant/chunk', {
      turn: 1,
      step: 1,
      chunk: { type: 'text-delta', index, text: 'x' },
    }).seq)
    /** 中文说明：测试局部值 message，由紧邻初始化决定。 */
    const message = session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'x'.repeat(sources.length) }],
        source: { kind: 'model', provider: 'p', model: 'm' },
      }),
    }, { surfaceOp: 'append', sourceEventSeqs: sources })

    /** 中文说明：测试局部值 scalarMin，由紧邻初始化决定。 */
    const scalarMin = Math.min
    /** 中文说明：测试局部值 min，由紧邻初始化决定。 */
    const min = vi.spyOn(Math, 'min').mockImplementation((...values) => {
      if (values.length > 2) throw new RangeError('variadic minimum rejected by regression harness')
      return scalarMin(...values)
    })
    try {
      /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
      const response = await api.sessions.history({
        rpcId: RpcId('t-hist-large-provenance'),
        payload: { sessionId: session.id, maxMessages: 1 },
      })
      if (!response.result.ok) throw new Error('unreachable')
      expect(response.result.value.events.map(entry => entry.event.seq)).toEqual([...sources, message.seq])
      expect(response.result.value.hasMore).toBe(true)
    } finally {
      min.mockRestore()
    }
  })

  it('drops a disposed session from the live open-call table (result after dispose gets no view)', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await harness()
    /** 中文说明：测试局部值 api，由紧邻初始化决定。 */
    const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })
    /** 中文说明：测试局部值 abort，由紧邻初始化决定。 */
    const abort = new AbortController()
    /** 中文说明：测试局部值 stream，由紧邻初始化决定。 */
    const stream = api.events.mux({ rpcId: RpcId('t-mux3'), payload: {} }, abort.signal)

    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    let session: Session | undefined
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = await ctx.plugin(Object.assign((inner: Context) => {
      session = inner.sessions.create('session-doomed' as SessionId)
    }, { inject: ['sessions'] }))
    session?.append('turn/start', { turn: 1 })
    session?.append('tool/call', { turn: 1, step: 1, callId: CallId('c-doomed'), name: 'term', arguments: '{"cmd":"x"}' })
    // Disposing the owning fiber detaches the session mid-stream; the
    // session/disposed listener must clear its open-call table entry.
    await fiber.dispose()

    /** 中文说明：测试局部值 frames，由紧邻初始化决定。 */
    const frames = await collect(stream, 2, abort)
    /** 中文说明：测试局部值 call，由紧邻初始化决定。 */
    const call = frames.find(f => f.type === 'session/event' && f.event.type === 'tool/call')
    expect(call?.type === 'session/event' && call.view?.for).toBe('call')
  })

  it('pairs a result after turn/end via the in-memory backscan fallback', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await harness()
    /** 中文说明：测试局部值 api，由紧邻初始化决定。 */
    const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })
    /** 中文说明：测试局部值 abort，由紧邻初始化决定。 */
    const abort = new AbortController()
    /** 中文说明：测试局部值 stream，由紧邻初始化决定。 */
    const stream = api.events.mux({ rpcId: RpcId('t-mux2'), payload: {} }, abort.signal)
    /** 中文说明：测试局部值 collected，由紧邻初始化决定。 */
    const collected = collect(stream, 4, abort)

    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = ctx.sessions.create()
    session.append('turn/start', { turn: 1 })
    session.append('tool/call', { turn: 1, step: 1, callId: CallId('c-late'), name: 'term', arguments: '{"cmd":"tail"}' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    // The turn/end above cleared the live table; pairing must fall back to
    // scanning the session's in-memory events.
    session.append('tool/result', {
      turn: 1, step: 1,
      message: createToolResultMessage({
        callId: CallId('c-late'),
        content: [{ type: 'text', text: 'ok' }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })

    /** 中文说明：测试局部值 frames，由紧邻初始化决定。 */
    const frames = await collected
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = frames.find(f => f.type === 'session/event' && f.event.type === 'tool/result')
    expect(result?.type === 'session/event' && result.view).toEqual({ for: 'result', view: { card: 'terminal', output: 'done' } })
  })
})
