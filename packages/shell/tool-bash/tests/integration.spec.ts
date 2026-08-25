/**
 * 文件职责：验证 integration.spec.ts 覆盖的Shell 命令与沙箱行为、并发与异常场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、临时文件系统或受控子进程。
 * 产品维度：保障 Agent 的Shell 命令与沙箱能力稳定、安全且可诊断。
 * 逻辑维度：准备配置和测试资源，执行被测流程，再核对结果、错误与资源清理。
 * 关键边界：并发写入和进程退出可能竞态；敏感配置不得泄露；资源必须等待完全停止。
 * 新手阅读建议：先看夹具与平台条件，再读正常场景，最后关注并发、安全与失败路径。
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import * as ToolTasks from '@deepseek-ai/dsh-tool-jobs'
import { LocalBashExecutor } from '@deepseek-ai/dsh-bash-local'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import * as ToolBash from '@deepseek-ai/dsh-tool-bash'
import * as BashEnvPlugin from '@deepseek-ai/dsh-shell-env'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

/**
 * Full-loop integration: a scripted mock model drives the REAL bash tool
 * through the agent loop, exercising the same execution paths a live model would
 * (tool/call + tool/result session events, the generic `ctx.jobs` runtime,
 * agent.inject completion notices).
 */
/* 中文说明：函数 harness 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function harness(adapter: MockAdapter, sessionRoot?: string, dshHome?: string) {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  if (sessionRoot !== undefined) {
    await ctx.plugin(JsonlSessionPersistence, { root: sessionRoot, compression: 'none' })
  }
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(LocalJobRegistry)
  await ctx.plugin(ToolTasks)
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(BashEnvPlugin, dshHome === undefined ? {} : { dshHome })
  await ctx.plugin(LocalBashExecutor, { timeoutMs: 10_000 })
  await ctx.plugin(ToolBash)
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

/** 中文说明：变量 dirs 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const dirs: string[] = []
afterEach(() => {
  vi.unstubAllEnvs()
  /** 中文说明：该循环依次处理测试数据；循环变量仅在当前循环中有效。 */
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** 中文说明：函数 waitForIdle 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    /** 中文说明：函数值 dispose 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}

/** 中文说明：函数 events 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function events(agent: Agent): SessionEvent[] {
  return [...agent.session.events]
}

/** Find a session event by type, narrowed; throws when absent. */
/* 中文说明：函数 findEvent 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function findEvent<T extends SessionEvent['type']>(
  log: SessionEvent[],
  type: T,
  position: 'first' | 'last' = 'first',
): Extract<SessionEvent, { type: T }> {
  /** 中文说明：变量 found 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const found = position === 'first'
    ? log.find(event => event.type === type)
    : log.findLast(event => event.type === type)
  if (!found) throw new Error(`no ${type} event in the session log`)
  return found as Extract<SessionEvent, { type: T }>
}

/** 中文说明：函数 resultText 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function resultText(event: SessionEvent): string {
  if (event.type !== 'tool/result') return ''
  return event.data.message.content[0].content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

/** Poll until `predicate` holds (background settlement races turn end). */
/* 中文说明：函数 pollUntil 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function pollUntil(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  /** 中文说明：变量 deadline 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(`condition not met within ${timeoutMs}ms`)
}

describe('bash tool through the agent loop', () => {
  it('first-turn bash receives session identity before the lazy JSONL file materializes', async () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = mkdtempSync(join(tmpdir(), 'dsh-bash-session-env-'))
    dirs.push(root)
    /** 中文说明：变量 dshHome 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dshHome = join(root, 'dsh-home')
    vi.stubEnv('DSH_STALE_PARENT', 'stale')
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new MockAdapter([
      toolCallResponse('call-1', 'bash', {
        command: 'printf \'%s\\n%s\\n%s\\n%s\\n%s\\n\' "$DSH_HOME" "$DSH_SHELL" "$DSH_SESSION_ID" "$DSH_SESSION_JSONL" "${DSH_STALE_PARENT-unset}"; if [ -e "$DSH_SESSION_JSONL" ]; then printf \'present\\n\'; else printf \'absent\\n\'; fi',
        description: 'inspect session environment',
      }),
      textResponse('Session environment inspected.'),
    ])
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await harness(adapter, root, dshHome)
    /** 中文说明：变量 handle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const handle = await ctx.agents.create({
      sessionId: SessionId('session-env-id'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    /** 中文说明：变量 agent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const agent = handle.agent
    /** 中文说明：变量 location 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const location = ctx.sessionPersistence.locate(agent.session.header)
    expect(location?.kind).toBe('jsonl')

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'inspect the current session' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = findEvent(events(agent), 'tool/result')
    expect(resultText(result)).toBe(`${dshHome}\n1\nsession-env-id\n${location?.path}\nunset\nabsent\n`)
    await ctx.sessions.flush(agent.session)
    expect(existsSync(location!.path)).toBe(true)
    /** 中文说明：变量 header 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const header = JSON.parse(readFileSync(location!.path, 'utf8').split('\n')[0]!) as { type: string; id: string }
    expect(header).toMatchObject({ type: 'session', id: 'session-env-id' })
    await handle.dispose()
  })

  it('foreground: model calls bash, sees the result, replies', async () => {
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new MockAdapter([
      toolCallResponse('call-1', 'bash', { command: 'echo integration-ok', description: 'test command' }, 'Running it.'),
      textResponse('The command printed integration-ok.'),
    ])
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await harness(adapter)
    /** 中文说明：变量 agent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const agent = ctx.agentLoop.create(SessionId('it-fg'), { provider: 'mock', model: 'mock' })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'run echo integration-ok' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    /** 中文说明：变量 log 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const log = events(agent)
    /** 中文说明：变量 toolCall 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const toolCall = findEvent(log, 'tool/call')
    expect(toolCall.data.name).toBe('bash')

    /** 中文说明：变量 toolResult 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const toolResult = findEvent(log, 'tool/result')
    expect(toolResult.data.message.content[0].isError).toBe(false)
    expect(resultText(toolResult)).toBe('integration-ok\n')

    // The second model call saw the tool result in its derived history.
    /** 中文说明：变量 lastRequest 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const lastRequest = adapter.requests.at(-1)
    /** 中文说明：变量 toolResultBlocks 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const toolResultBlocks = (lastRequest?.messages ?? [])
      .flatMap(message => message.content)
      .filter(block => block.type === 'tool-result')
    expect(toolResultBlocks).toHaveLength(1)

    /** 中文说明：变量 finalMessage 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const finalMessage = findEvent(log, 'assistant/message', 'last')
    expect(finalMessage.data.message.content.some(
      block => block.type === 'text' && block.text.includes('integration-ok'),
    )).toBe(true)
  })

  it('foreground: non-zero exit is reported in the result text, not as isError', async () => {
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new MockAdapter([
      toolCallResponse('call-1', 'bash', { command: 'exit 9', description: 'test command' }),
      textResponse('It failed with code 9.'),
    ])
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await harness(adapter)
    /** 中文说明：变量 agent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const agent = ctx.agentLoop.create(SessionId('it-exit'), { provider: 'mock', model: 'mock' })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'run exit 9' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    /** 中文说明：变量 toolResult 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const toolResult = findEvent(events(agent), 'tool/result')
    expect(toolResult.data.message.content[0].isError).toBe(false)
    expect(resultText(toolResult)).toContain('[exit code: 9]')
  })

  it('background: start ack → completion wakes the idle agent → job_output collects it', async () => {
    // The command blocks on a sentinel this test creates only after the agent
    // has gone idle, so settlement cannot fold into the still-running turn.
    // Without that fence a fast command can settle before step 2's pre-step
    // claim, which folds the notice into a turn whose scripted reply is final:
    // the turn then closes with an empty next-step inbox and the collection
    // entries are never reached.
    /** 中文说明：变量 dir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dir = mkdtempSync(join(tmpdir(), 'dsh-bg-'))
    dirs.push(dir)
    /** 中文说明：变量 sentinel 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sentinel = join(dir, 'release')
    // The job id is deterministic (a fresh LocalJobRegistry counts per kind from 1),
    // so the script can name `bash-1` without threading a generated id.
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new MockAdapter([
      toolCallResponse('call-1', 'bash', {
        command: `while [ ! -f ${JSON.stringify(sentinel)} ]; do sleep 0.02; done; echo bg-ok`,
        description: 'test command',
        run_in_background: true,
      }),
      textResponse('Started it in the background.'),
      toolCallResponse('call-2', 'job_output', { job_id: 'bash-1' }),
      textResponse('Background job finished.'),
    ])
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await harness(adapter)
    /** 中文说明：变量 agent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const agent = ctx.agentLoop.create(SessionId('it-bg'), { provider: 'mock', model: 'mock' })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'run echo bg-ok in the background' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    /** 中文说明：变量 firstResult 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const firstResult = findEvent(events(agent), 'tool/result')
    expect(firstResult.data.message.content[0].isError).toBe(false)
    expect(resultText(firstResult)).toBe('started background job bash-1')
    // The turn closed with the task still running, so the notice cannot exist yet.
    /** 中文说明：函数值 isNotice 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const isNotice = (e: SessionEvent): e is SessionEvent<'user/message'> =>
      e.type === 'user/message' && e.data.source.kind === 'plugin'
    expect(events(agent).some(isNotice)).toBe(false)

    // Releasing the command now settles it against a provably idle owner. No
    // second user message: the wake alone opens the turn that collects it.
    writeFileSync(sentinel, '')
    /** 中文说明：函数值 lastResultText 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const lastResultText = (): string => {
      /** 中文说明：函数值 found 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
      const found = events(agent).findLast(event => event.type === 'tool/result')
      return found === undefined ? '' : resultText(found)
    }
    await pollUntil(() => events(agent).some(isNotice) && lastResultText().includes('bg-ok'))
    // Two turns: the user's, then the one the completion opened by itself.
    expect(events(agent).filter(event => event.type === 'turn/start')).toHaveLength(2)

    // The notice carries the gated command as its label, so this pins the id,
    // the terminal status, and the producer identity; the verbatim notice text
    // and its bounding are pinned in the tool-jobs unit tests.
    /** 中文说明：变量 notice 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const notice = events(agent).find(isNotice)!
    /** 中文说明：变量 noticeText 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const noticeText = notice.data.content
      .filter(block => block.type === 'text').map(block => block.text).join('')
    expect(noticeText).toContain('background job bash-1 (bash: ')
    expect(noticeText).toContain('finished [status: completed, exit code: 0]')
    expect(notice.data.source).toMatchObject({
      kind: 'plugin',
      plugin: 'tool-jobs',
      form: 'notice',
    })
    /** 中文说明：变量 readResult 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const readResult = findEvent(events(agent), 'tool/result', 'last')
    expect(readResult.data.message.content[0].isError).toBe(false)
    expect(resultText(readResult)).toContain('bg-ok')
    expect(resultText(readResult)).toContain('[status: completed, exit code: 0]')
  })
})
