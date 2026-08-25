/**
 * 文件职责：验证Claude Code Hook 桥的 coverage-cases.ts 行为与边界。
 * 技术维度：TypeScript、Cordis、JSON 编解码、子进程、事件匹配和严格联合类型。
 * 产品维度：保证Claude Code Hook 桥可预测地传递事件、限制循环或适配外部工具。
 * 逻辑维度：构造事件与配置，驱动入口并断言结果。
 * 关键边界：线协议输入必须校验；外部 Hook 失败不得破坏会话日志或核心循环。
 * 新手阅读建议：先读 types/events，再看 codec/matcher/runner，最后阅读桥接配置。
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, chmodSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { LocalBashExecutor } from '@deepseek-ai/dsh-bash-local'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { scopeTarget } from '@deepseek-ai/dsh-scope'
import SubagentRuntime, { SubagentRunId } from '@deepseek-ai/dsh-subagent'
import * as HooksClaude from '@deepseek-ai/dsh-hooks-claude-code'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

/** 中文说明：测试局部值 testToolSignal，由紧邻初始化决定。 */
const testToolSignal = new AbortController().signal

/** Targeted branch coverage for the CC bridge: option arms, warn paths, no-agent
 * fallbacks, contextFrom-empty, and the detached-listener catch handlers. */

/* 中文说明：测试局部值 dirs，由紧邻初始化决定。 */
const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

/** 中文说明：函数 subagentCarrier 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function subagentCarrier(ctx: Context) {
  return scopeTarget(ctx as unknown as SubagentRuntime, undefined)
}

/** 中文说明：函数 dir 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function dir(): string { const d = mkdtempSync(join(tmpdir(), 'dsh-hc-cov-')); dirs.push(d); return d }
/** 中文说明：函数 sh 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function sh(d: string, name: string, body: string): string {
  /** 中文说明：测试局部值 p，由紧邻初始化决定。 */
  const p = join(d, name); writeFileSync(p, body); chmodSync(p, 0o755); return p
}
/** 中文说明：函数 hooks 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function hooks(d: string, h: unknown): string {
  writeFileSync(join(d, 'hooks.json'), JSON.stringify({ hooks: h })); return join(d, 'hooks.json')
}

/** 中文说明：类型或类 HarnessOpts 约束 Hook、守卫或目标数据职责。 */
type HarnessOpts = { pluginRoot?: string; projectDir?: string; stderrSummaryMaxChars?: number; sessionRoot?: string }
/** 中文说明：函数 harness 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function harness(configPath: string, adapter: MockAdapter, opts: HarnessOpts = {}): Promise<Context> {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  if (opts.sessionRoot !== undefined) await ctx.plugin(JsonlSessionPersistence, { root: opts.sessionRoot })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(LocalBashExecutor, { timeoutMs: 10_000 })
  await ctx.plugin(HooksClaude, { configPath, ...opts })
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}
/** 中文说明：函数 waitForIdle 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function waitForIdle(_ctx: Context, agent: Agent): Promise<void> {
  return agent.whenIdle()
}
/** 中文说明：函数 events 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function events(agent: Agent): SessionEvent[] { return [...agent.session.events] }
/** Poll until `predicate` holds or the deadline passes — robust to detached
 * emit-listener hooks firing on a `.then` (a fixed sleep flakes under load). */
/* 中文说明：函数 waitFor 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function waitFor(predicate: () => boolean, timeout = 5000, interval = 10): Promise<void> {
  /** 中文说明：测试局部值 deadline，由紧邻初始化决定。 */
  const deadline = Date.now() + timeout
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitFor: condition not met before deadline')
    await new Promise(r => setTimeout(r, interval))
  }
}

/** 中文说明：类型或类 CoverageGroup 约束 Hook、守卫或目标数据职责。 */
export type CoverageGroup = 'config' | 'stop' | 'context' | 'edge-paths'

/** Register independently schedulable slices of the hooks-claude-code coverage matrix. */
/* 中文说明：函数 defineCoverageCases 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function defineCoverageCases(group: CoverageGroup): void {
  if (group === 'config') describe('hooks-claude-code coverage — config option arms + substitution + skip warning', () => {
    it('uses the persistence locator for transcript_path and an empty string without one', async () => {
      /** 中文说明：函数 capture 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
      async function capture(sessionRoot?: string): Promise<{ payload: { transcript_path: string }; expected: string | undefined }> {
        /** 中文说明：测试局部值 d，由紧邻初始化决定。 */
        const d = dir()
        /** 中文说明：测试局部值 cap，由紧邻初始化决定。 */
        const cap = join(d, 'payload')
        /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
        const path = hooks(d, { PreToolUse: [{ hooks: [{ type: 'command', command: sh(d, 'capture.sh', `#!/usr/bin/env bash\ncat > "${cap}"\n`) }] }] })
        /** 中文说明：测试局部值 adapter，由紧邻初始化决定。 */
        const adapter = new MockAdapter([toolCallResponse('c1', 'echo', {}), textResponse('done')])
        /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
        const ctx = await harness(path, adapter, { ...sessionRoot !== undefined ? { sessionRoot } : {} })
        ctx.tools.register(defineContentToolFixture({ name: 'echo', description: 'e', parameters: {}, async execute() { return [{ type: 'text', text: 'ok' }] } }))
        /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
        const agent = ctx.agentLoop.create(SessionId('transcript'), { provider: 'mock', model: 'mock' })
        agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
        await waitForIdle(ctx, agent)
        return {
          payload: JSON.parse(readFileSync(cap, 'utf8')) as { transcript_path: string },
          expected: ctx.get('sessionPersistence')?.locate(agent.session.header)?.path,
        }
      }

      /** 中文说明：测试局部值 located，由紧邻初始化决定。 */
      const located = await capture(dir())
      expect(located.payload.transcript_path).toBe(located.expected)
      expect((await capture()).payload.transcript_path).toBe('')
    }, 15_000) // Two real agent/hook subprocess loops need process startup and teardown headroom.

    it('honors pluginRoot + projectDir substitution and warns on a skipped non-command hook', async () => {
      /** 中文说明：测试局部值 d，由紧邻初始化决定。 */
      const d = dir()
      // ${CLAUDE_PLUGIN_ROOT} resolves to d; the script writes its own cwd-independent marker.
      /** 中文说明：测试局部值 marker，由紧邻初始化决定。 */
      const marker = join(d, 'ran')
      sh(d, 'h.sh', `#!/usr/bin/env bash\ntouch "${marker}"\n`)
      /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
      const path = hooks(d, {
        PreToolUse: [{ hooks: [
          { type: 'prompt', prompt: 'skipme' }, // skipped → warn loop
          { type: 'command', command: '${CLAUDE_PLUGIN_ROOT}/h.sh' }, // substituted
        ] }],
      })
      /** 中文说明：测试局部值 warn，由紧邻初始化决定。 */
      const warn = vi.fn()
      /** 中文说明：测试局部值 adapter，由紧邻初始化决定。 */
      const adapter = new MockAdapter([toolCallResponse('c1', 'echo', {}), textResponse('done')])
      /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
      const ctx = await harness(path, adapter, { pluginRoot: d, projectDir: d })
      ctx.logger.warn = warn as never
      ctx.tools.register(defineContentToolFixture({ name: 'echo', description: 'e', parameters: {}, async execute() { return [{ type: 'text', text: 'ok' }] } }))
      /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
      const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
      await waitForIdle(ctx, agent)
      expect(existsSync(marker)).toBe(true) // substituted command ran
    }, 15_000) // Real agent and hook subprocess startup can exceed Vitest's default under coverage concurrency.

    it('warns and honors updatedInput as a no-op (input rewrite deferred)', async () => {
      /** 中文说明：测试局部值 d，由紧邻初始化决定。 */
      const d = dir()
      /** 中文说明：测试局部值 s，由紧邻初始化决定。 */
      const s = sh(d, 'u.sh', '#!/usr/bin/env bash\necho \'{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","updatedInput":{"command":"rewritten"}}}\'\n')
      /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
      const path = hooks(d, { PreToolUse: [{ hooks: [{ type: 'command', command: s }] }] })
      /** 中文说明：测试局部值 warn，由紧邻初始化决定。 */
      const warn = vi.fn()
      /** 中文说明：测试局部值 adapter，由紧邻初始化决定。 */
      const adapter = new MockAdapter([toolCallResponse('c1', 'echo', { command: 'original' }), textResponse('done')])
      /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
      const ctx = await harness(path, adapter)
      ctx.logger.warn = warn as never
      /** 中文说明：测试局部值 sawArgs: unknown，由紧邻初始化决定。 */
      let sawArgs: unknown
      ctx.tools.register(defineContentToolFixture({ name: 'echo', description: 'e', parameters: { command: { type: 'string' } }, async execute(args) { sawArgs = args; return [{ type: 'text', text: 'ok' }] } }))
      /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
      const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
      await waitForIdle(ctx, agent)
      // updatedInput is NOT honored — the tool ran with the ORIGINAL args.
      expect((sawArgs as { command?: string }).command).toBe('original')
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('updatedInput'))
    })
  })

  if (group === 'config') describe('hooks-claude-code coverage — empty/no-op outcomes and no-agent paths', () => {
    it('a clean exit-0 hook with no output is a no-op (contextFrom empty → next())', async () => {
      /** 中文说明：测试局部值 d，由紧邻初始化决定。 */
      const d = dir()
      /** 中文说明：测试局部值 s，由紧邻初始化决定。 */
      const s = sh(d, 'noop.sh', '#!/usr/bin/env bash\nexit 0\n')
      /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
      const path = hooks(d, { UserPromptSubmit: [{ hooks: [{ type: 'command', command: s }] }] })
      /** 中文说明：测试局部值 adapter，由紧邻初始化决定。 */
      const adapter = new MockAdapter([textResponse('ran')])
      /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
      const ctx = await harness(path, adapter)
      /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
      const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
      await waitForIdle(ctx, agent)
      // The prompt proceeded unchanged; no injected context.
      expect(adapter.requests).toHaveLength(1)
      expect(events(agent).some(e => e.type === 'user/message' && e.data.source.kind !== 'user')).toBe(false)
    })

    it('a PreToolUse hook fires for a no-agent direct tool call (no session/turn to record into)', async () => {
      /** 中文说明：测试局部值 d，由紧邻初始化决定。 */
      const d = dir()
      /** 中文说明：测试局部值 s，由紧邻初始化决定。 */
      const s = sh(d, 'deny.sh', '#!/usr/bin/env bash\necho "no" >&2\nexit 2\n')
      /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
      const path = hooks(d, { PreToolUse: [{ hooks: [{ type: 'command', command: s }] }] })
      /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
      const ctx = await harness(path, new MockAdapter([]))
      /** 中文说明：测试局部值 ran，由紧邻初始化决定。 */
      let ran = false
      ctx.tools.register(defineContentToolFixture({ name: 'echo', description: 'e', parameters: {}, async execute() { ran = true; return [{ type: 'text', text: 'x' }] } }))
      /** 中文说明：测试局部值 { CallId }，由紧邻初始化决定。 */
      const { CallId } = await import('@deepseek-ai/dsh-llm')
      /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
      const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('c1'), name: 'echo', arguments: {} })
      expect(ran).toBe(false)
      expect(result.isError).toBe(true)
    })

    it('a long stderr is truncated in the hook/result summary', async () => {
      /** 中文说明：测试局部值 d，由紧邻初始化决定。 */
      const d = dir()
      /** 中文说明：测试局部值 s，由紧邻初始化决定。 */
      const s = sh(d, 'long.sh', '#!/usr/bin/env bash\nprintf "x%.0s" {1..600} >&2\nexit 2\n')
      /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
      const path = hooks(d, { PreToolUse: [{ hooks: [{ type: 'command', command: s }] }] })
      /** 中文说明：测试局部值 adapter，由紧邻初始化决定。 */
      const adapter = new MockAdapter([toolCallResponse('c1', 'echo', {}), textResponse('done')])
      /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
      const ctx = await harness(path, adapter)
      ctx.tools.register(defineContentToolFixture({ name: 'echo', description: 'e', parameters: {}, async execute() { return [{ type: 'text', text: 'ok' }] } }))
      /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
      const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
      await waitForIdle(ctx, agent)
      /** 中文说明：测试局部值 res，由紧邻初始化决定。 */
      const res = events(agent).find(e => e.type === 'hook/result')
      expect(res?.type === 'hook/result' && res.data.stderrSummary?.endsWith('…')).toBe(true)
      expect(res?.type === 'hook/result' && res.data.stderrSummary?.length).toBe(501) // default 500-char cap + ellipsis
    })

    it('rejects a non-positive or fractional stderrSummaryMaxChars at load', async () => {
      /** 中文说明：测试局部值 d，由紧邻初始化决定。 */
      const d = dir()
      /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
      const path = hooks(d, {})
      /** 中文说明：测试局部值 bad，由紧邻初始化决定。 */
      for (const bad of [0, -5, 1.5, Number.NaN]) {
        /** 中文说明：测试局部值 adapter，由紧邻初始化决定。 */
        const adapter = new MockAdapter([])
        await expect(harness(path, adapter, { stderrSummaryMaxChars: bad }))
          .rejects.toThrow(/hooks-claude-code: stderrSummaryMaxChars must be a positive integer/)
      }
    })

    it('the stderr summary cap is plugin config (stderrSummaryMaxChars)', async () => {
      /** 中文说明：测试局部值 d，由紧邻初始化决定。 */
      const d = dir()
      /** 中文说明：测试局部值 s，由紧邻初始化决定。 */
      const s = sh(d, 'long.sh', '#!/usr/bin/env bash\nprintf "x%.0s" {1..600} >&2\nexit 2\n')
      /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
      const path = hooks(d, { PreToolUse: [{ hooks: [{ type: 'command', command: s }] }] })
      /** 中文说明：测试局部值 adapter，由紧邻初始化决定。 */
      const adapter = new MockAdapter([toolCallResponse('c1', 'echo', {}), textResponse('done')])
      /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
      const ctx = await harness(path, adapter, { stderrSummaryMaxChars: 40 })
      ctx.tools.register(defineContentToolFixture({ name: 'echo', description: 'e', parameters: {}, async execute() { return [{ type: 'text', text: 'ok' }] } }))
      /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
      const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
      await waitForIdle(ctx, agent)
      /** 中文说明：测试局部值 res，由紧邻初始化决定。 */
      const res = events(agent).find(e => e.type === 'hook/result')
      expect(res?.type === 'hook/result' && res.data.stderrSummary).toBe('x'.repeat(40) + '…')
    })
  })

  if (group === 'stop') describe('hooks-claude-code coverage — Stop continuation + subagent inject/catch', () => {
    it('a Stop hook that blocks (exit 2) forces the turn to continue (CC dialect)', async () => {
      /** 中文说明：测试局部值 d，由紧邻初始化决定。 */
      const d = dir()
      /** 中文说明：测试局部值 marker，由紧邻初始化决定。 */
      const marker = join(d, 'fired')
      /** 中文说明：测试局部值 s，由紧邻初始化决定。 */
      const s = sh(d, 'stop.sh', `#!/usr/bin/env bash\nif [ -e "${marker}" ]; then exit 0; fi\ntouch "${marker}"\necho "continue please" >&2\nexit 2\n`)
      /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
      const path = hooks(d, { Stop: [{ hooks: [{ type: 'command', command: s }] }] })
      /** 中文说明：测试局部值 adapter，由紧邻初始化决定。 */
      const adapter = new MockAdapter([textResponse('one'), textResponse('two')])
      /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
      const ctx = await harness(path, adapter)
      /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
      const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
      await waitForIdle(ctx, agent)
      expect(adapter.requests).toHaveLength(2)
      expect(JSON.stringify(adapter.requests[1]!.messages)).toContain('continue please')
    })

    it('a Stop hook that blocks with EMPTY stderr still forces continuation (no reason required)', async () => {
    // A blocking Stop hook with no stderr yields `deny` without a reason. The block still forces
    // continuation; the script self-limits to one block to avoid a loop.
      /** 中文说明：测试局部值 d，由紧邻初始化决定。 */
      const d = dir()
      /** 中文说明：测试局部值 marker，由紧邻初始化决定。 */
      const marker = join(d, 'fired')
      /** 中文说明：测试局部值 s，由紧邻初始化决定。 */
      const s = sh(d, 'stop.sh', `#!/usr/bin/env bash\nif [ -e "${marker}" ]; then exit 0; fi\ntouch "${marker}"\nexit 2\n`)
      /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
      const path = hooks(d, { Stop: [{ hooks: [{ type: 'command', command: s }] }] })
      /** 中文说明：测试局部值 adapter，由紧邻初始化决定。 */
      const adapter = new MockAdapter([textResponse('one'), textResponse('two')])
      /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
      const ctx = await harness(path, adapter)
      /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
      const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
      await waitForIdle(ctx, agent)
      // A second model request ran → the empty-reason block forced continuation.
      expect(adapter.requests).toHaveLength(2)
      // The steering carried the fallback reason (no stderr to use).
      expect(JSON.stringify(adapter.requests[1]!.messages)).toContain('blocked by Stop hook')
    })

    it('SubagentStart additionalContext is injected into a REGISTERED live child', async () => {
      /** 中文说明：测试局部值 d，由紧邻初始化决定。 */
      const d = dir()
      /** 中文说明：测试局部值 s，由紧邻初始化决定。 */
      const s = sh(d, 'sa.sh', '#!/usr/bin/env bash\necho \'{"hookSpecificOutput":{"hookEventName":"SubagentStart","additionalContext":"child guidance"}}\'\n')
      /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
      const path = hooks(d, { SubagentStart: [{ hooks: [{ type: 'command', command: s }] }] })
      /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
      const ctx = await harness(path, new MockAdapter([]))
      /** 中文说明：测试局部值 injected，由紧邻初始化决定。 */
      const injected: string[] = []
      /** 中文说明：测试局部值 child，由紧邻初始化决定。 */
      const child = {
        id: SessionId('child-x'),
        inject: (input: { content: Array<{ type: string; text?: string }> }) => {
          injected.push(input.content.map(block => block.text ?? '').join(''))
        },
        session: { id: SessionId('child-x'), header: { id: 'child-x' } },
      } as unknown as Parameters<typeof ctx.agents.register>[0]
      ctx.agents.register(child)
      ctx.emit(subagentCarrier(ctx), 'subagent/start', { runId: SubagentRunId('run-x'), provider: 'p', id: SessionId('child-x'), local: true })
      await waitFor(() => injected.includes('child guidance'))
      expect(injected).toContain('child guidance')
    })

    it('a throwing SubagentStart/SubagentStop hook run is contained (logged)', async () => {
      /** 中文说明：测试局部值 d，由紧邻初始化决定。 */
      const d = dir()
      // A hook command that does not exist makes runHook resolve a non-blocking
      // error (not a throw), so to hit the .catch we make the .then throw: register
      // a child whose inject throws for SubagentStart.
      /** 中文说明：测试局部值 s，由紧邻初始化决定。 */
      const s = sh(d, 'sa.sh', '#!/usr/bin/env bash\necho \'{"hookSpecificOutput":{"hookEventName":"SubagentStart","additionalContext":"x"}}\'\n')
      /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
      const path = hooks(d, { SubagentStart: [{ hooks: [{ type: 'command', command: s }] }] })
      /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
      const ctx = await harness(path, new MockAdapter([]))
      /** 中文说明：测试局部值 warn，由紧邻初始化决定。 */
      const warn = vi.fn(); ctx.logger.warn = warn as never
      /** 中文说明：测试局部值 child，由紧邻初始化决定。 */
      const child = { id: SessionId('child-y'), inject: () => { throw new Error('inject boom') }, session: { id: SessionId('child-y'), header: { id: 'child-y' } } } as unknown as Parameters<typeof ctx.agents.register>[0]
      ctx.agents.register(child)
      ctx.emit(subagentCarrier(ctx), 'subagent/start', { runId: SubagentRunId('run-y'), provider: 'p', id: SessionId('child-y'), local: true })
      await waitFor(() => warn.mock.calls.some(c => String(c[0]).includes('SubagentStart hook failed')))
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('SubagentStart hook failed'))
    })
  })

  if (group === 'stop') describe('hooks-claude-code coverage — default reasons + sparse payloads', () => {
    it('PreToolUse deny with EMPTY stderr uses the default reason', async () => {
      /** 中文说明：测试局部值 d，由紧邻初始化决定。 */
      const d = dir()
      /** 中文说明：测试局部值 s，由紧邻初始化决定。 */
      const s = sh(d, 'deny.sh', '#!/usr/bin/env bash\nexit 2\n') // exit 2, no stderr
      /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
      const path = hooks(d, { PreToolUse: [{ hooks: [{ type: 'command', command: s }] }] })
      /** 中文说明：测试局部值 adapter，由紧邻初始化决定。 */
      const adapter = new MockAdapter([toolCallResponse('c1', 'echo', {}), textResponse('done')])
      /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
      const ctx = await harness(path, adapter)
      ctx.tools.register(defineContentToolFixture({ name: 'echo', description: 'e', parameters: {}, async execute() { return [{ type: 'text', text: 'x' }] } }))
      /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
      const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
      await waitForIdle(ctx, agent)
      /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
      const result = events(agent).find(e => e.type === 'tool/result')
      expect(result?.type === 'tool/result' && result.data.message.content[0].content.some(b => b.type === 'text' && b.text.includes('blocked by PreToolUse hook'))).toBe(true)
    })

    it('PostToolUse deny with EMPTY stderr + no context uses the default feedback', async () => {
      /** 中文说明：测试局部值 d，由紧邻初始化决定。 */
      const d = dir()
      /** 中文说明：测试局部值 s，由紧邻初始化决定。 */
      const s = sh(d, 'block.sh', '#!/usr/bin/env bash\nexit 2\n')
      /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
      const path = hooks(d, { PostToolUse: [{ hooks: [{ type: 'command', command: s }] }] })
      /** 中文说明：测试局部值 adapter，由紧邻初始化决定。 */
      const adapter = new MockAdapter([toolCallResponse('c1', 'echo', {}), textResponse('done')])
      /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
      const ctx = await harness(path, adapter)
      ctx.tools.register(defineContentToolFixture({ name: 'echo', description: 'e', parameters: {}, async execute() { return [{ type: 'text', text: 'ok' }] } }))
      /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
      const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
      await waitForIdle(ctx, agent)
      /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
      const result = events(agent).find(e => e.type === 'tool/result')
      expect(result?.type === 'tool/result' && result.data.message.content[0].content.some(b => b.type === 'text' && b.text.includes('blocked by PostToolUse hook'))).toBe(true)
    })

    it('SubagentStop with no registered child runs the hook cleanly (fire-and-forget)', async () => {
      /** 中文说明：测试局部值 d，由紧邻初始化决定。 */
      const d = dir()
      // The agents registry has no entry for the id, so the child lookup yields
      // undefined and the payload falls back to base(undefined) — assert the
      // observe-only SubagentStop run still executes the hook without crashing.
      /** 中文说明：测试局部值 marker，由紧邻初始化决定。 */
      const marker = join(d, 'stopran')
      /** 中文说明：测试局部值 s，由紧邻初始化决定。 */
      const s = sh(d, 'stop.sh', `#!/usr/bin/env bash\ntouch "${marker}"\n`)
      /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
      const path = hooks(d, { SubagentStop: [{ hooks: [{ type: 'command', command: s }] }] })
      /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
      const ctx = await harness(path, new MockAdapter([]))
      ctx.emit(subagentCarrier(ctx), 'subagent/end', { runId: SubagentRunId('run-z'), provider: 'p', id: SessionId('child-z'), local: false, stopReason: 'completed' })
      await waitFor(() => existsSync(marker))
      expect(existsSync(marker)).toBe(true)
    })
  })

  if (group === 'edge-paths') describe('hooks-claude-code coverage — more default/sparse arms', () => {
    it('UserPromptSubmit deny with EMPTY stderr uses the default block reason', async () => {
      /** 中文说明：测试局部值 d，由紧邻初始化决定。 */
      const d = dir()
      /** 中文说明：测试局部值 s，由紧邻初始化决定。 */
      const s = sh(d, 'block.sh', '#!/usr/bin/env bash\nexit 2\n')
      /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
      const path = hooks(d, { UserPromptSubmit: [{ hooks: [{ type: 'command', command: s }] }] })
      /** 中文说明：测试局部值 adapter，由紧邻初始化决定。 */
      const adapter = new MockAdapter([textResponse('no')])
      /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
      const ctx = await harness(path, adapter)
      /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
      const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
      await waitForIdle(ctx, agent)
      expect(events(agent).filter(e => e.type === 'turn/start' || e.type === 'hook/invoked'
        || e.type === 'hook/result' || e.type === 'turn/end').map(e => e.type))
        .toEqual(['turn/start', 'hook/invoked', 'hook/result', 'turn/end'])
    })

    it('a PreToolUse ask with NO reason omits the reason (false arm)', async () => {
      /** 中文说明：测试局部值 d，由紧邻初始化决定。 */
      const d = dir()
      /** 中文说明：测试局部值 s，由紧邻初始化决定。 */
      const s = sh(d, 'ask.sh', '#!/usr/bin/env bash\necho \'{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask"}}\'\n')
      /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
      const path = hooks(d, { PreToolUse: [{ hooks: [{ type: 'command', command: s }] }] })
      /** 中文说明：测试局部值 adapter，由紧邻初始化决定。 */
      const adapter = new MockAdapter([toolCallResponse('c1', 'echo', {}), textResponse('done')])
      /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
      const ctx = await harness(path, adapter)
      /** 中文说明：测试局部值 ran，由紧邻初始化决定。 */
      let ran = false
      ctx.tools.register(defineContentToolFixture({ name: 'echo', description: 'e', parameters: {}, async execute() { ran = true; return [{ type: 'text', text: 'x' }] } }))
      /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
      const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
      await waitForIdle(ctx, agent)
      // ask (no reason) → degrades to deny with the registry's generic message.
      expect(ran).toBe(false)
      expect(events(agent).some(e => e.type === 'tool/result' && e.data.message.content[0].isError)).toBe(true)
    })

    it('a recorded clean exit-0 hook with no stderr omits exitCode-extra/stderrSummary fields', async () => {
      /** 中文说明：测试局部值 d，由紧邻初始化决定。 */
      const d = dir()
      /** 中文说明：测试局部值 s，由紧邻初始化决定。 */
      const s = sh(d, 'noop.sh', '#!/usr/bin/env bash\nexit 0\n')
      /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
      const path = hooks(d, { PreToolUse: [{ hooks: [{ type: 'command', command: s }] }] })
      /** 中文说明：测试局部值 adapter，由紧邻初始化决定。 */
      const adapter = new MockAdapter([toolCallResponse('c1', 'echo', {}), textResponse('done')])
      /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
      const ctx = await harness(path, adapter)
      ctx.tools.register(defineContentToolFixture({ name: 'echo', description: 'e', parameters: {}, async execute() { return [{ type: 'text', text: 'ok' }] } }))
      /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
      const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
      await waitForIdle(ctx, agent)
      /** 中文说明：测试局部值 res，由紧邻初始化决定。 */
      const res = events(agent).find(e => e.type === 'hook/result')
      expect(res?.type === 'hook/result' && res.data.exitCode).toBe(0)
      expect(res?.type === 'hook/result' && 'stderrSummary' in res.data).toBe(false)
    })
  })

  if (group === 'edge-paths') describe('hooks-claude-code coverage — schema-bypass apply + unspawnable hook', () => {
    it('a direct apply() (schema bypass) with only configPath runs', async () => {
      /** 中文说明：测试局部值 d，由紧邻初始化决定。 */
      const d = dir()
      /** 中文说明：测试局部值 marker，由紧邻初始化决定。 */
      const marker = join(d, 'ran')
      /** 中文说明：测试局部值 s，由紧邻初始化决定。 */
      const s = sh(d, 'h.sh', `#!/usr/bin/env bash\ntouch "${marker}"\n`)
      hooks(d, { UserPromptSubmit: [{ hooks: [{ type: 'command', command: s }] }] })
      /** 中文说明：测试局部值 adapter，由紧邻初始化决定。 */
      const adapter = new MockAdapter([textResponse('ok')])
      /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
      const ctx = new Context()
      await mountAgentLoopTestDependencies(ctx)
      await ctx.plugin(AgentLoop, { agents: [] })
      await ctx.plugin(LocalSubprocessRuntime)
      await ctx.plugin(LocalBashExecutor, { timeoutMs: 10_000 })
      // Direct apply with only configPath — bypasses schemastery's defaults, so
      // the bridge must run on the raw minimal config (the per-hook timeout is
      // the protocol lib's reference default, not a config knob).
      HooksClaude.apply(ctx, { configPath: join(d, 'hooks.json') })
      ctx.llm.registerAdapter(['mock'], adapter)
      /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
      const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
      await waitForIdle(ctx, agent)
      expect(existsSync(marker)).toBe(true)
    })

    it('a non-zero non-2 hook exit (e.g. a command-not-found 127) is a non-blocking error; the tool still runs', async () => {
      /** 中文说明：测试局部值 d，由紧邻初始化决定。 */
      const d = dir()
      // `bash -c` of a missing program exits 127 — a non-blocking error (not 0, not
      // 2 → no decision), so the tool proceeds; the hook/result records exit 127.
      /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
      const path = hooks(d, { PreToolUse: [{ hooks: [{ type: 'command', command: '/nonexistent/definitely/not/a/command' }] }] })
      /** 中文说明：测试局部值 adapter，由紧邻初始化决定。 */
      const adapter = new MockAdapter([toolCallResponse('c1', 'echo', {}), textResponse('done')])
      /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
      const ctx = await harness(path, adapter)
      /** 中文说明：测试局部值 ran，由紧邻初始化决定。 */
      let ran = false
      ctx.tools.register(defineContentToolFixture({ name: 'echo', description: 'e', parameters: {}, async execute() { ran = true; return [{ type: 'text', text: 'ok' }] } }))
      /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
      const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
      await waitForIdle(ctx, agent)
      expect(ran).toBe(true)
      /** 中文说明：测试局部值 res，由紧邻初始化决定。 */
      const res = events(agent).find(e => e.type === 'hook/result')
      expect(res?.type === 'hook/result' && res.data.exitCode).toBe(127)
    })

    it('a PostToolUse deny with empty stderr + no context uses the default feedback (no context arm)', async () => {
      /** 中文说明：测试局部值 d，由紧邻初始化决定。 */
      const d = dir()
      /** 中文说明：测试局部值 s，由紧邻初始化决定。 */
      const s = sh(d, 'block.sh', '#!/usr/bin/env bash\nexit 2\n')
      /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
      const path = hooks(d, { PostToolUse: [{ hooks: [{ type: 'command', command: s }] }] })
      /** 中文说明：测试局部值 adapter，由紧邻初始化决定。 */
      const adapter = new MockAdapter([toolCallResponse('c1', 'echo', {}), textResponse('done')])
      /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
      const ctx = await harness(path, adapter)
      ctx.tools.register(defineContentToolFixture({ name: 'echo', description: 'e', parameters: {}, async execute() { return [{ type: 'text', text: 'ok' }] } }))
      /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
      const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
      await waitForIdle(ctx, agent)
      /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
      const result = events(agent).find(e => e.type === 'tool/result')
      expect(result?.type === 'tool/result' && result.data.message.content[0].isError).toBe(true)
    })
  })

  if (group === 'context') describe('hooks-claude-code coverage — continue:false, context arm, no-cwd', () => {
    it('a {"continue":false} hook is RECORDED as decision "stop" but does not halt the run (TODO(hook-continue-false))', async () => {
    // The extension points cannot yet honor `continue:false` as a hard halt. The log must still record the
    // stop decision while execution and the turn continue normally.
      /** 中文说明：测试局部值 d，由紧邻初始化决定。 */
      const d = dir()
      /** 中文说明：测试局部值 s，由紧邻初始化决定。 */
      const s = sh(d, 'stop.sh', '#!/usr/bin/env bash\necho \'{"continue":false,"stopReason":"halt"}\'\n')
      /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
      const path = hooks(d, { PreToolUse: [{ hooks: [{ type: 'command', command: s }] }] })
      /** 中文说明：测试局部值 adapter，由紧邻初始化决定。 */
      const adapter = new MockAdapter([toolCallResponse('c1', 'echo', {}), textResponse('done')])
      /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
      const ctx = await harness(path, adapter)
      /** 中文说明：测试局部值 ran，由紧邻初始化决定。 */
      let ran = false
      ctx.tools.register(defineContentToolFixture({ name: 'echo', description: 'e', parameters: {}, async execute() { ran = true; return [{ type: 'text', text: 'ok' }] } }))
      /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
      const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
      await waitForIdle(ctx, agent)
      /** 中文说明：测试局部值 res，由紧邻初始化决定。 */
      const res = events(agent).find(e => e.type === 'hook/result')
      expect(res?.type === 'hook/result' && res.data.decision).toBe('stop') // recorded
      expect(ran).toBe(true) // NOT honored: the tool still ran (halt is deferred)
      /** 中文说明：测试局部值 turnEnd，由紧邻初始化决定。 */
      const turnEnd = events(agent).findLast(e => e.type === 'turn/end')
      expect(turnEnd?.type === 'turn/end' && turnEnd.data.reason.kind).toBe('completed') // ran to completion
    })

    it('a PostToolUse hook that BOTH blocks AND attaches additionalContext', async () => {
      /** 中文说明：测试局部值 d，由紧邻初始化决定。 */
      const d = dir()
      /** 中文说明：测试局部值 s，由紧邻初始化决定。 */
      const s = sh(d, 'b.sh', '#!/usr/bin/env bash\necho \'{"decision":"block","reason":"bad","hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"context too"}}\'\n')
      /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
      const path = hooks(d, { PostToolUse: [{ hooks: [{ type: 'command', command: s }] }] })
      /** 中文说明：测试局部值 adapter，由紧邻初始化决定。 */
      const adapter = new MockAdapter([toolCallResponse('c1', 'echo', {}), textResponse('done')])
      /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
      const ctx = await harness(path, adapter)
      ctx.tools.register(defineContentToolFixture({ name: 'echo', description: 'e', parameters: {}, async execute() { return [{ type: 'text', text: 'ok' }] } }))
      /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
      const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
      await waitForIdle(ctx, agent)
      /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
      const result = events(agent).find(e => e.type === 'tool/result')
      expect(result?.type === 'tool/result' && result.data.message.content[0].isError).toBe(true)
      expect(result?.type === 'tool/result' && result.data.message.content[0].content.some(b => b.type === 'text' && b.text.includes('bad'))).toBe(true)
      // additionalContext also injected (the block + context arm).
      expect(events(agent).some(e => e.type === 'user/message' && e.data.source.kind !== 'user' && e.data.content.some(b => b.type === 'text' && b.text.includes('context too')))).toBe(true)
    })

    it('a PreToolUse hook whose hookSpecificOutput names a DIFFERENT event does NOT deny the tool', async () => {
    // The block's hookEventName (UserPromptSubmit) mismatches the firing event
    // (PreToolUse), so its permissionDecision:"deny" is discarded — the tool runs.
      /** 中文说明：测试局部值 d，由紧邻初始化决定。 */
      const d = dir()
      /** 中文说明：测试局部值 s，由紧邻初始化决定。 */
      const s = sh(d, 'x.sh', '#!/usr/bin/env bash\necho \'{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","permissionDecision":"deny"}}\'\n')
      /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
      const path = hooks(d, { PreToolUse: [{ hooks: [{ type: 'command', command: s }] }] })
      /** 中文说明：测试局部值 adapter，由紧邻初始化决定。 */
      const adapter = new MockAdapter([toolCallResponse('c1', 'echo', {}), textResponse('done')])
      /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
      const ctx = await harness(path, adapter)
      /** 中文说明：测试局部值 ran，由紧邻初始化决定。 */
      let ran = false
      ctx.tools.register(defineContentToolFixture({ name: 'echo', description: 'e', parameters: {}, async execute() { ran = true; return [{ type: 'text', text: 'ok' }] } }))
      /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
      const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
      await waitForIdle(ctx, agent)
      expect(ran).toBe(true) // the mismatched deny was discarded → the tool ran
    })

    it('defaults CLAUDE_PROJECT_DIR to the session workspace when no projectDir is configured', async () => {
    // The default ACP wiring sets no projectDir. A stock CC hook that references
    // $CLAUDE_PROJECT_DIR (shell expansion) must still get the session workspace,
    // not an empty string. The hook echoes the var as additionalContext.
      /** 中文说明：测试局部值 d，由紧邻初始化决定。 */
      const d = dir()
      /** 中文说明：测试局部值 workspace，由紧邻初始化决定。 */
      const workspace = dir()
      /** 中文说明：测试局部值 s，由紧邻初始化决定。 */
      const s = sh(d, 'ctx.sh', '#!/usr/bin/env bash\nprintf \'{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"dir=%s"}}\' "$CLAUDE_PROJECT_DIR"\n')
      /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
      const path = hooks(d, { UserPromptSubmit: [{ hooks: [{ type: 'command', command: s }] }] })
      /** 中文说明：测试局部值 adapter，由紧邻初始化决定。 */
      const adapter = new MockAdapter([textResponse('ran')])
      /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
      const ctx = await harness(path, adapter) // NB: no projectDir
      // The factory create() path honors meta.cwd (the plain agentLoop.create() does not).
      /** 中文说明：测试局部值 { SessionId }，由紧邻初始化决定。 */
      const { SessionId } = await import('@deepseek-ai/dsh-session')
      /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
      const handle = await ctx.agents.create({ sessionId: SessionId('s1'), meta: { cwd: workspace }, agentOptions: { provider: 'mock', model: 'mock' } })
      handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
      await waitForIdle(ctx, handle.agent)
      expect(events(handle.agent).some(e => e.type === 'user/message'
      && e.data.content.some(b => b.type === 'text' && b.text.includes(`dir=${workspace}`)))).toBe(true)
      await handle.dispose()
    })

    it('a context-only UserPromptSubmit hook DELEGATES so a later listener can still block', async () => {
    // A context-only hook delegates with `next()` and folds its context, so a downstream policy
    // listener can still veto the prompt.
      /** 中文说明：测试局部值 d，由紧邻初始化决定。 */
      const d = dir()
      /** 中文说明：测试局部值 s，由紧邻初始化决定。 */
      const s = sh(d, 'ctx.sh', '#!/usr/bin/env bash\necho \'{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"bridge ctx"}}\'\n')
      /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
      const path = hooks(d, { UserPromptSubmit: [{ hooks: [{ type: 'command', command: s }] }] })
      /** 中文说明：测试局部值 adapter，由紧邻初始化决定。 */
      const adapter = new MockAdapter([textResponse('should not run')])
      /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
      const ctx = await harness(path, adapter)
      // A later listener that blocks every prompt (registered AFTER the bridge).
      ctx.on('agent/pre-step', async () => ({
        kind: 'reject' as const,
      }))
      /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
      const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
      await waitForIdle(ctx, agent)
      // the downstream block won: the model was never called, no user/message was
      // recorded, and the (sole, fully-blocked) prompt closed the turn `rejected`
      expect(adapter.requests).toHaveLength(0)
      expect(events(agent).some(e => e.type === 'user/message' && e.data.source.kind !== 'user')).toBe(false)
      expect(events(agent).filter(e => e.type === 'turn/start' || e.type === 'hook/invoked'
        || e.type === 'hook/result' || e.type === 'turn/end').map(e => e.type))
        .toEqual(['turn/start', 'hook/invoked', 'hook/result', 'turn/end'])
    })

    it('preserves separate bridge and downstream prompt contexts with framing and metadata', async () => {
    // Both the bridge hook and a later pre-step listener attach context; the
    // request must see both as separately sourced durable events.
      /** 中文说明：测试局部值 d，由紧邻初始化决定。 */
      const d = dir()
      /** 中文说明：测试局部值 s，由紧邻初始化决定。 */
      const s = sh(d, 'ctx.sh', '#!/usr/bin/env bash\necho \'{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"from-bridge"}}\'\n')
      /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
      const path = hooks(d, { UserPromptSubmit: [{ hooks: [{ type: 'command', command: s }] }] })
      /** 中文说明：测试局部值 adapter，由紧邻初始化决定。 */
      const adapter = new MockAdapter([textResponse('ok')])
      /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
      const ctx = await harness(path, adapter)
      ctx.on('agent/pre-step', async ({ messages }) => ({
        kind: 'enter' as const,
        messages: [{
          ...messages[0]!,
          content: [{ type: 'text' as const, text: 'rewritten-prompt' }],
        }, createUserMessage({
          content: [{ type: 'text' as const, text: 'from-downstream' }],
          source: { kind: 'plugin' as const, plugin: 'policy' },
        })],
      }))
      /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
      const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
      await waitForIdle(ctx, agent)
      /** 中文说明：测试局部值 req，由紧邻初始化决定。 */
      const req = JSON.stringify(adapter.requests[0]!.messages)
      expect(req).toContain('from-bridge')
      expect(req).toContain('from-downstream')
      expect(req).toContain('rewritten-prompt') // downstream content rewrite preserved
      // the original prompt was replaced by the downstream rewrite
      /** 中文说明：测试局部值 userMsg，由紧邻初始化决定。 */
      const userMsg = events(agent).find(e => e.type === 'user/message')
      expect(userMsg?.type === 'user/message' && userMsg.data.content.some(b => b.type === 'text' && b.text === 'rewritten-prompt')).toBe(true)
      /** 中文说明：测试局部值 contexts，由紧邻初始化决定。 */
      const contexts = events(agent).filter(event => event.type === 'user/message' && event.data.source.kind !== 'user')
      expect(contexts.map(event => event.type === 'user/message' && event.data.source)).toEqual([
        { kind: 'plugin', plugin: 'policy' },
        { kind: 'plugin', plugin: 'hooks-claude-code' },
      ])
    })

    it('folds the bridge PostToolUse context onto a downstream canonical value replacement', async () => {
    // The bridge hook adds context; a later post-execute listener accepts with a
    // canonical replacement. Both the replacement and the bridge context survive.
      /** 中文说明：测试局部值 d，由紧邻初始化决定。 */
      const d = dir()
      /** 中文说明：测试局部值 s，由紧邻初始化决定。 */
      const s = sh(d, 'ctx.sh', '#!/usr/bin/env bash\necho \'{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"bridge-note"}}\'\n')
      /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
      const path = hooks(d, { PostToolUse: [{ hooks: [{ type: 'command', command: s }] }] })
      /** 中文说明：测试局部值 adapter，由紧邻初始化决定。 */
      const adapter = new MockAdapter([toolCallResponse('c1', 'echo', {}), textResponse('done')])
      /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
      const ctx = await harness(path, adapter)
      ctx.tools.register(defineContentToolFixture({ name: 'echo', description: 'e', parameters: {}, async execute() { return [{ type: 'text', text: 'ok' }] } }))
      ctx.on('tools/post-execute', async () => ({ kind: 'accept' as const, value: [{ type: 'text' as const, text: 'rewritten-result' }] }))
      /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
      const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
      await waitForIdle(ctx, agent)
      /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
      const result = events(agent).find(e => e.type === 'tool/result')
      expect(result?.type === 'tool/result' && result.data.message.content[0].content.some(b => b.type === 'text' && b.text === 'rewritten-result')).toBe(true)
      expect(events(agent).some(e => e.type === 'user/message' && e.data.source.kind !== 'user' && e.data.content.some(b => b.type === 'text' && b.text.includes('bridge-note')))).toBe(true)
    })

    it('keeps bridge and downstream PostToolUse contexts as separate sourced events', async () => {
      /** 中文说明：测试局部值 d，由紧邻初始化决定。 */
      const d = dir()
      /** 中文说明：测试局部值 s，由紧邻初始化决定。 */
      const s = sh(d, 'ctx.sh', '#!/usr/bin/env bash\necho \'{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"bridge-note"}}\'\n')
      /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
      const path = hooks(d, { PostToolUse: [{ hooks: [{ type: 'command', command: s }] }] })
      /** 中文说明：测试局部值 adapter，由紧邻初始化决定。 */
      const adapter = new MockAdapter([toolCallResponse('c1', 'echo', {}), textResponse('done')])
      /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
      const ctx = await harness(path, adapter)
      ctx.tools.register(defineContentToolFixture({ name: 'echo', description: 'e', parameters: {}, async execute() { return [{ type: 'text', text: 'ok' }] } }))
      ctx.on('tools/post-execute', async () => ({
        kind: 'accept' as const,
        additionalContexts: [createUserMessage({
          content: [{ type: 'text' as const, text: 'downstream-note' }],
          source: { kind: 'plugin' as const, plugin: 'policy' },
        })],
      }))
      /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
      const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
      await waitForIdle(ctx, agent)

      /** 中文说明：测试局部值 contexts，由紧邻初始化决定。 */
      const contexts = events(agent).filter(event => event.type === 'user/message' && event.data.source.kind !== 'user')
      expect(contexts.map(event => event.type === 'user/message' && event.data.source)).toEqual([
        { kind: 'plugin', plugin: 'hooks-claude-code' },
        { kind: 'plugin', plugin: 'policy' },
      ])
    })

    it('folds the bridge PostToolUse context onto a downstream listener BLOCK', async () => {
    // The bridge hook only adds context; a later post-execute listener blocks the
    // result. The block wins AND carries the bridge context (concatContext on the
    // block arm).
      /** 中文说明：测试局部值 d，由紧邻初始化决定。 */
      const d = dir()
      /** 中文说明：测试局部值 s，由紧邻初始化决定。 */
      const s = sh(d, 'ctx.sh', '#!/usr/bin/env bash\necho \'{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"bridge-note"}}\'\n')
      /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
      const path = hooks(d, { PostToolUse: [{ hooks: [{ type: 'command', command: s }] }] })
      /** 中文说明：测试局部值 adapter，由紧邻初始化决定。 */
      const adapter = new MockAdapter([toolCallResponse('c1', 'echo', {}), textResponse('done')])
      /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
      const ctx = await harness(path, adapter)
      ctx.tools.register(defineContentToolFixture({ name: 'echo', description: 'e', parameters: {}, async execute() { return [{ type: 'text', text: 'ok' }] } }))
      ctx.on('tools/post-execute', async () => ({ kind: 'block' as const, feedback: [{ type: 'text' as const, text: 'downstream-block' }] }))
      /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
      const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
      await waitForIdle(ctx, agent)
      /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
      const result = events(agent).find(e => e.type === 'tool/result')
      expect(result?.type === 'tool/result' && result.data.message.content[0].isError).toBe(true)
      expect(result?.type === 'tool/result' && result.data.message.content[0].content.some(b => b.type === 'text' && b.text.includes('downstream-block'))).toBe(true)
      // the bridge's context still landed (folded onto the block)
      expect(events(agent).some(e => e.type === 'user/message' && e.data.source.kind !== 'user' && e.data.content.some(b => b.type === 'text' && b.text.includes('bridge-note')))).toBe(true)
    })

  })

  if (group === 'edge-paths') describe('hooks-claude-code coverage — executor reject + no-open-turn', () => {
    it('when the bash executor REJECTS a hook run, the hook/result omits exitCode (non-blocking)', async () => {
      /** 中文说明：测试局部值 d，由紧邻初始化决定。 */
      const d = dir()
      /** 中文说明：测试局部值 s，由紧邻初始化决定。 */
      const s = sh(d, 'h.sh', '#!/usr/bin/env bash\nexit 0\n')
      /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
      const path = hooks(d, { PreToolUse: [{ hooks: [{ type: 'command', command: s }] }] })
      /** 中文说明：测试局部值 adapter，由紧邻初始化决定。 */
      const adapter = new MockAdapter([toolCallResponse('c1', 'echo', {}), textResponse('done')])
      /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
      const ctx = await harness(path, adapter)
      // Force the executor to reject (an infrastructure fault) so runHook's catch
      // yields a HookOutput with exitCode undefined → the `exitCode` spread false arm.
      /** 中文说明：测试局部值 bash，由紧邻初始化决定。 */
      const bash = ctx.shell
      bash.run = (() => Promise.reject(new Error('executor down')))
      ctx.tools.register(defineContentToolFixture({ name: 'echo', description: 'e', parameters: {}, async execute() { return [{ type: 'text', text: 'ok' }] } }))
      /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
      const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
      await waitForIdle(ctx, agent)
      /** 中文说明：测试局部值 res，由紧邻初始化决定。 */
      const res = events(agent).find(e => e.type === 'hook/result')
      expect(res?.type === 'hook/result' && 'exitCode' in res.data).toBe(false)
    })

  })

  if (group === 'edge-paths') describe('hooks-claude-code coverage — detached-listener catch handlers', () => {
    it('a throwing SessionStart inject is contained (logged, agent still runs)', async () => {
      /** 中文说明：测试局部值 d，由紧邻初始化决定。 */
      const d = dir()
      /** 中文说明：测试局部值 s，由紧邻初始化决定。 */
      const s = sh(d, 'start.sh', '#!/usr/bin/env bash\necho \'{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"x"}}\'\n')
      /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
      const path = hooks(d, { SessionStart: [{ hooks: [{ type: 'command', command: s }] }] })
      /** 中文说明：测试局部值 adapter，由紧邻初始化决定。 */
      const adapter = new MockAdapter([textResponse('ok')])
      /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
      const ctx = await harness(path, adapter)
      /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
      const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
      // Make inject throw, forcing the SessionStart .catch path.
      /** 中文说明：测试局部值 original，由紧邻初始化决定。 */
      const original = agent.inject.bind(agent)
      /** 中文说明：测试局部值 threw，由紧邻初始化决定。 */
      let threw = false
      agent.inject = (() => { threw = true; throw new Error('inject boom') })
      await waitFor(() => threw)
      expect(threw).toBe(true)
      agent.inject = original
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
      await waitForIdle(ctx, agent)
      expect(adapter.requests).toHaveLength(1) // loop survived the thrown inject
    })
  })

  if (group === 'stop') describe('hooks-claude-code coverage — hook runs in the session cwd, not the server cwd', () => {
    it('runs an agent-scoped hook in the session workspace even when the executor default differs', async () => {
    // The server launch directory and session cwd deliberately differ. The marker proves the
    // bridge passes `session/new.cwd` instead of falling back to the executor default.
      /** 中文说明：测试局部值 serverDir，由紧邻初始化决定。 */
      const serverDir = dir()
      /** 中文说明：测试局部值 sessionDir，由紧邻初始化决定。 */
      const sessionDir = dir()
      /** 中文说明：测试局部值 marker，由紧邻初始化决定。 */
      const marker = join(sessionDir, 'where')
      // The hook is invoked with cwd = session dir, so a relative marker path lands there.
      hooks(serverDir, { PreToolUse: [{ hooks: [{ type: 'command', command: 'pwd > where' }] }] })
      /** 中文说明：测试局部值 adapter，由紧邻初始化决定。 */
      const adapter = new MockAdapter([toolCallResponse('c1', 'echo', {}), textResponse('done')])
      /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
      const ctx = new Context()
      await mountAgentLoopTestDependencies(ctx)
      await ctx.plugin(AgentLoop, { agents: [] })
      // Executor default cwd = serverDir (deliberately NOT the session cwd).
      await ctx.plugin(LocalSubprocessRuntime)
      await ctx.plugin(LocalBashExecutor, { timeoutMs: 10_000, cwd: serverDir })
      await ctx.plugin(HooksClaude, { configPath: join(serverDir, 'hooks.json') })
      ctx.llm.registerAdapter(['mock'], adapter)
      ctx.tools.register(defineContentToolFixture({ name: 'echo', description: 'e', parameters: {}, async execute() { return [{ type: 'text', text: 'ok' }] } }))

      /** 中文说明：测试局部值 { SessionId }，由紧邻初始化决定。 */
      const { SessionId } = await import('@deepseek-ai/dsh-session')
      /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
      const handle = await ctx.agents.create({ sessionId: SessionId('s1'), meta: { cwd: sessionDir }, agentOptions: { provider: 'mock', model: 'mock' } })
      handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
      await waitForIdle(ctx, handle.agent)

      expect(existsSync(marker)).toBe(true) // the marker landed in the SESSION dir
      /** 中文说明：测试局部值 { readFileSync }，由紧邻初始化决定。 */
      const { readFileSync } = await import('node:fs')
      /** 中文说明：测试局部值 where，由紧邻初始化决定。 */
      const where = readFileSync(marker, 'utf8').trim()
      // `pwd` may resolve symlinks (/var → /private/var etc.), so compare basenames.
      expect(where.endsWith(sessionDir.split('/').pop()!)).toBe(true)
      await handle.dispose()
    })

    it('runs a SubagentStop hook in the CHILD session workspace, not the server cwd', async () => {
      /** 中文说明：测试局部值 serverDir，由紧邻初始化决定。 */
      const serverDir = dir()
      /** 中文说明：测试局部值 childDir，由紧邻初始化决定。 */
      const childDir = dir()
      /** 中文说明：测试局部值 marker，由紧邻初始化决定。 */
      const marker = join(childDir, 'stopwhere')
      /** 中文说明：测试局部值 payload，由紧邻初始化决定。 */
      const payload = join(childDir, 'stoppayload')
      hooks(serverDir, { SubagentStop: [{ hooks: [{ type: 'command', command: 'cat > stoppayload.tmp; mv stoppayload.tmp stoppayload; pwd > stopwhere' }] }] })
      /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
      const ctx = new Context()
      await mountAgentLoopTestDependencies(ctx)
      await ctx.plugin(AgentLoop, { agents: [] })
      // Executor default cwd = serverDir (deliberately NOT the child session cwd).
      await ctx.plugin(LocalSubprocessRuntime)
      await ctx.plugin(LocalBashExecutor, { timeoutMs: 10_000, cwd: serverDir })
      await ctx.plugin(HooksClaude, { configPath: join(serverDir, 'hooks.json') })
      ctx.llm.registerAdapter(['mock'], new MockAdapter([]))

      /** 中文说明：测试局部值 { SessionId }，由紧邻初始化决定。 */
      const { SessionId } = await import('@deepseek-ai/dsh-session')
      /** 中文说明：测试局部值 childHandle，由紧邻初始化决定。 */
      const childHandle = await ctx.agents.create({ sessionId: SessionId('child-stop-session'), meta: { cwd: childDir }, agentOptions: { provider: 'mock', model: 'mock' } })
      /** 中文说明：测试局部值 runId，由紧邻初始化决定。 */
      const runId = SubagentRunId('run-stop')
      /** 中文说明：测试局部值 identity，由紧邻初始化决定。 */
      const identity = { runId, provider: 'inproc', id: childHandle.agent.id, local: true }
      // Start is the registry-backed capture edge; end deliberately follows
      // handle disposal, matching continuable Activation settlement.
      ctx.emit(subagentCarrier(ctx), 'subagent/start', identity)
      await childHandle.dispose()
      expect(ctx.agents.get(childHandle.agent.id)).toBeUndefined()
      ctx.emit(subagentCarrier(ctx), 'subagent/end', { ...identity, stopReason: 'completed' })

      await waitFor(() => existsSync(marker))
      expect(existsSync(marker)).toBe(true) // the marker landed in the CHILD dir
      /** 中文说明：测试局部值 where，由紧邻初始化决定。 */
      const where = readFileSync(marker, 'utf8').trim()
      /** 中文说明：测试局部值 input，由紧邻初始化决定。 */
      const input = JSON.parse(readFileSync(payload, 'utf8')) as { cwd: string; session_id: string }
      // `pwd` may resolve symlinks (/var → /private/var etc.), so compare basenames.
      expect(where.endsWith(childDir.split('/').pop()!)).toBe(true)
      expect(input).toMatchObject({ cwd: childDir, session_id: childHandle.agent.id })
    })
  })

  if (group === 'config') describe('hooks-claude-code coverage — systemMessage is warned, not surfaced', () => {
    it('a hook emitting a systemMessage is logged as not-yet-surfaced', async () => {
      /** 中文说明：测试局部值 d，由紧邻初始化决定。 */
      const d = dir()
      /** 中文说明：测试局部值 s，由紧邻初始化决定。 */
      const s = sh(d, 'sm.sh', '#!/usr/bin/env bash\necho \'{"systemMessage":"heads up"}\'\n')
      /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
      const path = hooks(d, { UserPromptSubmit: [{ hooks: [{ type: 'command', command: s }] }] })
      /** 中文说明：测试局部值 adapter，由紧邻初始化决定。 */
      const adapter = new MockAdapter([textResponse('ok')])
      /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
      const ctx = await harness(path, adapter)
      /** 中文说明：测试局部值 warn，由紧邻初始化决定。 */
      const warn = vi.fn(); ctx.logger.warn = warn as never
      /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
      const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
      await waitForIdle(ctx, agent)
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('systemMessage'))
      // Not surfaced: the systemMessage text never reaches the model request.
      expect(JSON.stringify(adapter.requests[0]!.messages)).not.toContain('heads up')
    })
  })

  if (group === 'edge-paths') describe('hooks-claude-code coverage — SessionStart timing is best-effort (no-wait)', () => {
    it('does NOT crash or block when the prompt is sent immediately (context is best-effort, may miss the first request)', async () => {
    // Session-start injection is detached, so an immediate prompt need not observe it. Assert only
    // the guaranteed behavior—no crash and a completed turn—without pre-waiting away the race.
      /** 中文说明：测试局部值 d，由紧邻初始化决定。 */
      const d = dir()
      /** 中文说明：测试局部值 s，由紧邻初始化决定。 */
      const s = sh(d, 'start.sh', '#!/usr/bin/env bash\necho \'{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"late ctx"}}\'\n')
      /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
      const path = hooks(d, { SessionStart: [{ hooks: [{ type: 'command', command: s }] }] })
      /** 中文说明：测试局部值 adapter，由紧邻初始化决定。 */
      const adapter = new MockAdapter([textResponse('ok')])
      /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
      const ctx = await harness(path, adapter)
      /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
      const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
      // Send immediately — do NOT wait for the session-start inject.
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
      await waitForIdle(ctx, agent)
      expect(adapter.requests).toHaveLength(1) // the turn ran regardless of hook timing
    })
  })
}
