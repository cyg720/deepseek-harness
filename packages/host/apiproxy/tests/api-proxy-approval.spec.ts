/**
 * Approval pending registry over the proxy: an ask through `ctx.approval`
 * becomes an answerable `approval/requested` mux frame (stable rpcId, replayed
 * verbatim on a later mux open), `respond` routes by the echoed rpcId and
 * validates the audit correlation, and the ask's abort signal withdraws the
 * question with a broadcast `cancelled`.
 */
/*
 * 文件职责：验证Host API Proxy的 api-proxy-approval.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis、Fetch/RPC 信封、运行时模式校验、Node/Windows 宿主接口。
 * 产品维度：保证浏览器 API、Hook 或目录操作在各种状态下可靠且可诊断。
 * 逻辑维度：构造请求与宿主服务，调用端点并断言响应和清理。
 * 关键边界：网络与路径输入必须校验；原生对话框和宿主路径操作只允许受信调用。
 * 新手阅读建议：先读请求/响应夹具，再按 API 域、错误码和生命周期场景阅读。
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import type { ApprovalRequestId } from '@deepseek-ai/dsh-user-approval'
import type { ApiProxy, MuxFrame, RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { RpcId as mintRpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { createApiProxy } from '../src/api-proxy.ts'

/** 中文说明：函数 harness 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function harness(): Promise<{ ctx: Context; api: ApiProxy }> {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(ApprovalService)
  /** 中文说明：测试局部值 api，由紧邻初始化决定。 */
  const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })
  return { ctx, api }
}

/** A minimal agent stand-in inside an open turn (the service only reaches `.session`). */
/* 中文说明：函数 agentOf 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function agentOf(ctx: Context): Agent {
  /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
  const session = ctx.sessions.create()
  session.append('turn/start', { turn: 1 })
  return { session } as unknown as Agent
}

/** Open a mux stream and capture frames into an array (returns an on-demand waiter). */
/* 中文说明：函数 openMux 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function openMux(api: ApiProxy, abort: AbortController): { frames: MuxFrame[]; envelopes: RpcRequest<MuxFrame>[]; waitFor(type: MuxFrame['type']): Promise<MuxFrame> } {
  /** 中文说明：测试局部值 frames，由紧邻初始化决定。 */
  const frames: MuxFrame[] = []
  /** 中文说明：测试局部值 envelopes，由紧邻初始化决定。 */
  const envelopes: RpcRequest<MuxFrame>[] = []
  /** 中文说明：测试局部值 waiters，由紧邻初始化决定。 */
  const waiters: { type: MuxFrame['type']; resolve: (frame: MuxFrame) => void }[] = []
  void (async () => {
    /** 中文说明：测试局部值 envelope，由紧邻初始化决定。 */
    for await (const envelope of api.events.mux({ rpcId: mintRpcId('t-mux'), payload: {} }, abort.signal)) {
      frames.push(envelope.payload)
      envelopes.push(envelope)
      /** 中文说明：测试局部值 i，由紧邻初始化决定。 */
      for (let i = waiters.length - 1; i >= 0; i -= 1) {
        /** 中文说明：测试局部值 waiter，由紧邻初始化决定。 */
        const waiter = waiters[i] as (typeof waiters)[number]
        if (waiter.type === envelope.payload.type) {
          waiters.splice(i, 1)
          waiter.resolve(envelope.payload)
        }
      }
    }
  })()
  return {
    frames,
    envelopes,
    waitFor: (type) => {
      /** 中文说明：测试局部值 found，由紧邻初始化决定。 */
      const found = frames.find(frame => frame.type === type)
      if (found !== undefined) return Promise.resolve(found)
      return new Promise((resolve) => { waiters.push({ type, resolve }) })
    },
  }
}

/** 中文说明：函数 requestedOf 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function requestedOf(frame: MuxFrame): Extract<MuxFrame, { type: 'approval/requested' }> {
  if (frame.type !== 'approval/requested') throw new Error(`expected approval/requested, got ${frame.type}`)
  return frame
}

/** Wait until the stream delivered `count` frames of `type` (bounded poll; waitFor only covers the first). */
/* 中文说明：函数 waitForCount 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function waitForCount(mux: { frames: MuxFrame[] }, type: MuxFrame['type'], count: number): Promise<void> {
  /** 中文说明：测试局部值 i，由紧邻初始化决定。 */
  for (let i = 0; i < 200 && mux.frames.filter(frame => frame.type === type).length < count; i += 1) {
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  expect(mux.frames.filter(frame => frame.type === type).length).toBeGreaterThanOrEqual(count)
}

/** 中文说明：函数 answer 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function answer(rpcId: RpcId, sessionId: unknown, approvalId: ApprovalRequestId, outcome: 'allowed-once' | 'rejected'): Parameters<ApiProxy['respond']>[0] {
  return { type: 'client-response', rpcId, result: { ok: true, value: { sessionId, approvalId, outcome } } }
}

describe('approval pending registry', () => {
  it('round-trips ask → requested frame → respond → outcome + resolved broadcast', async () => {
    /** 中文说明：测试局部值 { ctx, api }，由紧邻初始化决定。 */
    const { ctx, api } = await harness()
    /** 中文说明：测试局部值 abort，由紧邻初始化决定。 */
    const abort = new AbortController()
    /** 中文说明：测试局部值 mux，由紧邻初始化决定。 */
    const mux = openMux(api, abort)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
    const agent = agentOf(ctx)

    /** 中文说明：测试局部值 asked，由紧邻初始化决定。 */
    const asked = ctx.approval.request({ agent, toolName: 'bash', reason: 'sandbox escalation' })
    /** 中文说明：测试局部值 requested，由紧邻初始化决定。 */
    const requested = requestedOf(await mux.waitFor('approval/requested'))
    expect(requested).toMatchObject({ toolName: 'bash', reason: 'sandbox escalation', sessionId: agent.session.id })

    /** 中文说明：测试局部值 envelope，由紧邻初始化决定。 */
    const envelope = mux.envelopes.find(e => e.payload.type === 'approval/requested') as RpcRequest<MuxFrame>
    /** 中文说明：测试局部值 receipt，由紧邻初始化决定。 */
    const receipt = await api.respond(answer(envelope.rpcId, requested.sessionId, requested.approvalId, 'allowed-once'))
    expect(receipt).toEqual({ accepted: true })
    await expect(asked).resolves.toBe('allowed-once')

    /** 中文说明：测试局部值 resolved，由紧邻初始化决定。 */
    const resolved = await mux.waitFor('approval/resolved')
    expect(resolved).toMatchObject({ approvalId: requested.approvalId, outcome: 'allowed-once' })

    // The question settled: a duplicate answer is late, not re-decidable.
    /** 中文说明：测试局部值 dup，由紧邻初始化决定。 */
    const dup = await api.respond(answer(envelope.rpcId, requested.sessionId, requested.approvalId, 'rejected'))
    expect(dup).toEqual({ accepted: false, reason: 'not-pending' })
    abort.abort()
  })

  it('replays a still-pending requested frame (same rpcId) on a later mux open', async () => {
    /** 中文说明：测试局部值 { ctx, api }，由紧邻初始化决定。 */
    const { ctx, api } = await harness()
    /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
    const first = new AbortController()
    /** 中文说明：测试局部值 firstMux，由紧邻初始化决定。 */
    const firstMux = openMux(api, first)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
    const agent = agentOf(ctx)
    /** 中文说明：测试局部值 asked，由紧邻初始化决定。 */
    const asked = ctx.approval.request({ agent, toolName: 'write' })
    /** 中文说明：测试局部值 requested，由紧邻初始化决定。 */
    const requested = requestedOf(await firstMux.waitFor('approval/requested'))
    /** 中文说明：测试局部值 firstEnvelope，由紧邻初始化决定。 */
    const firstEnvelope = firstMux.envelopes.find(e => e.payload.type === 'approval/requested') as RpcRequest<MuxFrame>
    first.abort()

    // A fresh subscriber (refresh recovery) sees the same stable rpcId.
    /** 中文说明：测试局部值 second，由紧邻初始化决定。 */
    const second = new AbortController()
    /** 中文说明：测试局部值 secondMux，由紧邻初始化决定。 */
    const secondMux = openMux(api, second)
    /** 中文说明：测试局部值 replayed，由紧邻初始化决定。 */
    const replayed = requestedOf(await secondMux.waitFor('approval/requested'))
    /** 中文说明：测试局部值 secondEnvelope，由紧邻初始化决定。 */
    const secondEnvelope = secondMux.envelopes.find(e => e.payload.type === 'approval/requested') as RpcRequest<MuxFrame>
    expect(secondEnvelope.rpcId).toBe(firstEnvelope.rpcId)
    expect(replayed.approvalId).toBe(requested.approvalId)

    /** 中文说明：测试局部值 receipt，由紧邻初始化决定。 */
    const receipt = await api.respond(answer(secondEnvelope.rpcId, replayed.sessionId, replayed.approvalId, 'rejected'))
    expect(receipt).toEqual({ accepted: true })
    await expect(asked).resolves.toBe('rejected')
    second.abort()
  })

  it('rejects malformed and mismatched answers as bad-response, unknown ids as not-pending', async () => {
    /** 中文说明：测试局部值 { ctx, api }，由紧邻初始化决定。 */
    const { ctx, api } = await harness()
    /** 中文说明：测试局部值 abort，由紧邻初始化决定。 */
    const abort = new AbortController()
    /** 中文说明：测试局部值 mux，由紧邻初始化决定。 */
    const mux = openMux(api, abort)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
    const agent = agentOf(ctx)
    void ctx.approval.request({ agent, toolName: 'bash' })
    /** 中文说明：测试局部值 requested，由紧邻初始化决定。 */
    const requested = requestedOf(await mux.waitFor('approval/requested'))
    /** 中文说明：测试局部值 envelope，由紧邻初始化决定。 */
    const envelope = mux.envelopes.find(e => e.payload.type === 'approval/requested') as RpcRequest<MuxFrame>

    // Unknown rpcId: not routed to any pending entry.
    expect(await api.respond(answer(mintRpcId('ghost'), requested.sessionId, requested.approvalId, 'rejected')))
      .toEqual({ accepted: false, reason: 'not-pending' })
    // Error-branch result: the client can only answer with a value.
    expect(await api.respond({ type: 'client-response', rpcId: envelope.rpcId, result: { ok: false, error: { code: 'internal', message: 'x', details: {} } } }))
      .toEqual({ accepted: false, reason: 'bad-response' })
    // Wrong audit correlation: the rpcId routed, but the payload disagrees.
    expect(await api.respond(answer(envelope.rpcId, requested.sessionId, 'other-approval' as ApprovalRequestId, 'rejected')))
      .toEqual({ accepted: false, reason: 'bad-response' })
    // Malformed payload shape.
    expect(await api.respond({ type: 'client-response', rpcId: envelope.rpcId, result: { ok: true, value: { nonsense: 1 } } }))
      .toEqual({ accepted: false, reason: 'bad-response' })
    abort.abort()
  })

  it('withdraws the question on the ask signal: cancelled outcome, resolved broadcast, late answer not-pending', async () => {
    /** 中文说明：测试局部值 { ctx, api }，由紧邻初始化决定。 */
    const { ctx, api } = await harness()
    /** 中文说明：测试局部值 abort，由紧邻初始化决定。 */
    const abort = new AbortController()
    /** 中文说明：测试局部值 mux，由紧邻初始化决定。 */
    const mux = openMux(api, abort)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
    const agent = agentOf(ctx)
    /** 中文说明：测试局部值 cancel，由紧邻初始化决定。 */
    const cancel = new AbortController()
    /** 中文说明：测试局部值 asked，由紧邻初始化决定。 */
    const asked = ctx.approval.request({ agent, toolName: 'bash', signal: cancel.signal })
    /** 中文说明：测试局部值 requested，由紧邻初始化决定。 */
    const requested = requestedOf(await mux.waitFor('approval/requested'))
    /** 中文说明：测试局部值 envelope，由紧邻初始化决定。 */
    const envelope = mux.envelopes.find(e => e.payload.type === 'approval/requested') as RpcRequest<MuxFrame>

    cancel.abort()
    await expect(asked).resolves.toBe('cancelled')
    /** 中文说明：测试局部值 resolved，由紧邻初始化决定。 */
    const resolved = await mux.waitFor('approval/resolved')
    expect(resolved).toMatchObject({ approvalId: requested.approvalId, outcome: 'cancelled' })
    expect(await api.respond(answer(envelope.rpcId, requested.sessionId, requested.approvalId, 'allowed-once')))
      .toEqual({ accepted: false, reason: 'not-pending' })
    abort.abort()
  })

  it('an ask whose signal aborted before dispatch settles cancelled without publishing', async () => {
    // The service checks the signal, then dispatch rides a microtask: an
    // abort in that window must not register a dead listener and strand the
    // entry (zombie frame on every replay). Drive the waterfall directly
    // with a pre-aborted signal to hit the answerer's register-path guard.
    /** 中文说明：测试局部值 { ctx, api }，由紧邻初始化决定。 */
    const { ctx, api } = await harness()
    /** 中文说明：测试局部值 abort，由紧邻初始化决定。 */
    const abort = new AbortController()
    /** 中文说明：测试局部值 mux，由紧邻初始化决定。 */
    const mux = openMux(api, abort)
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = ctx.sessions.create()
    session.append('turn/start', { turn: 1 })
    session.append('approval/asked', { id: 'pre-aborted' as ApprovalRequestId, toolName: 'bash' })
    /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
    const agent = { session } as unknown as Agent
    /** 中文说明：测试局部值 cancelled，由紧邻初始化决定。 */
    const cancelled = new AbortController()
    cancelled.abort()
    /** 中文说明：测试局部值 outcome，由紧邻初始化决定。 */
    const outcome = await ctx.waterfall(
      'approval/request',
      { agent, toolName: 'bash', signal: cancelled.signal },
      () => Promise.resolve('unavailable' as const),
    )
    expect(outcome).toBe('cancelled')
    // Nothing was published: a fresh mux open replays no approval frame.
    /** 中文说明：测试局部值 abort2，由紧邻初始化决定。 */
    const abort2 = new AbortController()
    /** 中文说明：测试局部值 mux2，由紧邻初始化决定。 */
    const mux2 = openMux(api, abort2)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(mux2.envelopes.some(e => e.payload.type === 'approval/requested')).toBe(false)
    abort2.abort()
    abort.abort()
    void mux
  })

  it('gateway teardown settles pending approvals as cancelled (question-provider parity)', async () => {
    // Mount the proxy on its own fiber so disposal exercises the teardown
    // effect while an ask is still pending.
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt, { persona: '' })
    await ctx.plugin(UserQuestionService)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(ApprovalService)
    /** 中文说明：测试局部值 api!: ApiProxy，由紧邻初始化决定。 */
    let api!: ApiProxy
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = ctx.plugin(Object.assign((fiberCtx: Context) => {
      api = createApiProxy(fiberCtx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })
    }, { inject: ['sessions', 'agents', 'userQuestions', 'approval'] }))
    await fiber.await()
    /** 中文说明：测试局部值 abort，由紧邻初始化决定。 */
    const abort = new AbortController()
    /** 中文说明：测试局部值 mux，由紧邻初始化决定。 */
    const mux = openMux(api, abort)
    /** 中文说明：测试局部值 asked，由紧邻初始化决定。 */
    const asked = ctx.approval.request({ agent: agentOf(ctx), toolName: 'bash' })
    /** 中文说明：测试局部值 requested，由紧邻初始化决定。 */
    const requested = requestedOf(await mux.waitFor('approval/requested'))
    await fiber.dispose()
    await expect(asked).resolves.toBe('cancelled')
    /** 中文说明：测试局部值 resolved，由紧邻初始化决定。 */
    const resolved = await mux.waitFor('approval/resolved')
    expect(resolved).toMatchObject({ approvalId: requested.approvalId, outcome: 'cancelled' })
    abort.abort()
  })

  it('carries callId on the frame and ignores a late abort after the answer settled', async () => {
    /** 中文说明：测试局部值 { ctx, api }，由紧邻初始化决定。 */
    const { ctx, api } = await harness()
    /** 中文说明：测试局部值 abort，由紧邻初始化决定。 */
    const abort = new AbortController()
    /** 中文说明：测试局部值 mux，由紧邻初始化决定。 */
    const mux = openMux(api, abort)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
    const agent = agentOf(ctx)
    /** 中文说明：测试局部值 cancel，由紧邻初始化决定。 */
    const cancel = new AbortController()
    /** 中文说明：测试局部值 asked，由紧邻初始化决定。 */
    const asked = ctx.approval.request({ agent, toolName: 'bash', callId: 'call-9' as never, signal: cancel.signal })
    /** 中文说明：测试局部值 requested，由紧邻初始化决定。 */
    const requested = requestedOf(await mux.waitFor('approval/requested'))
    expect(requested.callId).toBe('call-9')
    /** 中文说明：测试局部值 envelope，由紧邻初始化决定。 */
    const envelope = mux.envelopes.find(e => e.payload.type === 'approval/requested') as RpcRequest<MuxFrame>
    expect(await api.respond(answer(envelope.rpcId, requested.sessionId, requested.approvalId, 'allowed-once')))
      .toEqual({ accepted: true })
    await expect(asked).resolves.toBe('allowed-once')
    // Late abort: the pending entry is gone; settle's delete-guard returns.
    cancel.abort()
    expect(mux.frames.filter(f => f.type === 'approval/resolved')).toHaveLength(1)
    abort.abort()
  })

  it('pairs parallel asks by callId: each requested frame carries its own audit id', async () => {
    /** 中文说明：测试局部值 { ctx, api }，由紧邻初始化决定。 */
    const { ctx, api } = await harness()
    /** 中文说明：测试局部值 abort，由紧邻初始化决定。 */
    const abort = new AbortController()
    /** 中文说明：测试局部值 mux，由紧邻初始化决定。 */
    const mux = openMux(api, abort)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
    const agent = agentOf(ctx)
    // Both asks append their approval/asked audit events before either
    // answerer's microtask dispatch runs — the parallel tool-call window.
    /** 中文说明：测试局部值 askA，由紧邻初始化决定。 */
    const askA = ctx.approval.request({ agent, toolName: 'bash', callId: 'call-a' as never })
    /** 中文说明：测试局部值 askB，由紧邻初始化决定。 */
    const askB = ctx.approval.request({ agent, toolName: 'bash', callId: 'call-b' as never })
    await waitForCount(mux, 'approval/requested', 2)
    /** 中文说明：测试局部值 frames，由紧邻初始化决定。 */
    const frames = mux.envelopes.filter(e => e.payload.type === 'approval/requested')
    /** 中文说明：测试局部值 frameA，由紧邻初始化决定。 */
    const frameA = frames.find(e => requestedOf(e.payload).callId === 'call-a') as RpcRequest<MuxFrame>
    /** 中文说明：测试局部值 frameB，由紧邻初始化决定。 */
    const frameB = frames.find(e => requestedOf(e.payload).callId === 'call-b') as RpcRequest<MuxFrame>
    // Each frame claimed the asked event with its own callId, not merely the newest.
    /** 中文说明：测试局部值 askedIdByCall，由紧邻初始化决定。 */
    const askedIdByCall = new Map(agent.session.events
      .filter(event => event.type === 'approval/asked')
      .map(event => [String(event.data.callId), event.data.id]))
    expect(requestedOf(frameA.payload).approvalId).toBe(askedIdByCall.get('call-a'))
    expect(requestedOf(frameB.payload).approvalId).toBe(askedIdByCall.get('call-b'))
    // Answers route back to the right ask through the pairing.
    expect(await api.respond(answer(frameB.rpcId, agent.session.id, requestedOf(frameB.payload).approvalId, 'rejected')))
      .toEqual({ accepted: true })
    expect(await api.respond(answer(frameA.rpcId, agent.session.id, requestedOf(frameA.payload).approvalId, 'allowed-once')))
      .toEqual({ accepted: true })
    await expect(askA).resolves.toBe('allowed-once')
    await expect(askB).resolves.toBe('rejected')
    abort.abort()
  })

  it('gives parallel callId-less asks distinct audit ids (claimed-entry skip); both stay answerable', async () => {
    /** 中文说明：测试局部值 { ctx, api }，由紧邻初始化决定。 */
    const { ctx, api } = await harness()
    /** 中文说明：测试局部值 abort，由紧邻初始化决定。 */
    const abort = new AbortController()
    /** 中文说明：测试局部值 mux，由紧邻初始化决定。 */
    const mux = openMux(api, abort)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
    const agent = agentOf(ctx)
    /** 中文说明：测试局部值 askA，由紧邻初始化决定。 */
    const askA = ctx.approval.request({ agent, toolName: 'alpha' })
    /** 中文说明：测试局部值 askB，由紧邻初始化决定。 */
    const askB = ctx.approval.request({ agent, toolName: 'beta' })
    await waitForCount(mux, 'approval/requested', 2)
    /** 中文说明：测试局部值 frames，由紧邻初始化决定。 */
    const frames = mux.envelopes.filter(e => e.payload.type === 'approval/requested')
    /** 中文说明：测试局部值 frameA，由紧邻初始化决定。 */
    const frameA = frames.find(e => requestedOf(e.payload).toolName === 'alpha') as RpcRequest<MuxFrame>
    /** 中文说明：测试局部值 frameB，由紧邻初始化决定。 */
    const frameB = frames.find(e => requestedOf(e.payload).toolName === 'beta') as RpcRequest<MuxFrame>
    // Without a callId the pairing is heuristic, but never shared: the second
    // dispatch skips the id the first pending entry already claimed.
    expect(requestedOf(frameA.payload).approvalId).not.toBe(requestedOf(frameB.payload).approvalId)
    expect(await api.respond(answer(frameA.rpcId, agent.session.id, requestedOf(frameA.payload).approvalId, 'allowed-once')))
      .toEqual({ accepted: true })
    expect(await api.respond(answer(frameB.rpcId, agent.session.id, requestedOf(frameB.payload).approvalId, 'rejected')))
      .toEqual({ accepted: true })
    await expect(askA).resolves.toBe('allowed-once')
    await expect(askB).resolves.toBe('rejected')
    abort.abort()
  })

  it('delegates a dispatch whose only asked candidate is already decided (stale re-dispatch)', async () => {
    /** 中文说明：测试局部值 { ctx, api }，由紧邻初始化决定。 */
    const { ctx, api } = await harness()
    void api // the answerer is registered; the fake below bypasses the service
    // Bypass ApprovalService: a log whose sole asked event already has its
    // decided partner must not be re-claimed — the answerer delegates.
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = ctx.sessions.create()
    session.append('turn/start', { turn: 1 })
    session.append('approval/asked', { id: 'stale-ask' as ApprovalRequestId, toolName: 'bash' })
    session.append('approval/decided', { id: 'stale-ask' as ApprovalRequestId, outcome: 'rejected' })
    /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
    const agent = { session } as unknown as Agent
    /** 中文说明：测试局部值 outcome，由紧邻初始化决定。 */
    const outcome = await ctx.waterfall('approval/request', { agent, toolName: 'bash' }, () => Promise.resolve('unavailable' as const))
    expect(outcome).toBe('unavailable')
  })

  it('delegates an ask whose session log carries no asked audit event (foreign channel)', async () => {
    /** 中文说明：测试局部值 { ctx, api }，由紧邻初始化决定。 */
    const { ctx, api } = await harness()
    void api // the answerer is registered; the fake below bypasses the audit path
    // Bypass ApprovalService: dispatch the waterfall directly with a session
    // that has no approval/asked event — the proxy answerer must call next().
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = ctx.sessions.create()
    session.append('turn/start', { turn: 1 })
    /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
    const agent = { session } as unknown as Agent
    /** 中文说明：测试局部值 outcome，由紧邻初始化决定。 */
    const outcome = await ctx.waterfall('approval/request', { agent, toolName: 'x' }, () => Promise.resolve('unavailable' as const))
    expect(outcome).toBe('unavailable')
  })
})
