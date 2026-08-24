/**
 * 文件职责：验证多个 ACP 会话并发运行时的输出分流、取消隔离和会话状态独立性。
 * 技术维度：使用 Vitest、并发 Promise 和带会话标识的协议更新记录执行集成测试。
 * 产品维度：确保一个自动化任务的输出或取消不会污染同一连接上的另一个任务。
 * 逻辑维度：按会话筛选文本更新，再并发提示两个会话并分别验证结果和取消影响。
 * 关键边界：输出归属以协议 sessionId 为准；测试等待异步通知完成后再断言文本。
 * 新手阅读建议：先理解 messageTextFor 的筛选条件，再对照两个会话标识跟踪并发用例。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import { SessionId } from '@deepseek-ai/dsh-session'
import { makeBridgeHarness, textResponse, type BridgeHarness, type CapturedUpdate } from './harness.ts'

/**
 * 汇总指定会话收到的助手文本更新。
 * @param updates 所有会话的带标识更新记录。
 * @param sessionId 要筛选的会话标识。
 * @returns 按通知顺序拼接的文本。
 * @example messageTextFor(harness.sessionUpdates, sessionId)
 */
function messageTextFor(
  updates: { sessionId: string; update: CapturedUpdate }[],
  sessionId: string,
): string {
  return updates.flatMap(({ sessionId: owner, update }) => (
    owner === sessionId && update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text'
      ? [update.content.text]
      : []
  )).join('')
}

describe('ACP multi-session isolation', () => {
  // 当前用例共享的桥接装配，结束后统一清理。
  let harness: BridgeHarness | undefined

  afterEach(async () => {
    await harness?.dispose()
    harness = undefined
  })

  it('demultiplexes concurrent answers by session id', async () => {
    harness = await makeBridgeHarness({ script: [textResponse('answer-A'), textResponse('answer-B')] })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const a = (await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })).sessionId
    const b = (await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })).sessionId

    const [resultA, resultB] = await Promise.all([
      harness.client.prompt({ sessionId: a, prompt: [{ type: 'text', text: 'go A' }] }),
      harness.client.prompt({ sessionId: b, prompt: [{ type: 'text', text: 'go B' }] }),
    ])
    expect(resultA.stopReason).toBe('end_turn')
    expect(resultB.stopReason).toBe('end_turn')
    await vi.waitFor(() => {
      expect(messageTextFor(harness!.sessionUpdates, a)).toBe('answer-A')
      expect(messageTextFor(harness!.sessionUpdates, b)).toBe('answer-B')
    })
  })

  it('cancels one session without affecting another', async () => {
    harness = await makeBridgeHarness({ script: ['hang', textResponse('B done')] })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const a = (await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })).sessionId
    const b = (await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })).sessionId

    const pendingA = harness.client.prompt({ sessionId: a, prompt: [{ type: 'text', text: 'hang A' }] })
    await vi.waitFor(() => { expect(harness!.ctx.agents.get(SessionId(a))?.status).toBe('running') })
    await harness.client.cancel({ sessionId: a })
    await expect(pendingA).resolves.toEqual({ stopReason: 'cancelled' })
    await expect(harness.client.prompt({ sessionId: b, prompt: [{ type: 'text', text: 'go B' }] }))
      .resolves.toEqual({ stopReason: 'end_turn' })
    await vi.waitFor(() => { expect(messageTextFor(harness!.sessionUpdates, b)).toBe('B done') })
  })

  it('enforces one in-flight prompt independently for each session', async () => {
    harness = await makeBridgeHarness({ script: ['hang', 'hang'] })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const a = (await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })).sessionId
    const b = (await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })).sessionId
    const pendingA = harness.client.prompt({ sessionId: a, prompt: [{ type: 'text', text: 'A' }] })
    const pendingB = harness.client.prompt({ sessionId: b, prompt: [{ type: 'text', text: 'B' }] })
    await vi.waitFor(() => {
      expect(harness!.ctx.agents.get(SessionId(a))?.status).toBe('running')
      expect(harness!.ctx.agents.get(SessionId(b))?.status).toBe('running')
    })

    await expect(harness.client.prompt({ sessionId: a, prompt: [{ type: 'text', text: 'again' }] }))
      .rejects.toThrow(/already in flight/)
    await Promise.all([harness.client.cancel({ sessionId: a }), harness.client.cancel({ sessionId: b })])
    await expect(pendingA).resolves.toEqual({ stopReason: 'cancelled' })
    await expect(pendingB).resolves.toEqual({ stopReason: 'cancelled' })
  })

  it('drains every live session on bridge disposal', async () => {
    harness = await makeBridgeHarness({ script: ['hang', 'hang'] })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const a = (await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })).sessionId
    const b = (await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })).sessionId
    const agentA = harness.ctx.agents.get(SessionId(a))!
    const agentB = harness.ctx.agents.get(SessionId(b))!
    void harness.client.prompt({ sessionId: a, prompt: [{ type: 'text', text: 'A' }] }).catch(() => {})
    void harness.client.prompt({ sessionId: b, prompt: [{ type: 'text', text: 'B' }] }).catch(() => {})
    await vi.waitFor(() => {
      expect(agentA.status).toBe('running')
      expect(agentB.status).toBe('running')
    })

    await harness.acpFiber.dispose()
    expect(harness.ctx.agents.get(SessionId(a))).toBeUndefined()
    expect(harness.ctx.agents.get(SessionId(b))).toBeUndefined()
  })
})
