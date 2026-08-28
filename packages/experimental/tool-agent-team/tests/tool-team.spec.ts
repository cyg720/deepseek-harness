/**
 * 文件职责：验证实验 Tool Team的 tool-team.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis Context、插件生命周期、React 和 Vitest。
 * 产品维度：保证实验 Tool Team在配置、运行、失败和清理场景中可理解且可靠。
 * 逻辑维度：构造插件或沙箱，驱动操作并断言日志与清理。
 * 关键边界：沙箱与宿主 Context 不可混用；反馈追加新记录，不改写既有会话历史。
 * 新手阅读建议：先读类型和夹具，再按注册、执行、错误与卸载流程阅读。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import SubagentService from '@deepseek-ai/dsh-subagent'
import * as SubagentFork from '@deepseek-ai/dsh-subagent-fork-in-process'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import * as ToolSubagentControl from '@deepseek-ai/dsh-tool-subagent-control'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import TeamService from '../../agent-team/src/index.ts'
import * as toolTeam from '../src/index.ts'

/** 中文说明：测试局部值 SIGNAL，由紧邻初始化决定。 */
const SIGNAL = new AbortController().signal
/** 中文说明：测试局部值 TOOL_NAMES，由紧邻初始化决定。 */
const TOOL_NAMES = [
  'spawn_teammate',
  'send_message',
  'followup_task',
  'list_agents',
  'wait_agent',
  'interrupt_agent',
  'team_task_create',
  'team_task_list',
  'team_task_get',
  'team_task_update',
].sort()

/** 中文说明：测试局部值 roots，由紧邻初始化决定。 */
const roots: string[] = []
/** 中文说明：测试局部值 callNumber，由紧邻初始化决定。 */
let callNumber = 0

/** Session query implementation whose search faces are outside these tests. */
class TestSessionQuery extends SessionQueryEngine {
  override searchSessions(): Promise<never> {
    return Promise.reject(new Error('session search is not configured in this test'))
  }

  override searchEvents(): Promise<never> {
    return Promise.reject(new Error('event search is not configured in this test'))
  }
}

afterEach(() => {
  /** 中文说明：测试局部值 root，由紧邻初始化决定。 */
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** 中文说明：函数 setup 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function setup(script: ConstructorParameters<typeof MockAdapter>[0], legacyControl = false) {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  /** 中文说明：测试局部值 storageRoot，由紧邻初始化决定。 */
  const storageRoot = mkdtempSync(join(tmpdir(), 'dsh-tool-team-'))
  roots.push(storageRoot)
  await ctx.plugin(JsonlSessionPersistence, { root: storageRoot })
  await ctx.plugin(TestSessionQuery)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentService)
  if (legacyControl) await ctx.plugin(ToolSubagentControl)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  await ctx.plugin(SubagentFork, { providerName: 'fork' })
  await ctx.plugin(TeamService)
  /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
  const fiber = await ctx.plugin(toolTeam)
  /** 中文说明：测试局部值 adapter，由紧邻初始化决定。 */
  const adapter = new MockAdapter(script)
  ctx.llm.registerAdapter(['mock'], adapter)
  /** 中文说明：测试局部值 lead，由紧邻初始化决定。 */
  const lead = ctx.agentLoop.create(SessionId('tool-team-lead'), { provider: 'mock', model: 'mock' })
  return { ctx, lead, fiber }
}

/** 中文说明：函数 execute 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function execute(
  ctx: Context,
  agent: Agent | undefined,
  name: string,
  args: unknown,
  signal: AbortSignal = SIGNAL,
) {
  return ctx.tools.execute({
    callId: ToolCallId(`team-call-${++callNumber}`),
    name,
    arguments: args,
    signal,
    ...agent === undefined ? {} : { agent },
  })
}

/** 中文说明：函数 text 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function text(result: Awaited<ReturnType<typeof execute>>): string {
  return result.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
}

/** 中文说明：函数 spawnedChildId 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function spawnedChildId(result: Awaited<ReturnType<typeof execute>>): SessionId {
  /** 中文说明：测试局部值 parsed，由紧邻初始化决定。 */
  const parsed: unknown = JSON.parse(text(result))
  if (typeof parsed !== 'object' || parsed === null || !('member' in parsed)) {
    throw new Error('spawn_teammate result has no member')
  }
  /** 中文说明：测试局部值 member，由紧邻初始化决定。 */
  const member = parsed.member
  if (typeof member !== 'object' || member === null || !('id' in member) || typeof member.id !== 'string') {
    throw new Error('spawn_teammate result has no member id')
  }
  return SessionId(member.id)
}

/** 中文说明：函数 assembly 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function assembly(ctx: Context, agent: Agent) {
  /** 中文说明：测试局部值 scope，由紧邻初始化决定。 */
  const scope = scopeOf(agent.ctx)
  if (scope === undefined) throw new Error('expected Agent scope')
  return ctx.systemPrompt.assemble({ scope })
}

/** 中文说明：函数 waitRunning 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function waitRunning(ctx: Context, id: SessionId): Promise<Agent> {
  return vi.waitFor(() => {
    /** 中文说明：测试局部值 child，由紧邻初始化决定。 */
    const child = ctx.agents.get(id)
    expect(child?.status).toBe('running')
    return child!
  }, { timeout: 5_000 })
}

/** 中文说明：函数 waitNoAgent 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function waitNoAgent(ctx: Context, id: SessionId): Promise<void> {
  await vi.waitFor(() => { expect(ctx.agents.get(id)).toBeUndefined() }, { timeout: 5_000 })
}

describe('dsh-tool-team', () => {
  it('installs the complete scoped schema and shared-checkout policy for roots and teammates', async () => {
    /** 中文说明：测试局部值 { ctx, lead }，由紧邻初始化决定。 */
    const { ctx, lead } = await setup(['hang'])
    /** 中文说明：测试局部值 leadAssembly，由紧邻初始化决定。 */
    const leadAssembly = await assembly(ctx, lead)
    expect(leadAssembly.tools.map(schema => schema.name).filter(name => TOOL_NAMES.includes(name)).sort())
      .toEqual(TOOL_NAMES)
    /** 中文说明：测试局部值 leadPrompt，由紧邻初始化决定。 */
    const leadPrompt = renderPrompt(leadAssembly)
    expect(leadPrompt).toContain('create teammates only when the user explicitly asks')
    expect(leadPrompt).toContain('FS_STALE_VERSION')
    expect(leadPrompt).toContain('Bash, formatters, code generators, and scripts are not fully protected')
    expect(leadPrompt).toContain('Task readiness never starts an owner')
    expect(leadPrompt).toContain('returns noProgress immediately')
    expect(leadPrompt).toContain('Your Team role is lead')

    /** 中文说明：测试局部值 spawned，由紧邻初始化决定。 */
    const spawned = await execute(ctx, lead, 'spawn_teammate', {
      name: 'tool-worker',
      description: 'exercise scoped tools',
      prompt: 'stay available',
    })
    expect(spawned.isError).toBe(false)
    /** 中文说明：测试局部值 childId，由紧邻初始化决定。 */
    const childId = spawnedChildId(spawned)
    /** 中文说明：测试局部值 child，由紧邻初始化决定。 */
    const child = await waitRunning(ctx, childId)
    /** 中文说明：测试局部值 childAssembly，由紧邻初始化决定。 */
    const childAssembly = await assembly(ctx, child)
    expect(childAssembly.tools.map(schema => schema.name).filter(name => TOOL_NAMES.includes(name)).sort())
      .toEqual(TOOL_NAMES)
    expect(renderPrompt(childAssembly)).toContain('Your Team role is teammate; your Team name is tool-worker')

    /** 中文说明：测试局部值 denied，由紧邻初始化决定。 */
    const denied = await execute(ctx, child, 'spawn_teammate', {
      name: 'nested', description: 'not allowed', prompt: 'no',
    })
    expect(denied.isError).toBe(true)
    expect(text(denied)).toContain('only the Team Lead')
    await execute(ctx, lead, 'interrupt_agent', { target: 'tool-worker' })
    await vi.waitFor(() => { expect(ctx.agents.get(childId)).toBeUndefined() }, { timeout: 5_000 })
  })

  it('returns actionable no-progress output and renders structured wait cancellation', async () => {
    /** 中文说明：测试局部值 inactiveSetup，由紧邻初始化决定。 */
    const inactiveSetup = await setup([textResponse('worker done')])
    /** 中文说明：测试局部值 inactiveSpawn，由紧邻初始化决定。 */
    const inactiveSpawn = await execute(inactiveSetup.ctx, inactiveSetup.lead, 'spawn_teammate', {
      name: 'inactive-worker', description: 'finish immediately', prompt: 'finish',
    })
    /** 中文说明：测试局部值 inactiveId，由紧邻初始化决定。 */
    const inactiveId = spawnedChildId(inactiveSpawn)
    await waitNoAgent(inactiveSetup.ctx, inactiveId)
    /** 中文说明：测试局部值 noProgress，由紧邻初始化决定。 */
    const noProgress = await execute(inactiveSetup.ctx, inactiveSetup.lead, 'wait_agent', { timeout_ms: 3_600_000 })
    expect(noProgress.isError).toBe(false)
    expect(JSON.parse(text(noProgress))).toEqual({
      timedOut: false,
      noProgress: {
        reason: 'no-active-peer',
        message: 'No other Team member is running or provisioning. wait_agent cannot make progress or wake inactive teammates. Re-list with list_agents and team_task_list, then use followup_task to wake each required inactive teammate before waiting again.',
      },
    })
    /** 中文说明：测试局部值 timeout_ms，由紧邻初始化决定。 */
    for (const timeout_ms of [9_999, 3_600_001, Number.MAX_SAFE_INTEGER + 1]) {
      /** 中文说明：测试局部值 invalid，由紧邻初始化决定。 */
      const invalid = await execute(inactiveSetup.ctx, inactiveSetup.lead, 'wait_agent', { timeout_ms })
      expect(invalid.isError).toBe(true)
      expect(text(invalid)).toContain('timeoutMs must be an integer from 10000 through 3600000')
    }

    /** 中文说明：测试局部值 activeSetup，由紧邻初始化决定。 */
    const activeSetup = await setup(['hang'])
    /** 中文说明：测试局部值 activeSpawn，由紧邻初始化决定。 */
    const activeSpawn = await execute(activeSetup.ctx, activeSetup.lead, 'spawn_teammate', {
      name: 'active-worker', description: 'stay active', prompt: 'wait',
    })
    /** 中文说明：测试局部值 activeId，由紧邻初始化决定。 */
    const activeId = spawnedChildId(activeSpawn)
    await waitRunning(activeSetup.ctx, activeId)
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new AbortController()
    /** 中文说明：测试局部值 waiting，由紧邻初始化决定。 */
    const waiting = execute(activeSetup.ctx, activeSetup.lead, 'wait_agent', { timeout_ms: 10_000 }, controller.signal)
    await new Promise(resolve => setTimeout(resolve, 0))
    controller.abort({ kind: 'user' })
    /** 中文说明：测试局部值 aborted，由紧邻初始化决定。 */
    const aborted = await waiting
    expect(aborted.isError).toBe(true)
    expect(text(aborted)).toBe("Error: wait_agent aborted: { kind: 'user' }")
    await execute(activeSetup.ctx, activeSetup.lead, 'interrupt_agent', { target: 'active-worker' })
    await waitNoAgent(activeSetup.ctx, activeId)
  })

  it('adapts roster, mailbox, wait, and task CAS operations to canonical JSON', async () => {
    /** 中文说明：测试局部值 { ctx, lead }，由紧邻初始化决定。 */
    const { ctx, lead } = await setup(['hang', textResponse('lead received wakeup')])
    /** 中文说明：测试局部值 spawned，由紧邻初始化决定。 */
    const spawned = await execute(ctx, lead, 'spawn_teammate', {
      name: 'json-worker', description: 'json worker', prompt: 'wait', context: 'fresh',
    })
    /** 中文说明：测试局部值 childId，由紧邻初始化决定。 */
    const childId = spawnedChildId(spawned)
    /** 中文说明：测试局部值 child，由紧邻初始化决定。 */
    const child = await waitRunning(ctx, childId)

    /** 中文说明：测试局部值 roster，由紧邻初始化决定。 */
    const roster = await execute(ctx, child, 'list_agents', {})
    expect(JSON.parse(text(roster))).toMatchObject([
      { name: 'lead', role: 'lead' },
      { name: 'json-worker', role: 'teammate' },
    ])
    // Every Team result reaches the model as compact JSON: indentation would
    // spend tokens on every roster, task, and receipt without adding meaning.
    expect(text(roster)).toBe(JSON.stringify(JSON.parse(text(roster))))
    /** 中文说明：测试局部值 peer，由紧邻初始化决定。 */
    const peer = await execute(ctx, child, 'send_message', { target: 'lead', message: 'quiet report' })
    expect(peer.isError).toBe(false)
    expect(JSON.parse(text(peer))).toMatchObject({ status: 'accepted' })
    /** 中文说明：测试局部值 waking，由紧邻初始化决定。 */
    const waking = await execute(ctx, child, 'followup_task', { target: 'lead', message: 'review the report' })
    expect(waking.isError).toBe(false)
    expect(JSON.parse(text(waking))).toMatchObject({ status: 'accepted' })
    await lead.whenIdle()

    /** 中文说明：测试局部值 created，由紧邻初始化决定。 */
    const created = await execute(ctx, lead, 'team_task_create', {
      subject: 'tool task',
      description: 'created through tool',
      blocked_by: [],
      write_scopes: ['src/team'],
    })
    /** 中文说明：测试局部值 task，由紧邻初始化决定。 */
    const task = JSON.parse(text(created)) as { id: string; revision: number }
    /** 中文说明：测试局部值 listed，由紧邻初始化决定。 */
    const listed = await execute(ctx, child, 'team_task_list', { ready: true, limit: 1 })
    expect(JSON.parse(text(listed))).toMatchObject({ tasks: [{ id: task.id, ready: true }] })
    /** 中文说明：测试局部值 read，由紧邻初始化决定。 */
    const read = await execute(ctx, child, 'team_task_get', { task_id: task.id })
    expect(JSON.parse(text(read))).toMatchObject({ id: task.id, revision: 1 })
    /** 中文说明：测试局部值 claimed，由紧邻初始化决定。 */
    const claimed = await execute(ctx, child, 'team_task_update', {
      task_id: task.id,
      expected_revision: task.revision,
      action: 'claim',
    })
    expect(JSON.parse(text(claimed))).toMatchObject({ status: 'in_progress', ownerName: 'json-worker' })
    /** 中文说明：测试局部值 stale，由紧邻初始化决定。 */
    const stale = await execute(ctx, lead, 'team_task_update', {
      task_id: task.id,
      expected_revision: task.revision,
      action: 'delete',
    })
    expect(stale.isError).toBe(true)
    expect(text(stale)).toContain('stale team task')

    /** 中文说明：测试局部值 wait，由紧邻初始化决定。 */
    const wait = execute(ctx, lead, 'wait_agent', { timeout_ms: 10_000 })
    /** 中文说明：测试局部值 completedCall，由紧邻初始化决定。 */
    const completedCall = new Promise<Awaited<ReturnType<typeof execute>>>((resolve, reject) => {
      setTimeout(() => {
        void execute(ctx, child, 'team_task_update', {
          task_id: task.id,
          expected_revision: 2,
          action: 'complete',
        }).then(resolve, reject)
      }, 0)
    })
    await expect(wait).resolves.toMatchObject({ isError: false })
    expect((await completedCall).isError).toBe(false)

    /** 中文说明：测试局部值 childInterrupt，由紧邻初始化决定。 */
    const childInterrupt = await execute(ctx, child, 'interrupt_agent', { target: 'json-worker' })
    expect(childInterrupt.isError).toBe(true)
    await execute(ctx, lead, 'interrupt_agent', { target: 'json-worker' })
    await vi.waitFor(() => { expect(ctx.agents.get(childId)).toBeUndefined() }, { timeout: 5_000 })
  })

  it('adapts optional task filters, mutations, pagination, and default waiting', async () => {
    /** 中文说明：测试局部值 { ctx, lead }，由紧邻初始化决定。 */
    const { ctx, lead } = await setup(['hang'])
    /** 中文说明：测试局部值 spawned，由紧邻初始化决定。 */
    const spawned = await execute(ctx, lead, 'spawn_teammate', {
      name: 'fork-worker', description: 'fork worker', prompt: 'stay active', context: 'fork',
    })
    /** 中文说明：测试局部值 childId，由紧邻初始化决定。 */
    const childId = spawnedChildId(spawned)
    await waitRunning(ctx, childId)

    /** 中文说明：测试局部值 firstResult，由紧邻初始化决定。 */
    const firstResult = await execute(ctx, lead, 'team_task_create', {
      subject: 'first', description: 'first task',
    })
    /** 中文说明：测试局部值 secondResult，由紧邻初始化决定。 */
    const secondResult = await execute(ctx, lead, 'team_task_create', {
      subject: 'second', description: 'second task',
    })
    /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
    const first = JSON.parse(text(firstResult)) as { id: string; revision: number }
    /** 中文说明：测试局部值 second，由紧邻初始化决定。 */
    const second = JSON.parse(text(secondResult)) as { id: string; revision: number }
    /** 中文说明：测试局部值 claimed，由紧邻初始化决定。 */
    const claimed = await execute(ctx, lead, 'team_task_update', {
      task_id: first.id, expected_revision: first.revision, action: 'claim',
    })
    /** 中文说明：测试局部值 claim，由紧邻初始化决定。 */
    const claim = JSON.parse(text(claimed)) as { revision: number }

    expect(JSON.parse(text(await execute(ctx, lead, 'team_task_list', {
      status: 'in_progress', owner: 'lead', cursor: 0, limit: 1,
    })))).toMatchObject({ tasks: [{ id: first.id }] })
    expect(JSON.parse(text(await execute(ctx, lead, 'team_task_list', {
      owner: 'unowned', limit: 1,
    })))).toMatchObject({ tasks: [{ id: second.id }] })
    expect(JSON.parse(text(await execute(ctx, lead, 'team_task_list', {
      cursor: 0, limit: 1,
    })))).toMatchObject({ nextCursor: 1 })
    expect(JSON.parse(text(await execute(ctx, lead, 'team_task_list', {
      cursor: 1,
    })))).not.toHaveProperty('nextCursor')
    expect((await execute(ctx, lead, 'team_task_list', { cursor: -1 })).isError).toBe(true)
    expect((await execute(ctx, lead, 'team_task_list', { limit: 101 })).isError).toBe(true)

    /** 中文说明：测试局部值 edited，由紧邻初始化决定。 */
    const edited = await execute(ctx, lead, 'team_task_update', {
      task_id: first.id,
      expected_revision: claim.revision,
      action: 'edit',
      subject: 'edited',
      description: 'edited description',
      write_scopes: ['src/team'],
    })
    /** 中文说明：测试局部值 edit，由紧邻初始化决定。 */
    const edit = JSON.parse(text(edited)) as { revision: number }
    /** 中文说明：测试局部值 dependencies，由紧邻初始化决定。 */
    const dependencies = await execute(ctx, lead, 'team_task_update', {
      task_id: first.id,
      expected_revision: edit.revision,
      action: 'set_dependencies',
      blocked_by: [second.id],
    })
    expect(dependencies.isError).toBe(false)
    /** 中文说明：测试局部值 dependency，由紧邻初始化决定。 */
    const dependency = JSON.parse(text(dependencies)) as { revision: number }
    expect((await execute(ctx, lead, 'team_task_update', {
      task_id: first.id,
      expected_revision: dependency.revision,
      action: 'reassign',
      owner: 'fork-worker',
    })).isError).toBe(true)

    /** 中文说明：测试局部值 wait，由紧邻初始化决定。 */
    const wait = execute(ctx, lead, 'wait_agent', {})
    /** 中文说明：测试局部值 wake，由紧邻初始化决定。 */
    const wake = new Promise<Awaited<ReturnType<typeof execute>>>((resolve, reject) => {
      setTimeout(() => {
        void execute(ctx, lead, 'team_task_create', {
          subject: 'wake', description: 'wake default wait',
        }).then(resolve, reject)
      }, 0)
    })
    expect((await wait).isError).toBe(false)
    expect((await wake).isError).toBe(false)

    await execute(ctx, lead, 'interrupt_agent', { target: 'fork-worker' })
    await vi.waitFor(() => { expect(ctx.agents.get(childId)).toBeUndefined() }, { timeout: 5_000 })
  })

  it('removes and reinstalls every scoped registration across plugin HMR without stopping the child', async () => {
    /** 中文说明：测试局部值 { ctx, lead, fiber }，由紧邻初始化决定。 */
    const { ctx, lead, fiber } = await setup(['hang'])
    /** 中文说明：测试局部值 spawned，由紧邻初始化决定。 */
    const spawned = await execute(ctx, lead, 'spawn_teammate', {
      name: 'hmr-worker', description: 'hmr worker', prompt: 'wait',
    })
    /** 中文说明：测试局部值 childId，由紧邻初始化决定。 */
    const childId = spawnedChildId(spawned)
    /** 中文说明：测试局部值 child，由紧邻初始化决定。 */
    const child = await waitRunning(ctx, childId)

    await fiber.dispose()
    expect((await assembly(ctx, lead)).tools.map(schema => schema.name).some(name => TOOL_NAMES.includes(name))).toBe(false)
    expect((await assembly(ctx, child)).tools.map(schema => schema.name).some(name => TOOL_NAMES.includes(name))).toBe(false)
    expect(ctx.agents.get(childId)).toBe(child)

    /** 中文说明：测试局部值 replacement，由紧邻初始化决定。 */
    const replacement = await ctx.plugin(toolTeam)
    expect((await assembly(ctx, lead)).tools.map(schema => schema.name).filter(name => TOOL_NAMES.includes(name)).sort())
      .toEqual(TOOL_NAMES)
    expect((await assembly(ctx, child)).tools.map(schema => schema.name).filter(name => TOOL_NAMES.includes(name)).sort())
      .toEqual(TOOL_NAMES)
    await execute(ctx, lead, 'interrupt_agent', { target: 'hmr-worker' })
    await vi.waitFor(() => { expect(ctx.agents.get(childId)).toBeUndefined() }, { timeout: 5_000 })
    await replacement.dispose()
  })

  it('shadows legacy global control names only inside Team member scopes', async () => {
    /** 中文说明：测试局部值 { ctx, lead, fiber }，由紧邻初始化决定。 */
    const { ctx, lead, fiber } = await setup([], true)
    /** 中文说明：测试局部值 teamSchema，由紧邻初始化决定。 */
    const teamSchema = (await assembly(ctx, lead)).tools.find(schema => schema.name === 'send_message')
    expect(JSON.stringify(teamSchema)).toContain('target')
    expect(JSON.stringify(teamSchema)).not.toContain('subagent_id')

    await fiber.dispose()
    /** 中文说明：测试局部值 legacySchema，由紧邻初始化决定。 */
    const legacySchema = (await assembly(ctx, lead)).tools.find(schema => schema.name === 'send_message')
    expect(JSON.stringify(legacySchema)).toContain('subagent_id')
  })

  it('rolls back partial scoped installation after a same-scope collision', async () => {
    /** 中文说明：测试局部值 { ctx, lead, fiber }，由紧邻初始化决定。 */
    const { ctx, lead, fiber } = await setup([])
    await fiber.dispose()
    lead.ctx.tools.register(defineContentToolFixture({
      name: 'spawn_teammate',
      description: 'intentional collision',
      parameters: {},
      async execute() { return [{ type: 'text', text: 'collision' }] },
    }))

    await expect(ctx.plugin(toolTeam)).rejects.toThrow(/already registered/u)
    /** 中文说明：测试局部值 assembled，由紧邻初始化决定。 */
    const assembled = await assembly(ctx, lead)
    expect(assembled.tools.filter(schema => TOOL_NAMES.includes(schema.name)).map(schema => schema.name))
      .toEqual(['spawn_teammate'])
    expect(renderPrompt(assembled)).not.toContain('Your Team role is lead')
  })

  it('resolves direct-apply defaults without Loader schema normalization', async () => {
    /** 中文说明：测试局部值 { ctx, lead, fiber }，由紧邻初始化决定。 */
    const { ctx, lead, fiber } = await setup([textResponse('ordinary child')])
    await fiber.dispose()
    toolTeam.apply(ctx, {})
    expect((await assembly(ctx, lead)).tools.map(schema => schema.name).filter(name => TOOL_NAMES.includes(name)).sort())
      .toEqual(TOOL_NAMES)
    /** 中文说明：测试局部值 ordinary，由紧邻初始化决定。 */
    const ordinary = await ctx.subagents.startContinuable({
      provider: 'spawn',
      label: 'ordinary child',
      request: { prompt: [{ type: 'text', text: 'finish' }], parent: lead },
      signal: SIGNAL,
    })
    await vi.waitFor(() => { expect(ctx.agents.get(ordinary.childId)).toBeUndefined() }, { timeout: 5_000 })
  })

  it('reinstalls Team scope before a cold-resumed teammate request', async () => {
    /** 中文说明：测试局部值 { ctx, lead }，由紧邻初始化决定。 */
    const { ctx, lead } = await setup([textResponse('first'), 'hang'])
    /** 中文说明：测试局部值 spawned，由紧邻初始化决定。 */
    const spawned = await execute(ctx, lead, 'spawn_teammate', {
      name: 'cold-worker', description: 'cold worker', prompt: 'finish once',
    })
    /** 中文说明：测试局部值 childId，由紧邻初始化决定。 */
    const childId = spawnedChildId(spawned)
    await vi.waitFor(() => { expect(ctx.agents.get(childId)).toBeUndefined() }, { timeout: 5_000 })

    await ctx.agentTeams.sendMessage(lead, {
      target: 'cold-worker',
      content: [{ type: 'text', text: 'resume with Team scope' }],
      delivery: 'wakeup',
      signal: SIGNAL,
    })
    /** 中文说明：测试局部值 resumed，由紧邻初始化决定。 */
    const resumed = await waitRunning(ctx, childId)
    expect((await assembly(ctx, resumed)).tools.map(schema => schema.name)
      .filter(name => TOOL_NAMES.includes(name)).sort()).toEqual(TOOL_NAMES)
    expect(renderPrompt(await assembly(ctx, resumed))).toContain('Your Team role is teammate; your Team name is cold-worker')
    await execute(ctx, lead, 'interrupt_agent', { target: 'cold-worker' })
    await vi.waitFor(() => { expect(ctx.agents.get(childId)).toBeUndefined() }, { timeout: 5_000 })
  })

  it('fails safely without a calling Agent and has the function-plugin export shape', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await setup([])
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await execute(ctx, undefined, 'list_agents', {})
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('unknown tool "list_agents"')
    expect('default' in toolTeam).toBe(false)
    expect(toolTeam.name).toBe('tool-agent-team')
    expect(toolTeam.inject).toEqual(['agents', 'agentTeams', 'tools', 'systemPrompt'])
  })

  it('uses configured fresh and fork provider names', async () => {
    /** 中文说明：测试局部值 { ctx, lead, fiber }，由紧邻初始化决定。 */
    const { ctx, lead, fiber } = await setup([textResponse('custom')])
    await fiber.dispose()
    await ctx.plugin(SubagentSpawn, { providerName: 'team-fresh' })
    await ctx.plugin(toolTeam, { freshProvider: 'team-fresh', forkProvider: 'fork' })
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await execute(ctx, lead, 'spawn_teammate', {
      name: 'custom-provider', description: 'custom provider', prompt: 'go',
    })
    expect(result.isError).toBe(false)
    /** 中文说明：测试局部值 childId，由紧邻初始化决定。 */
    const childId = spawnedChildId(result)
    await vi.waitFor(() => { expect(ctx.agents.get(childId)).toBeUndefined() }, { timeout: 5_000 })
    expect(ctx.agentTeams.listMembers(lead)[1]).toMatchObject({ provider: 'team-fresh' })
  })
})
