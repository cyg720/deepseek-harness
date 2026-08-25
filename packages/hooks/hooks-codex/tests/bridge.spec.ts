/**
 * 文件职责：验证Codex Hook 桥的 bridge.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis、Fetch/RPC 信封、运行时模式校验、Node/Windows 宿主接口。
 * 产品维度：保证浏览器 API、Hook 或目录操作在各种状态下可靠且可诊断。
 * 逻辑维度：构造请求与宿主服务，调用端点并断言响应和清理。
 * 关键边界：网络与路径输入必须校验；原生对话框和宿主路径操作只允许受信调用。
 * 新手阅读建议：先读请求/响应夹具，再按 API 域、错误码和生命周期场景阅读。
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { LocalBashExecutor } from '@deepseek-ai/dsh-bash-local'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import * as HooksCodex from '@deepseek-ai/dsh-hooks-codex'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

/**
 * Full-loop Codex bridge tests with a mock model, the real loop and bash
 * executor, and shell hooks from a temporary config. Covers regex matching,
 * block-only decisions, and the five-event subset.
 */

/** 中文说明：测试局部值 dirs，由紧邻初始化决定。 */
const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

/** 中文说明：函数 configDir 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function configDir(): string {
  /** 中文说明：测试局部值 dir，由紧邻初始化决定。 */
  const dir = mkdtempSync(join(tmpdir(), 'dsh-hooks-codex-'))
  dirs.push(dir)
  return dir
}
/** 中文说明：函数 script 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function script(dir: string, name: string, body: string): string {
  /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
  const path = join(dir, name)
  writeFileSync(path, body)
  chmodSync(path, 0o755)
  return path
}
/** 中文说明：函数 writeHooks 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function writeHooks(dir: string, hooks: unknown): void {
  writeFileSync(join(dir, 'hooks.json'), JSON.stringify({ hooks }))
}

/** 中文说明：函数 harness 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function harness(dir: string, adapter: MockAdapter, beforeHooks?: (ctx: Context) => void): Promise<Context> {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(LocalBashExecutor, { timeoutMs: 10_000 })
  beforeHooks?.(ctx)
  await ctx.plugin(HooksCodex, { configPath: join(dir, 'hooks.json'), model: 'test-model' })
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

/** 中文说明：函数 waitForIdle 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function waitForIdle(_ctx: Context, agent: Agent): Promise<void> {
  return agent.whenIdle()
}
/** 中文说明：函数 events 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function events(agent: Agent): SessionEvent[] { return [...agent.session.events] }

/** Poll `predicate` until true or the deadline passes (detached hook effects can't be awaited directly). */
/** 中文说明：函数 waitFor 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function waitFor(predicate: () => boolean, timeout = 5000, interval = 10): Promise<void> {
  /** 中文说明：测试局部值 deadline，由紧邻初始化决定。 */
  const deadline = Date.now() + timeout
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitFor: condition not met before deadline')
    await new Promise(r => setTimeout(r, interval))
  }
}

describe('hooks-codex bridge', () => {
  it('a PreToolUse hook (exit 2) denies a tool the regex matcher matches as a substring', async () => {
    /** 中文说明：测试局部值 dir，由紧邻初始化决定。 */
    const dir = configDir()
    /** 中文说明：测试局部值 deny，由紧邻初始化决定。 */
    const deny = script(dir, 'deny.sh', '#!/usr/bin/env bash\necho "codex blocked it" >&2\nexit 2\n')
    // Codex regex matcher: "Bash" is /Bash/ — matches the tool name "Bash".
    writeHooks(dir, { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: deny }] }] })

    /** 中文说明：测试局部值 adapter，由紧邻初始化决定。 */
    const adapter = new MockAdapter([toolCallResponse('c1', 'Bash', { command: 'ls' }), textResponse('done')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness(dir, adapter)
    /** 中文说明：测试局部值 ran，由紧邻初始化决定。 */
    let ran = false
    ctx.tools.register(defineContentToolFixture({ name: 'Bash', description: 'b', parameters: { command: { type: 'string' } }, async execute() { ran = true; return [{ type: 'text', text: 'no' }] } }))
    /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'run ls' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(ran).toBe(false)
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = events(agent).find(e => e.type === 'tool/result')
    expect(result?.type === 'tool/result' && result.data.message.content[0].isError).toBe(true)
    expect(result?.type === 'tool/result' && result.data.message.content[0].content.some(b => b.type === 'text' && b.text.includes('codex blocked it'))).toBe(true)
    expect(events(agent).some(e => e.type === 'hook/invoked' && e.data.dialect === 'codex' && e.data.point === 'PreToolUse')).toBe(true)
  })

  it('a Stop hook (exit 2) forces the turn to continue with the reason as steering', async () => {
    /** 中文说明：测试局部值 dir，由紧邻初始化决定。 */
    const dir = configDir()
    // Stop ignores its malformed matcher field. Block once with a marker;
    // until the loop guard lands, an always-blocking hook would never finish.
    /** 中文说明：测试局部值 marker，由紧邻初始化决定。 */
    const marker = join(dir, 'fired')
    /** 中文说明：测试局部值 cont，由紧邻初始化决定。 */
    const cont = script(dir, 'cont.sh', `#!/usr/bin/env bash\nif [ -e "${marker}" ]; then exit 0; fi\ntouch "${marker}"\necho "keep going: address the goal" >&2\nexit 2\n`)
    writeHooks(dir, { Stop: [{ matcher: '[', hooks: [{ type: 'command', command: cont }] }] })

    /** 中文说明：测试局部值 adapter，由紧邻初始化决定。 */
    const adapter = new MockAdapter([textResponse('first answer'), textResponse('second answer after goal')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness(dir, adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(adapter.requests).toHaveLength(2)
    expect(JSON.stringify(adapter.requests[1]!.messages)).toContain('keep going: address the goal')
  }, 15_000) // Two real hook subprocesses and agent steps need startup and teardown headroom under load.

  it('turn cancellation aborts and reaps a running UserPromptSubmit hook before idle', async () => {
    /** 中文说明：测试局部值 dir，由紧邻初始化决定。 */
    const dir = configDir()
    /** 中文说明：测试局部值 pidFile，由紧邻初始化决定。 */
    const pidFile = join(dir, 'pid')
    /** 中文说明：测试局部值 marker，由紧邻初始化决定。 */
    const marker = join(dir, 'started')
    /** 中文说明：测试局部值 slow，由紧邻初始化决定。 */
    const slow = script(dir, 'slow-prompt.sh', `#!/usr/bin/env bash\necho $$ > "${pidFile}"\ntouch "${marker}"\nsleep 30\n`)
    writeHooks(dir, { UserPromptSubmit: [{ hooks: [{ type: 'command', command: slow }] }] })

    /** 中文说明：测试局部值 adapter，由紧邻初始化决定。 */
    const adapter = new MockAdapter([textResponse('must not run')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness(dir, adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
    const agent = ctx.agentLoop.create(SessionId('cancel-prompt-hook'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'cancel the hook' }], source: { kind: 'user' } }))
    await waitFor(() => existsSync(marker))
    /** 中文说明：测试局部值 pid，由紧邻初始化决定。 */
    const pid = Number(readFileSync(pidFile, 'utf8').trim())

    /** 中文说明：测试局部值 idle，由紧邻初始化决定。 */
    const idle = agent.whenIdle()
    agent.cancel({ kind: 'user' })
    await idle

    expect(() => process.kill(pid, 0)).toThrow()
    expect(adapter.requests).toHaveLength(0)
    expect(events(agent).filter(event => event.type === 'turn/start' || event.type === 'hook/invoked'
      || event.type === 'hook/result' || event.type === 'turn/end').map(event => event.type))
      .toEqual(['turn/start', 'hook/invoked', 'hook/result', 'turn/end'])
  })

  it('only the five bridge-supported Codex events are honored — a SubagentStop entry is ignored', async () => {
    /** 中文说明：测试局部值 dir，由紧邻初始化决定。 */
    const dir = configDir()
    /** 中文说明：测试局部值 s，由紧邻初始化决定。 */
    const s = script(dir, 'x.sh', '#!/usr/bin/env bash\nexit 2\n')
    writeHooks(dir, { SubagentStop: [{ hooks: [{ type: 'command', command: s }] }] })

    /** 中文说明：测试局部值 adapter，由紧邻初始化决定。 */
    const adapter = new MockAdapter([textResponse('fine')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness(dir, adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    expect(adapter.requests).toHaveLength(1)
  })

  it('a missing config registers no hooks and does not crash', async () => {
    /** 中文说明：测试局部值 dir，由紧邻初始化决定。 */
    const dir = configDir() // no hooks.json written
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定。 */
    const adapter = new MockAdapter([textResponse('ok')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness(dir, adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    expect(adapter.requests).toHaveLength(1)
  })

  it('an invalid regex matcher is reported and registers no hooks', async () => {
    /** 中文说明：测试局部值 dir，由紧邻初始化决定。 */
    const dir = configDir()
    writeHooks(dir, {
      UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'exit 2' }] }],
      PreToolUse: [{ matcher: '[', hooks: [{ type: 'command', command: 'exit 2' }] }],
    })
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定。 */
    const adapter = new MockAdapter([textResponse('ok')])
    /** 中文说明：测试局部值 warn，由紧邻初始化决定。 */
    const warn = vi.fn()
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness(dir, adapter, (ctx) => { ctx.logger.warn = warn as never })
    /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
    const agent = ctx.agentLoop.create(SessionId('invalid-codex-matcher'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    expect(adapter.requests).toHaveLength(1)
    expect(events(agent).some(event => event.type === 'hook/invoked')).toBe(false)

    expect(warn).toHaveBeenCalledWith(expect.stringContaining(
      'invalid codex regex matcher "[" on event "PreToolUse"',
    ))
  })

  it('disposing the bridge fiber removes its listeners (HMR safety)', async () => {
    /** 中文说明：测试局部值 dir，由紧邻初始化决定。 */
    const dir = configDir()
    // A leaked listener would let this blocking hook veto the prompt and log an invocation; a
    // no-op hook would pass even when leaked.
    /** 中文说明：测试局部值 deny，由紧邻初始化决定。 */
    const deny = script(dir, 'deny.sh', '#!/usr/bin/env bash\nexit 2\n')
    writeHooks(dir, { UserPromptSubmit: [{ hooks: [{ type: 'command', command: deny }] }] })
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定。 */
    const adapter = new MockAdapter([textResponse('ok')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(LocalBashExecutor, { timeoutMs: 10_000 })
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = await ctx.plugin(HooksCodex, { configPath: join(dir, 'hooks.json'), model: 'm' })
    await fiber.dispose()
    ctx.llm.registerAdapter(['mock'], adapter)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    expect(adapter.requests).toHaveLength(1) // not blocked → the listener is gone
    expect(events(agent).some(e => e.type === 'hook/invoked')).toBe(false) // no hook ran
  })

  it('disposing the bridge aborts a still-running SessionStart hook and drains to quiescence', async () => {
    /** 中文说明：测试局部值 dir，由紧邻初始化决定。 */
    const dir = configDir()
    /** 中文说明：测试局部值 pidFile，由紧邻初始化决定。 */
    const pidFile = join(dir, 'pid')
    /** 中文说明：测试局部值 marker，由紧邻初始化决定。 */
    const marker = join(dir, 'started')
    // Record the PID and marker before sleeping past the suite timeout. Disposal must abort the
    // tracked process through `runPoint`, not await its natural exit.
    /** 中文说明：测试局部值 slow，由紧邻初始化决定。 */
    const slow = script(dir, 'slow.sh', `#!/usr/bin/env bash\necho $$ > "${pidFile}"\ntouch "${marker}"\nsleep 30\n`)
    writeHooks(dir, { SessionStart: [{ hooks: [{ type: 'command', command: slow }] }] })
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(LocalBashExecutor, { timeoutMs: 10_000 })
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = await ctx.plugin(HooksCodex, { configPath: join(dir, 'hooks.json'), model: 'm' })
    ctx.llm.registerAdapter(['mock'], new MockAdapter([]))
    /** 中文说明：测试局部值 warn，由紧邻初始化决定。 */
    const warn = vi.fn()
    ctx.logger.warn = warn as never
    ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' }) // fires agent/session-start
    await waitFor(() => existsSync(marker))
    /** 中文说明：测试局部值 pid，由紧邻初始化决定。 */
    const pid = Number(readFileSync(pidFile, 'utf8').trim())
    await fiber.dispose()
    // Disposal reaches quiescence only after the aborted run settles and the process is reaped, so
    // `kill(pid, 0)` must report ESRCH. Untracked fire-and-forget work would remain.
    expect(() => process.kill(pid, 0)).toThrow()
    // runHook resolves an aborted run as a non-blocking error, so draining must
    // not log a rejected continuation.
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('SessionStart hook failed'))
  })

  it('has the namespace-plugin export shape (no stray default) so the Loader keeps name/inject/apply', () => {
    expect('default' in HooksCodex).toBe(false)
    expect(HooksCodex.name).toBe('hooks-codex')
    expect(HooksCodex.inject).toEqual(['shell'])
    /** 中文说明：测试局部值 loader，由紧邻初始化决定。 */
    const loader = Object.create(Loader.prototype) as Loader
    /** 中文说明：测试局部值 unwrapped，由紧邻初始化决定。 */
    const unwrapped = loader.unwrapExports(HooksCodex) as Record<string, unknown>
    expect(unwrapped).toBe(HooksCodex)
    expect(unwrapped.name).toBe('hooks-codex')
    expect(unwrapped.inject).toEqual(['shell'])
    expect(typeof unwrapped.apply).toBe('function')
  })
})
