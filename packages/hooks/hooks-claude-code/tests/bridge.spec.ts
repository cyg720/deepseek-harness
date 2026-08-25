/**
 * 文件职责：验证Claude Code Hook 桥的 bridge.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis、JSON 编解码、子进程、事件匹配和严格联合类型。
 * 产品维度：保证Claude Code Hook 桥可预测地传递事件、限制循环或适配外部工具。
 * 逻辑维度：构造事件与配置，驱动入口并断言结果。
 * 关键边界：线协议输入必须校验；外部 Hook 失败不得破坏会话日志或核心循环。
 * 新手阅读建议：先读 types/events，再看 codec/matcher/runner，最后阅读桥接配置。
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
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

/**
 * Full-loop bridge tests: a scripted mock MODEL drives the REAL agent loop + REAL
 * bash executor, and the REAL `dsh-hooks-claude-code` bridge runs REAL shell hook
 * scripts written to a temp dir — only the model is mocked (the "prefer the real
 * implementation" rule). Each test writes a `hooks.json` + executable scripts,
 * loads the bridge pointed at them, and asserts the hook's effect on the loop.
 */

/** 中文说明：测试局部值 dirs，由紧邻初始化决定。 */
const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

/** 中文说明：函数 subagentCarrier 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function subagentCarrier(ctx: Context) {
  return scopeTarget(ctx as unknown as SubagentRuntime, undefined)
}

/** Write a hooks.json + named executable scripts into a fresh temp dir. */
/** 中文说明：函数 writeConfig 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function writeConfig(hooks: unknown, scripts: Record<string, string> = {}): string {
  /** 中文说明：测试局部值 dir，由紧邻初始化决定。 */
  const dir = mkdtempSync(join(tmpdir(), 'dsh-hooks-claude-'))
  dirs.push(dir)
  writeFileSync(join(dir, 'hooks.json'), JSON.stringify({ hooks }))
  /** 中文说明：测试局部值 [name，由紧邻初始化决定。 */
  for (const [name, body] of Object.entries(scripts)) {
    /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
    const path = join(dir, name)
    writeFileSync(path, body)
    chmodSync(path, 0o755)
  }
  return dir
}

/** 中文说明：函数 harness 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function harness(configDir: string, adapter: MockAdapter, beforeHooks?: (ctx: Context) => void): Promise<Context> {
  return (await harnessWithFiber(configDir, adapter, beforeHooks)).ctx
}

/** {@link harness}, also exposing the bridge's fiber for tests that dispose it. */
/** 中文说明：函数 harnessWithFiber 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function harnessWithFiber(
  configDir: string,
  adapter: MockAdapter,
  beforeHooks?: (ctx: Context) => void,
): Promise<{ ctx: Context; hooks: Fiber }> {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(LocalBashExecutor, { timeoutMs: 10_000 })
  beforeHooks?.(ctx)
  /** 中文说明：测试局部值 hooks，由紧邻初始化决定。 */
  const hooks = await ctx.plugin(HooksClaude, { configPath: join(configDir, 'hooks.json') })
  ctx.llm.registerAdapter(['mock'], adapter)
  return { ctx, hooks }
}

/** 中文说明：函数 waitForIdle 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function waitForIdle(_ctx: Context, agent: Agent): Promise<void> {
  return agent.whenIdle()
}

/** 中文说明：函数 events 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function events(agent: Agent): SessionEvent[] {
  return [...agent.session.events]
}

/**
 * Poll `predicate` until it returns true or the deadline passes. Detached
 * emit-listener hooks (session-start, subagent) fire on a `.then` the test can't
 * await directly; polling for the observable EFFECT is robust under load, where a
 * single fixed sleep flakes ("async state is not synchronous state").
 */
/** 中文说明：函数 waitFor 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function waitFor(predicate: () => boolean, timeout = 5000, interval = 10): Promise<void> {
  /** 中文说明：测试局部值 deadline，由紧邻初始化决定。 */
  const deadline = Date.now() + timeout
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitFor: condition not met before deadline')
    await new Promise(r => setTimeout(r, interval))
  }
}

describe('hooks-claude-code bridge — UserPromptSubmit', () => {
  it('a UserPromptSubmit hook that exits 2 closes a blocked turn without a step', async () => {
    // UserPromptSubmit ignores its malformed matcher field, then exit 2 blocks
    // with the reason on stderr.
    /** 中文说明：测试局部值 dir，由紧邻初始化决定。 */
    const dir = mkdtempSync(join(tmpdir(), 'dsh-hooks-claude-'))
    dirs.push(dir)
    /** 中文说明：测试局部值 block，由紧邻初始化决定。 */
    const block = join(dir, 'block.sh')
    writeFileSync(block, '#!/usr/bin/env bash\necho "prompt denied by policy" >&2\nexit 2\n')
    chmodSync(block, 0o755)
    writeFileSync(join(dir, 'hooks.json'), JSON.stringify({ hooks: { UserPromptSubmit: [{ matcher: '[', hooks: [{ type: 'command', command: block }] }] } }))

    /** 中文说明：测试局部值 adapter，由紧邻初始化决定。 */
    const adapter = new MockAdapter([textResponse('should not run')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness(dir, adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'do something' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    // The prompt was blocked inside its turn before any model step.
    expect(adapter.requests).toHaveLength(0)
    expect(events(agent).filter(e => e.type === 'turn/start' || e.type === 'hook/invoked'
      || e.type === 'hook/result' || e.type === 'turn/end').map(e => e.type))
      .toEqual(['turn/start', 'hook/invoked', 'hook/result', 'turn/end'])
  })

  it('a UserPromptSubmit hook printing additionalContext injects it for the model', async () => {
    /** 中文说明：测试局部值 dir，由紧邻初始化决定。 */
    const dir = mkdtempSync(join(tmpdir(), 'dsh-hooks-claude-'))
    dirs.push(dir)
    /** 中文说明：测试局部值 ctxScript，由紧邻初始化决定。 */
    const ctxScript = join(dir, 'ctx.sh')
    writeFileSync(ctxScript, '#!/usr/bin/env bash\necho \'{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"remember: be brief"}}\'\n')
    chmodSync(ctxScript, 0o755)
    writeFileSync(join(dir, 'hooks.json'), JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: ctxScript }] }] } }))

    /** 中文说明：测试局部值 adapter，由紧邻初始化决定。 */
    const adapter = new MockAdapter([textResponse('ok')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness(dir, adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    // The injected context reached the model and is recorded with the plugin source.
    expect(JSON.stringify(adapter.requests[0]!.messages)).toContain('remember: be brief')
    /** 中文说明：测试局部值 ctxMsg，由紧邻初始化决定。 */
    const ctxMsg = events(agent).find(e => e.type === 'user/message' && e.data.source.kind !== 'user')
    expect(ctxMsg?.type === 'user/message' && ctxMsg.data.source).toEqual({ kind: 'plugin', plugin: 'hooks-claude-code' })
  })
})

describe('hooks-claude-code bridge — PreToolUse', () => {
  it('a matching PreToolUse hook that exits 2 denies the tool (isError result), tool never runs', async () => {
    /** 中文说明：测试局部值 dir，由紧邻初始化决定。 */
    const dir = mkdtempSync(join(tmpdir(), 'dsh-hooks-claude-'))
    dirs.push(dir)
    /** 中文说明：测试局部值 deny，由紧邻初始化决定。 */
    const deny = join(dir, 'deny.sh')
    writeFileSync(deny, '#!/usr/bin/env bash\necho "danger tool blocked" >&2\nexit 2\n')
    chmodSync(deny, 0o755)
    // Matcher "danger" (literal) selects only the danger tool.
    writeFileSync(join(dir, 'hooks.json'), JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'danger', hooks: [{ type: 'command', command: deny }] }] } }))

    /** 中文说明：测试局部值 adapter，由紧邻初始化决定。 */
    const adapter = new MockAdapter([toolCallResponse('c1', 'danger', {}), textResponse('done')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness(dir, adapter)
    /** 中文说明：测试局部值 ran，由紧邻初始化决定。 */
    let ran = false
    ctx.tools.register(defineContentToolFixture({ name: 'danger', description: 'd', parameters: {}, async execute() { ran = true; return [{ type: 'text', text: 'should not run' }] } }))
    /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'use danger' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(ran).toBe(false)
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = events(agent).find(e => e.type === 'tool/result')
    expect(result?.type === 'tool/result' && result.data.message.content[0].isError).toBe(true)
    expect(result?.type === 'tool/result' && result.data.message.content[0].content.some(b => b.type === 'text' && b.text.includes('danger tool blocked'))).toBe(true)
  })

  it('a PreToolUse hook whose matcher does NOT match leaves the tool alone', async () => {
    /** 中文说明：测试局部值 dir，由紧邻初始化决定。 */
    const dir = mkdtempSync(join(tmpdir(), 'dsh-hooks-claude-'))
    dirs.push(dir)
    /** 中文说明：测试局部值 deny，由紧邻初始化决定。 */
    const deny = join(dir, 'deny.sh')
    writeFileSync(deny, '#!/usr/bin/env bash\nexit 2\n')
    chmodSync(deny, 0o755)
    // Matcher only targets "danger" — the "safe" tool is untouched.
    writeFileSync(join(dir, 'hooks.json'), JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'danger', hooks: [{ type: 'command', command: deny }] }] } }))

    /** 中文说明：测试局部值 adapter，由紧邻初始化决定。 */
    const adapter = new MockAdapter([toolCallResponse('c1', 'safe', {}), textResponse('done')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness(dir, adapter)
    /** 中文说明：测试局部值 ran，由紧邻初始化决定。 */
    let ran = false
    ctx.tools.register(defineContentToolFixture({ name: 'safe', description: 's', parameters: {}, async execute() { ran = true; return [{ type: 'text', text: 'ran ok' }] } }))
    /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'use safe' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(ran).toBe(true)
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = events(agent).find(e => e.type === 'tool/result')
    expect(result?.type === 'tool/result' && result.data.message.content[0].isError).toBe(false)
  })
})

describe('hooks-claude-code bridge — PostToolUse', () => {
  it('a PostToolUse hook that blocks (exit 2) turns the result into an isError with feedback', async () => {
    /** 中文说明：测试局部值 dir，由紧邻初始化决定。 */
    const dir = mkdtempSync(join(tmpdir(), 'dsh-hooks-claude-'))
    dirs.push(dir)
    /** 中文说明：测试局部值 block，由紧邻初始化决定。 */
    const block = join(dir, 'block.sh')
    writeFileSync(block, '#!/usr/bin/env bash\necho "output rejected, retry" >&2\nexit 2\n')
    chmodSync(block, 0o755)
    writeFileSync(join(dir, 'hooks.json'), JSON.stringify({ hooks: { PostToolUse: [{ hooks: [{ type: 'command', command: block }] }] } }))

    /** 中文说明：测试局部值 adapter，由紧邻初始化决定。 */
    const adapter = new MockAdapter([toolCallResponse('c1', 'echo', {}), textResponse('done')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness(dir, adapter)
    ctx.tools.register(defineContentToolFixture({ name: 'echo', description: 'e', parameters: {}, async execute() { return [{ type: 'text', text: 'raw output' }] } }))
    /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = events(agent).find(e => e.type === 'tool/result')
    // PostToolUse blocks AFTER the tool ran: the result is rewritten to isError + feedback.
    expect(result?.type === 'tool/result' && result.data.message.content[0].isError).toBe(true)
    expect(result?.type === 'tool/result' && result.data.message.content[0].content.some(b => b.type === 'text' && b.text.includes('output rejected, retry'))).toBe(true)
  })

  it('a PostToolUse hook printing additionalContext attaches it after the tool result', async () => {
    /** 中文说明：测试局部值 dir，由紧邻初始化决定。 */
    const dir = mkdtempSync(join(tmpdir(), 'dsh-hooks-claude-'))
    dirs.push(dir)
    /** 中文说明：测试局部值 s，由紧邻初始化决定。 */
    const s = join(dir, 'ctx.sh')
    writeFileSync(s, '#!/usr/bin/env bash\necho \'{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"note: tool was slow"}}\'\n')
    chmodSync(s, 0o755)
    writeFileSync(join(dir, 'hooks.json'), JSON.stringify({ hooks: { PostToolUse: [{ hooks: [{ type: 'command', command: s }] }] } }))

    /** 中文说明：测试局部值 adapter，由紧邻初始化决定。 */
    const adapter = new MockAdapter([toolCallResponse('c1', 'echo', {}), textResponse('done')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness(dir, adapter)
    ctx.tools.register(defineContentToolFixture({ name: 'echo', description: 'e', parameters: {}, async execute() { return [{ type: 'text', text: 'ok' }] } }))
    /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    /** 中文说明：测试局部值 log，由紧邻初始化决定。 */
    const log = events(agent)
    /** 中文说明：测试局部值 resultIdx，由紧邻初始化决定。 */
    const resultIdx = log.findIndex(e => e.type === 'tool/result')
    /** 中文说明：测试局部值 ctxIdx，由紧邻初始化决定。 */
    const ctxIdx = log.findIndex(e => e.type === 'user/message' && e.data.source.kind !== 'user')
    expect(ctxIdx).toBeGreaterThan(resultIdx) // context appended AFTER the tool result
    /** 中文说明：测试局部值 ctxMsg，由紧邻初始化决定。 */
    const ctxMsg = log[ctxIdx]
    expect(ctxMsg?.type === 'user/message' && ctxMsg.data.content.some(b => b.type === 'text' && b.text.includes('tool was slow'))).toBe(true)
  })

  it('a PreToolUse permissionDecision:ask fails closed without an approval service', async () => {
    /** 中文说明：测试局部值 dir，由紧邻初始化决定。 */
    const dir = mkdtempSync(join(tmpdir(), 'dsh-hooks-claude-'))
    dirs.push(dir)
    /** 中文说明：测试局部值 s，由紧邻初始化决定。 */
    const s = join(dir, 'ask.sh')
    writeFileSync(s, '#!/usr/bin/env bash\necho \'{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"needs approval"}}\'\n')
    chmodSync(s, 0o755)
    writeFileSync(join(dir, 'hooks.json'), JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: s }] }] } }))

    /** 中文说明：测试局部值 adapter，由紧邻初始化决定。 */
    const adapter = new MockAdapter([toolCallResponse('c1', 'echo', {}), textResponse('done')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness(dir, adapter)
    /** 中文说明：测试局部值 ran，由紧邻初始化决定。 */
    let ran = false
    ctx.tools.register(defineContentToolFixture({ name: 'echo', description: 'e', parameters: {}, async execute() { ran = true; return [{ type: 'text', text: 'x' }] } }))
    /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    // No approval service is mounted, so `ask` fails closed: the tool does not run and the result is isError.
    expect(ran).toBe(false)
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = events(agent).find(e => e.type === 'tool/result')
    expect(result?.type === 'tool/result' && result.data.message.content[0].isError).toBe(true)
    expect(result?.type === 'tool/result' && result.data.message.content[0].content.some(b => b.type === 'text' && b.text.includes('needs approval'))).toBe(true)
  })
})

describe('hooks-claude-code bridge — SessionStart', () => {
  it('a SessionStart hook injects additionalContext the first request sees', async () => {
    /** 中文说明：测试局部值 dir，由紧邻初始化决定。 */
    const dir = mkdtempSync(join(tmpdir(), 'dsh-hooks-claude-'))
    dirs.push(dir)
    /** 中文说明：测试局部值 s，由紧邻初始化决定。 */
    const s = join(dir, 'start.sh')
    writeFileSync(s, '#!/usr/bin/env bash\necho \'{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"project uses tabs"}}\'\n')
    chmodSync(s, 0o755)
    // matcher 'startup' selects the startup source.
    writeFileSync(join(dir, 'hooks.json'), JSON.stringify({ hooks: { SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: s }] }] } }))

    /** 中文说明：测试局部值 adapter，由紧邻初始化决定。 */
    const adapter = new MockAdapter([textResponse('ok')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness(dir, adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    // session-start fires async (detached .then → agent.inject); injection now
    // enters the next-step inbox directly and becomes a user/message only after
    // step entry, so synchronize on the pending inbox item before sending.
    await waitFor(() => agent.inbox.nextStep.some(message =>
      message.content.some(block => block.type === 'text' && block.text.includes('project uses tabs'))))
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(JSON.stringify(adapter.requests[0]!.messages)).toContain('project uses tabs')
  })
})

describe('hooks-claude-code bridge — SubagentStart / SubagentStop (observe)', () => {
  it('runs SubagentStart and SubagentStop hooks when the subagent lifecycle events fire', async () => {
    /** 中文说明：测试局部值 dir，由紧邻初始化决定。 */
    const dir = mkdtempSync(join(tmpdir(), 'dsh-hooks-claude-'))
    dirs.push(dir)
    // Each hook touches a marker file so we can assert it ran (these events are
    // observe-only — there is no decision to assert, only the side effect).
    /** 中文说明：测试局部值 startMarker，由紧邻初始化决定。 */
    const startMarker = join(dir, 'start-ran')
    /** 中文说明：测试局部值 stopMarker，由紧邻初始化决定。 */
    const stopMarker = join(dir, 'stop-ran')
    /** 中文说明：测试局部值 startHook，由紧邻初始化决定。 */
    const startHook = join(dir, 'start.sh')
    /** 中文说明：测试局部值 stopHook，由紧邻初始化决定。 */
    const stopHook = join(dir, 'stop.sh')
    writeFileSync(startHook, `#!/usr/bin/env bash\ntouch "${startMarker}"\n`)
    writeFileSync(stopHook, `#!/usr/bin/env bash\ntouch "${stopMarker}"\n`)
    chmodSync(startHook, 0o755)
    chmodSync(stopHook, 0o755)
    writeFileSync(join(dir, 'hooks.json'), JSON.stringify({ hooks: {
      SubagentStart: [{ hooks: [{ type: 'command', command: startHook }] }],
      SubagentStop: [{ hooks: [{ type: 'command', command: stopHook }] }],
    } }))

    /** 中文说明：测试局部值 adapter，由紧邻初始化决定。 */
    const adapter = new MockAdapter([])
    /** 中文说明：测试局部值 { ctx, hooks }，由紧邻初始化决定。 */
    const { ctx, hooks } = await harnessWithFiber(dir, adapter)
    // Drive the observe-only lifecycle events directly (no real child needed — the
    // bridge just listens). No child agent is registered, so SubagentStart's
    // child lookup yields undefined and it simply runs the hook.
    ctx.emit(subagentCarrier(ctx), 'subagent/start', { runId: SubagentRunId('run-1'), provider: 'inproc', id: SessionId('child-1'), local: false })
    ctx.emit(subagentCarrier(ctx), 'subagent/end', { runId: SubagentRunId('run-1'), provider: 'inproc', id: SessionId('child-1'), local: false, stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: 'done' }] })

    // Both hooks run async (detached .then); poll for their marker files rather
    // than a fixed sleep that flakes under load.
    await waitFor(() => existsSync(startMarker) && existsSync(stopMarker))
    expect(existsSync(startMarker)).toBe(true)
    expect(existsSync(stopMarker)).toBe(true)
    // The markers prove the hook PROCESSES ran, not that the detached `.then`
    // continuations did (`touch` lands before the process exits). Dispose drains
    // them, so the no-context arm of the SubagentStart continuation — covered
    // only here — executes before this file's coverage snapshot instead of
    // racing it (the arm went uncovered on a loaded CI runner and failed the
    // per-file 100% branch gate).
    await hooks.dispose()
  })

  it('disposing the bridge aborts a still-running hook and drains to quiescence', async () => {
    /** 中文说明：测试局部值 dir，由紧邻初始化决定。 */
    const dir = mkdtempSync(join(tmpdir(), 'dsh-hooks-claude-'))
    dirs.push(dir)
    /** 中文说明：测试局部值 pidFile，由紧邻初始化决定。 */
    const pidFile = join(dir, 'pid')
    /** 中文说明：测试局部值 marker，由紧邻初始化决定。 */
    const marker = join(dir, 'started')
    /** 中文说明：测试局部值 slowHook，由紧邻初始化决定。 */
    const slowHook = join(dir, 'slow.sh')
    // Record the hook shell's PID and touch the marker FIRST so the test can
    // tell "the hook is genuinely mid-run", then sleep far past the suite
    // timeout. Dispose must KILL the process (the tracker's abort signal), not
    // await its exit or its 10-minute default hook timeout.
    writeFileSync(slowHook, `#!/usr/bin/env bash\necho $$ > "${pidFile}"\ntouch "${marker}"\nsleep 30\n`)
    chmodSync(slowHook, 0o755)
    writeFileSync(join(dir, 'hooks.json'), JSON.stringify({ hooks: {
      SubagentStart: [{ hooks: [{ type: 'command', command: slowHook }] }],
    } }))

    /** 中文说明：测试局部值 { ctx, hooks }，由紧邻初始化决定。 */
    const { ctx, hooks } = await harnessWithFiber(dir, new MockAdapter([]))
    /** 中文说明：测试局部值 warn，由紧邻初始化决定。 */
    const warn = vi.fn()
    ctx.logger.warn = warn as never
    ctx.emit(subagentCarrier(ctx), 'subagent/start', { runId: SubagentRunId('run-1'), provider: 'inproc', id: SessionId('child-1'), local: false })
    await waitFor(() => existsSync(marker))
    /** 中文说明：测试局部值 pid，由紧邻初始化决定。 */
    const pid = Number(readFileSync(pidFile, 'utf8').trim())
    await hooks.dispose()
    // Quiescence, not just promptness: the drain resolves only after the run
    // settled, and the run settles only after the killed process was reaped —
    // so by the time dispose returns, the PID must be GONE (kill(pid, 0)
    // throws ESRCH). An untracked fire-and-forget regression would leave the
    // process alive (or unreaped) and fail this deterministically.
    expect(() => process.kill(pid, 0)).toThrow()
    // The aborted run resolves as a non-blocking error (runHook never rejects),
    // so the drained continuation must NOT have logged a failure.
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('SubagentStart hook failed'))
  })
})

describe('hooks-claude-code bridge — load resilience', () => {
  it('a missing config file registers no hooks and does not crash the loop', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定。 */
    const adapter = new MockAdapter([textResponse('fine')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(LocalBashExecutor, { timeoutMs: 10_000 })
    await ctx.plugin(HooksClaude, { configPath: '/nonexistent/hooks.json' })
    ctx.llm.registerAdapter(['mock'], adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    // The turn ran normally — no hooks, no crash.
    expect(adapter.requests).toHaveLength(1)
  })

  it('an invalid regex matcher is reported and registers no hooks', async () => {
    /** 中文说明：测试局部值 dir，由紧邻初始化决定。 */
    const dir = writeConfig({
      UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'exit 2' }] }],
      PreToolUse: [{ matcher: '(', hooks: [{ type: 'command', command: 'exit 2' }] }],
    })
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定。 */
    const adapter = new MockAdapter([textResponse('fine')])
    /** 中文说明：测试局部值 warn，由紧邻初始化决定。 */
    const warn = vi.fn()
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness(dir, adapter, (ctx) => { ctx.logger.warn = warn as never })
    /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
    const agent = ctx.agentLoop.create(SessionId('invalid-claude-matcher'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    expect(adapter.requests).toHaveLength(1)
    expect(events(agent).some(event => event.type === 'hook/invoked')).toBe(false)

    expect(warn).toHaveBeenCalledWith(expect.stringContaining(
      'invalid claude-code regex matcher "(" on event "PreToolUse"',
    ))
  })

  it('an invalid matcher on an unsupported event does not disable supported hooks', async () => {
    /** 中文说明：测试局部值 dir，由紧邻初始化决定。 */
    const dir = writeConfig({
      Setup: [{ matcher: '(', hooks: [{ type: 'command', command: 'exit 0' }] }],
      UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'exit 2' }] }],
    })
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定。 */
    const adapter = new MockAdapter([textResponse('should not run')])
    /** 中文说明：测试局部值 warn，由紧邻初始化决定。 */
    const warn = vi.fn()
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness(dir, adapter, (ctx) => { ctx.logger.warn = warn as never })
    /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
    const agent = ctx.agentLoop.create(SessionId('unsupported-claude-matcher'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(adapter.requests).toHaveLength(0)
    expect(events(agent).filter(event => event.type === 'turn/start' || event.type === 'hook/invoked'
      || event.type === 'hook/result' || event.type === 'turn/end').map(event => event.type))
      .toEqual(['turn/start', 'hook/invoked', 'hook/result', 'turn/end'])
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('invalid claude-code regex matcher'))
  })

  it('disposing the bridge fiber removes its listeners (HMR safety)', async () => {
    // A BLOCKING UserPromptSubmit hook: if the listener leaked past dispose it
    // would veto the prompt (0 model requests) and log a hook/invoked. Build the
    // ctx WITHOUT the harness's own bridge mount so this is the ONLY mount, then
    // dispose it — a leaked listener fails the test (a no-op `true` hook would
    // pass even leaked, so it proved nothing).
    /** 中文说明：测试局部值 dir，由紧邻初始化决定。 */
    const dir = writeConfig({ UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'exit 2' }] }] })
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定。 */
    const adapter = new MockAdapter([textResponse('ok')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(LocalBashExecutor, { timeoutMs: 10_000 })
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = await ctx.plugin(HooksClaude, { configPath: join(dir, 'hooks.json') })
    await fiber.dispose()
    ctx.llm.registerAdapter(['mock'], adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    expect(adapter.requests).toHaveLength(1) // not blocked → the listener is gone
    expect(events(agent).some(e => e.type === 'hook/invoked')).toBe(false) // no hook ran
  })

  it('has the namespace-plugin export shape (no stray default) so the Loader keeps name/inject/apply', () => {
    // Postmortem 0001 guard: this plugin HAS `inject = ['bash']`, so a stray
    // `export default apply` would collapse the module via `unwrapExports`
    // (`exports.default ?? exports`), DROP `inject`, and crash at load with
    // "cannot get property … without inject". Guard the shape directly.
    expect('default' in HooksClaude).toBe(false)
    expect(HooksClaude.name).toBe('hooks-claude-code')
    expect(HooksClaude.inject).toEqual(['shell'])
    /** 中文说明：测试局部值 loader，由紧邻初始化决定。 */
    const loader = Object.create(Loader.prototype) as Loader
    /** 中文说明：测试局部值 unwrapped，由紧邻初始化决定。 */
    const unwrapped = loader.unwrapExports(HooksClaude) as Record<string, unknown>
    expect(unwrapped).toBe(HooksClaude)
    expect(unwrapped.name).toBe('hooks-claude-code')
    expect(unwrapped.inject).toEqual(['shell'])
    expect(typeof unwrapped.apply).toBe('function')
  })
})
