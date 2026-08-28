/**
 * 文件职责：验证 ACP 桥接层把 Harness 权限请求映射为机器客户端的一次性选择。
 * 技术维度：使用 Vitest、真实 Cordis 审批服务和内存 ACP 测试装配执行协议级测试。
 * 产品维度：保证自动化客户端只能明确允许一次或拒绝一次，异常和未知选择不会意外放行工具。
 * 逻辑维度：为桥接层拥有的代理构造审批请求，再覆盖允许、拒绝、取消、客户端异常和非拥有代理场景。
 * 关键边界：请求必须带调用标识并来自桥接层精确拥有的代理；未知回复按拒绝处理。
 * 新手阅读建议：先看 ownedRequest 如何建立真实会话，再按各用例对照 ACP 结果与内部审批结果。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import ApprovalService, { type ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import { makeBridgeHarness, type BridgeHarness } from './harness.ts'

describe('ACP machine permission policy', () => {
  // 当前用例拥有的桥接测试装配，每次测试结束都必须释放。
  let harness: BridgeHarness | undefined

  afterEach(async () => {
    await harness?.dispose()
    harness = undefined
  })

  /**
   * 创建来自 ACP 自有代理的标准审批请求。
   * @param overrides 需要覆盖的审批字段。
   * @returns 已加载审批服务且关联真实会话的请求。
   * @example await ownedRequest({ toolName: 'write' })
   */
  async function ownedRequest(overrides: Partial<ApprovalRequest> = {}): Promise<ApprovalRequest> {
    if (harness === undefined) throw new Error('missing harness')
    await harness.ctx.plugin(ApprovalService)
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    // ACP 客户端新建的会话标识。
    const { sessionId } = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    // 桥接层代理注册表中的精确代理实例。
    const agent = harness.ctx.agents.get(SessionId(sessionId))!
    agent.session.append('turn/start', { turn: 1 })
    agent.session.append('step/start', { turn: 1, step: 1 })
    agent.session.append('tool/call', { turn: 1, step: 1, callId: ToolCallId('call-9'), name: 'bash', arguments: '{}' })
    return { agent, toolName: 'bash', callId: ToolCallId('call-9'), ...overrides }
  }

  it('maps the two advertised one-shot choices', async () => {
    harness = await makeBridgeHarness()
    harness.onPermission = () => {
      expect(harness?.sessionUpdates.at(-1)?.update).toMatchObject({
        sessionUpdate: 'tool_call',
        toolCallId: 'call-9',
      })
      return { outcome: { outcome: 'selected', optionId: 'allow-once' } }
    }
    const request = await ownedRequest()
    await expect(harness.ctx.approval.request(request)).resolves.toBe('allowed-once')
    expect(harness.permissionRequests[0]).toMatchObject({
      sessionId: request.agent.session.id,
      toolCall: { toolCallId: 'call-9' },
      options: [
        { optionId: 'allow-once', kind: 'allow_once' },
        { optionId: 'reject-once', kind: 'reject_once' },
      ],
    })

    harness.onPermission = () => ({ outcome: { outcome: 'selected', optionId: 'reject-once' } })
    await expect(harness.ctx.approval.request(request)).resolves.toBe('rejected')
  })

  it('maps cancellation and unknown choices without granting access', async () => {
    harness = await makeBridgeHarness()
    const request = await ownedRequest()
    await expect(harness.ctx.approval.request(request)).resolves.toBe('cancelled')
    harness.onPermission = () => ({ outcome: { outcome: 'selected', optionId: 'unknown-grant' } })
    await expect(harness.ctx.approval.request(request)).resolves.toBe('rejected')
  })

  it('fails closed when the client errors the permission request', async () => {
    harness = await makeBridgeHarness()
    const request = await ownedRequest()
    harness.onPermission = () => { throw new Error('client gone') }
    await expect(harness.ctx.approval.request(request)).resolves.toBe('unavailable')
  })

  it('delegates a same-id foreign agent', async () => {
    harness = await makeBridgeHarness()
    const request = await ownedRequest()
    const foreign = {
      session: { id: request.agent.session.id, events: [{ type: 'turn/start' }], append: () => ({}) },
    } as unknown as Agent
    await expect(harness.ctx.approval.request({ agent: foreign, toolName: 'bash', callId: ToolCallId('call') }))
      .resolves.toBe('unavailable')
    expect(harness.permissionRequests).toHaveLength(0)
  })

  it('delegates requests that have no protocol tool-call identity', async () => {
    harness = await makeBridgeHarness()
    const request = await ownedRequest()
    await expect(harness.ctx.approval.request({ agent: request.agent, toolName: request.toolName }))
      .resolves.toBe('unavailable')
    expect(harness.permissionRequests).toHaveLength(0)
  })
})
