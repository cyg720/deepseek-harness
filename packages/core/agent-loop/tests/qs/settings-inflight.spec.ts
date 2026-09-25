/** 配置更新只影响下一工具组；在途组继续使用启动时捕获的并发上限。 */
import { expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage, ToolCallId, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { MockAdapter, textResponse } from '../mock-adapter.ts'

/** 测试私有设置文档，所有提交仍经过官方校验和版本管理。 */
class MemorySettings extends SettingsProvider {
  private doc: Record<string, unknown> = {}
  get writable(): boolean { return true }
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve(structuredClone(this.doc)) }
  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

function calls(ids: string[]): StreamChunk[] {
  const chunks: StreamChunk[] = []
  ids.forEach((id, index) => {
    chunks.push({ type: 'block-start', index, blockType: 'tool-call' },
      { type: 'block-end', index, block: { type: 'tool-call', id: ToolCallId(id), name: 'gated', arguments: JSON.stringify({ id }) } })
  })
  chunks.push({ type: 'usage', usage: { inputTokens: 5, outputTokens: 5 } }, { type: 'finish', reason: { kind: 'tool-calls' } })
  return chunks
}

it('keeps the active group cap and samples a settings update for the next group', async () => {
  const ctx = new Context()
  const gates = new Map<string, () => void>(), started: string[] = []
  let draining = false
  try {
    await ctx.plugin(MemorySettings)
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SystemPrompt, { personaPrefix: '' })
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 2 })
    ctx.llm.registerAdapter(['mock'], new MockAdapter([calls(['a1', 'a2', 'a3']), calls(['b1', 'b2']), textResponse('done')]))
    ctx.tools.register(defineContentToolFixture({
      name: 'gated', description: 'controlled settings test', parameters: { id: { type: 'string', required: true } },
      isConcurrencySafe: () => true,
      async execute(args) {
        started.push(args.id)
        if (!draining) await new Promise<void>((resolve) => { gates.set(args.id, resolve) })
        return [{ type: 'text', text: args.id }]
      },
    }))
    const agent = await ctx.agentLoop.create(SessionId('qs-settings-inflight'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await vi.waitFor(() => { expect(started).toEqual(['a1', 'a2']) })
    await ctx.settings.update('agent-loop', { maxParallelToolCalls: 1 })
    gates.get('a1')!()
    // a2 仍阻塞时 a3 已启动，证明当前组没有被新上限缩减。
    await vi.waitFor(() => { expect(started).toEqual(['a1', 'a2', 'a3']) })
    gates.get('a2')!(); gates.get('a3')!()
    await vi.waitFor(() => { expect(started).toContain('b1') })
    gates.get('b1')!()
    await vi.waitFor(() => { expect(started).toContain('b2') })
    gates.get('b2')!()
    await vi.waitFor(() => { expect(agent.status).toBe('idle') })
    const order = agent.session.snapshotEvents().flatMap(event => event.type === 'tool/call'
      ? [`start:${event.data.callId}`] : event.type === 'tool/result' ? [`end:${event.data.message.source.callId}`] : [])
    // 使用持久事件顺序证明 b2 在 b1 结束后启动，不依赖短暂等待断言“没有发生”。
    expect(order).toHaveLength(10)
    expect(order).toContain('end:b1')
    expect(order).toContain('end:a2')
    expect(order.indexOf('start:b2')).toBeGreaterThan(order.indexOf('end:b1'))
    expect(order.indexOf('start:a3')).toBeLessThan(order.indexOf('end:a2'))
  } finally {
    // 断言失败也释放未来工具，避免卸载等待未结算的执行。
    draining = true
    for (const release of gates.values()) release()
    await ctx.fiber.dispose()
  }
})
