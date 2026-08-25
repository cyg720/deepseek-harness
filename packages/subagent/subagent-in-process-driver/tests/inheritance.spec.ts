/**
 * Delegation policy through child session events appended before publication:
 * the parent's sandbox override plus the pinned `approval/policy: never`.
 */
/*
 * 文件职责：验证 inheritance.spec.ts 覆盖的子代理启动、协议、继承与生命周期行为。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、进程协议或同进程代理驱动。
 * 产品维度：保障 Agent 能可靠委派任务、继承上下文并收集子代理结果。
 * 逻辑维度：准备代理配置，启动或连接子代理，转发事件，再处理结果、取消与清理。
 * 关键边界：异步状态不等于单次任务结果；外部输出不可信；清理必须等待子代理完全停止。
 * 新手阅读建议：先看公开配置和测试夹具，再读启动/事件流程，最后关注继承、取消与失败路径。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import SandboxedFileSystem from '@deepseek-ai/dsh-fs-sandbox'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import SandboxPolicyService, { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import { snapshotSubagentDescriptor } from '@deepseek-ai/dsh-subagent'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { startInProcessRun } from '../src/index.ts'

/** 中文说明：type Script 定义本测试所需的数据或行为，用于表达子代理场景。 */
type Script = ConstructorParameters<typeof MockAdapter>[0]

/** 中文说明：常量 READ_ONLY_DENIAL 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const READ_ONLY_DENIAL = '[sandbox: file access denied under read-only mode]'
/** 中文说明：变量 contexts 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const contexts: Context[] = []
/** 中文说明：变量 workspace 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let workspace: string

beforeEach(async () => {
  workspace = await realpath(await mkdtemp(join(tmpdir(), 'dsh-inherit-')))
})

afterEach(async () => {
  /** 中文说明：该循环依次处理代理事件；循环变量仅在当前循环中有效。 */
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  await rm(workspace, { recursive: true, force: true })
})

/** 中文说明：函数 setupWalled 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function setupWalled(script: Script): Promise<{ ctx: Context; parent: Agent }> {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: workspace })
  await ctx.plugin(SandboxedFileSystem, { cwd: workspace })
  await ctx.plugin(ToolFs)
  await ctx.plugin(ApprovalService)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], new MockAdapter(script))
  /** 中文说明：变量 parent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const parent = ctx.agentLoop.create(
    SessionId('parent'),
    { provider: 'mock', model: 'mock' },
    { cwd: workspace },
  )
  return { ctx, parent }
}

/** 中文说明：函数 spawnRequest 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function spawnRequest(parent: Agent) {
  return {
    label: 'child task',
    prompt: [{ type: 'text' as const, text: 'child task' }],
    parent,
    signal: new AbortController().signal,
    descriptor: snapshotSubagentDescriptor({
      mode: 'one-shot',
      provider: 'spawn',
      label: 'child task',
    }),
  }
}

/** 中文说明：函数 toolResultTexts 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function toolResultTexts(agent: Agent): string[] {
  return agent.session.events
    .filter((event): event is SessionEvent<'tool/result'> => event.type === 'tool/result')
    .map(event => event.data.message.content
      .flatMap(block => block.content)
      .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
      .map(block => block.text)
      .join(''))
}

describe('in-process policy inheritance', () => {
  it('records the parent sandbox override and the approval pin before publishing a spawn child', async () => {
    /** 中文说明：变量 script 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const script: Script = []
    const { ctx, parent } = await setupWalled(script)
    /** 中文说明：变量 blocked 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const blocked = join(workspace, 'spawn-blocked.txt')
    setSandboxMode(parent.session, 'read-only')
    // No parent approval override: the child pin must not depend on one.
    expect(ctx.approval.overrideOf(parent.session)).toBeUndefined()
    /** 中文说明：变量 parentLogLength 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const parentLogLength = parent.session.events.length
    script.push(
      toolCallResponse('write', 'write', { file_path: blocked, content: 'escaped' }),
      textResponse('child done'),
    )

    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = await startInProcessRun(spawnRequest(parent), {})
    try {
      /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const result = await run.result
      /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const child = run.localAgent as Agent

      await expect(readFile(blocked, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
      expect(toolResultTexts(child).join('\n')).toContain(READ_ONLY_DENIAL)
      expect(result.stopReason).toBe('completed')
      expect(child.session.events.slice(0, 2)).toMatchObject([
        { type: 'sandbox/mode', seq: 0, data: { mode: 'read-only', source: 'delegation' } },
        { type: 'approval/policy', seq: 1, data: { policy: 'never', source: 'delegation' } },
      ])
      expect(child.session.firstLiveSeq).toBe(0)
      expect(child.session.header.seedLength).toBeUndefined()
      expect(ctx.sandboxPolicy.overrideOf(child.session)).toBe('read-only')
      expect(ctx.approval.overrideOf(child.session)).toBe('never')
      /** 中文说明：变量 request 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const request = child.session.events.find(
        (event): event is SessionEvent<'request/header'> => event.type === 'request/header',
      )
      /** 中文说明：变量 runtimeContext 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const runtimeContext = child.session.events.find(
        (event): event is SessionEvent<'user/message'> => event.type === 'user/message'
          && event.data.source.kind === 'plugin'
          && event.data.source.plugin === '@deepseek-ai/dsh-system-prompt',
      )
      if (request === undefined || runtimeContext === undefined) throw new Error('child request lacks its runtime policy context')
      expect(runtimeContext.seq).toBeLessThan(request.seq)
      /** 中文说明：变量 contextText 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const contextText = runtimeContext.data.content
        .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
        .map(block => block.text)
        .join('\n')
      expect(contextText).toContain('Current DSH file policy: read-only')
      expect(contextText).toContain('Approval prompts are disabled')
      // The statement rides runtime context; the system prompt stays uniform.
      expect(contextText).toContain('You are a delegated subagent')
      expect(request.data.header.system).not.toContain('Approval prompts are disabled')
      expect(request.data.header.system).not.toContain('You are a delegated subagent')
      expect(parent.session.events).toHaveLength(parentLogLength)
    } finally {
      await run.dispose()
    }
  })

  it('places inherited events after a fork prefix so fresh policy wins stale seed state', async () => {
    /** 中文说明：变量 script 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const script: Script = []
    const { ctx, parent } = await setupWalled(script)
    /** 中文说明：变量 blocked 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const blocked = join(workspace, 'fork-blocked.txt')
    setSandboxMode(parent.session, 'workspace-write')
    /** 中文说明：变量 seed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const seed = [...parent.session.events]
    setSandboxMode(parent.session, 'read-only')
    script.push(
      toolCallResponse('write', 'write', { file_path: blocked, content: 'escaped' }),
      textResponse('child done'),
    )

    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = await startInProcessRun(spawnRequest(parent), { seed })
    try {
      await run.result
      /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const child = run.localAgent as Agent

      expect(child.session.header.seedLength).toBe(1)
      expect(child.session.firstLiveSeq).toBe(seed.length)
      // seq 1 is the constructor's end-seed marker.
      expect(child.session.events.filter(event => event.type === 'sandbox/mode')).toMatchObject([
        { seq: 0, data: { mode: 'workspace-write' } },
        { seq: 2, data: { mode: 'read-only', source: 'delegation' } },
      ])
      await expect(readFile(blocked, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
      expect(ctx.sandboxPolicy.overrideOf(child.session)).toBe('read-only')

      setSandboxMode(child.session, 'danger-full-access')
      expect(ctx.sandboxPolicy.overrideOf(child.session)).toBe('danger-full-access')
    } finally {
      await run.dispose()
    }
  })

  it('captures policy at delegation before asynchronous child creation', async () => {
    /** 中文说明：变量 script 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const script: Script = [textResponse('child done')]
    const { ctx, parent } = await setupWalled(script)
    setSandboxMode(parent.session, 'read-only')

    /** 中文说明：变量 starting 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const starting = startInProcessRun(spawnRequest(parent), {})
    setSandboxMode(parent.session, 'danger-full-access')
    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = await starting
    try {
      await run.result
      /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const child = run.localAgent as Agent
      expect(ctx.sandboxPolicy.overrideOf(parent.session)).toBe('danger-full-access')
      expect(ctx.sandboxPolicy.overrideOf(child.session)).toBe('read-only')
    } finally {
      await run.dispose()
    }
  })

  it('leaves an unswitched sandbox on the deployment default while still pinning approval', async () => {
    /** 中文说明：变量 script 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const script: Script = []
    const { parent } = await setupWalled(script)
    /** 中文说明：变量 allowed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const allowed = join(workspace, 'default-allowed.txt')
    script.push(
      toolCallResponse('write', 'write', { file_path: allowed, content: 'fine' }),
      textResponse('child done'),
    )

    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = await startInProcessRun(spawnRequest(parent), {})
    try {
      await run.result
      /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const child = run.localAgent as Agent
      expect(await readFile(allowed, 'utf8')).toBe('fine')
      expect(child.session.events.some(event => event.type === 'sandbox/mode')).toBe(false)
      expect(child.session.events.filter(event => event.type === 'approval/policy')).toMatchObject([
        { seq: 0, data: { policy: 'never', source: 'delegation' } },
      ])
      expect(child.session.firstLiveSeq).toBe(0)
    } finally {
      await run.dispose()
    }
  })

  it('rejects a child escalation deterministically even when an answerer would allow it', async () => {
    /** 中文说明：变量 script 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const script: Script = []
    const { ctx, parent } = await setupWalled(script)
    // A granting answerer proves the pin resolves before any answerer runs.
    /** 中文说明：变量 consulted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let consulted = false
    ctx.on('approval/request', () => {
      consulted = true
      return Promise.resolve('allowed-once' as const)
    })
    /** 中文说明：变量 blocked 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const blocked = join(workspace, 'escalation-blocked.txt')
    setSandboxMode(parent.session, 'read-only')
    script.push(
      toolCallResponse('write', 'write', {
        file_path: blocked,
        content: 'escaped',
        sandbox_permissions: 'workspace-write',
        justification: 'test escalation from a delegated child',
      }),
      textResponse('child done'),
    )

    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = await startInProcessRun(spawnRequest(parent), {})
    try {
      await run.result
      /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const child = run.localAgent as Agent

      await expect(readFile(blocked, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
      expect(consulted).toBe(false)
      expect(toolResultTexts(child).join('\n'))
        .toContain('the user rejected escalating this operation to "workspace-write"')
      /** 中文说明：变量 asked 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const asked = child.session.events.find(
        (event): event is SessionEvent<'approval/asked'> => event.type === 'approval/asked',
      )
      /** 中文说明：变量 decided 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const decided = child.session.events.find(
        (event): event is SessionEvent<'approval/decided'> => event.type === 'approval/decided',
      )
      expect(asked?.data.toolName).toBe('write')
      expect(decided?.data).toMatchObject({ id: asked?.data.id, outcome: 'rejected' })
    } finally {
      await run.dispose()
    }
  })
})
