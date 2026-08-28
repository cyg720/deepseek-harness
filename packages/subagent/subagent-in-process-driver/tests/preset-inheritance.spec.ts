/**
 * Composition inheritance: a child runs on the preset its parent runs on.
 *
 * With every model-facing row on the agent plane, the tool registry's global
 * layer is empty, so a child that joins no preset reaches the model with no
 * tools at all. These assert the model-visible result — the schemas in the
 * child's own request — rather than the join that produces it.
 */
/*
 * 文件职责：验证 preset-inheritance.spec.ts 覆盖的子代理启动、协议、继承与生命周期行为。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、进程协议或同进程代理驱动。
 * 产品维度：保障 Agent 能可靠委派任务、继承上下文并收集子代理结果。
 * 逻辑维度：准备代理配置，启动或连接子代理，转发事件，再处理结果、取消与清理。
 * 关键边界：异步状态不等于单次任务结果；外部输出不可信；清理必须等待子代理完全停止。
 * 新手阅读建议：先看公开配置和测试夹具，再读启动/事件流程，最后关注继承、取消与失败路径。
 */

import { afterEach, describe, expect, it } from 'vitest'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentPresets from '@deepseek-ai/dsh-agent-presets'
import { SessionId } from '@deepseek-ai/dsh-session'
import { snapshotSubagentDescriptor } from '@deepseek-ai/dsh-subagent'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { startInProcessRun } from '../src/index.ts'

/** 中文说明：常量 FIXTURES 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
/** 中文说明：常量 ROOTS 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const ROOTS = [{ path: join(FIXTURES, 'presets'), trust: 'system' as const }]

/** 中文说明：变量 contexts 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const contexts: Context[] = []

afterEach(async () => {
  /** 中文说明：该循环依次处理代理事件；循环变量仅在当前循环中有效。 */
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
})

/** A host composition carrying no model-facing rows, plus the preset roster. */
/* 中文说明：函数 setupPresetHost 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function setupPresetHost(): Promise<{ ctx: Context; adapter: MockAdapter; parent: Agent }> {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(FIXTURES).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(AgentPresets, { default: 'coding', roots: ROOTS, includeShippedRoot: false, includeUserRoot: false })
  const adapter = new MockAdapter([textResponse('parent idle'), textResponse('child done')])
  ctx.llm.registerAdapter(['mock'], adapter)
  /** 中文说明：变量 handle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const handle = await ctx.agents.create({
    sessionId: SessionId('parent'),
    agentOptions: { provider: 'mock', model: 'mock' },
    setup: async (agentCtx: Context) => void await ctx.agentPresets.mount(agentCtx, 'coding'),
  })
  return { ctx, adapter, parent: handle.agent }
}

/** The one-shot spawn request shape both in-process providers build. */
/* 中文说明：函数 spawnRequest 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function spawnRequest(parent: Agent) {
  return {
    label: 'child task',
    prompt: [{ type: 'text' as const, text: 'child task' }],
    parent,
    signal: new AbortController().signal,
    descriptor: snapshotSubagentDescriptor({
      mode: 'one-shot' as const,
      provider: 'spawn',
      label: 'child task',
    }),
  }
}

describe('a child agent composed in-process', () => {
  it('reaches the model with its parent\'s preset tools', async () => {
    const { ctx, adapter, parent } = await setupPresetHost()

    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = await startInProcessRun(spawnRequest(parent), {})
    await run.result

    /** 中文说明：变量 childRequest 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const childRequest = adapter.requests.at(-1)
    expect(childRequest?.tools?.map(tool => tool.name)).toEqual(['preset_only'])
    expect(ctx.tools.schemas(run.localAgent).map(schema => schema.name)).toEqual(['preset_only'])
    await run.dispose()
  })

  it('carries its parent\'s prompt sections', async () => {
    const { parent } = await setupPresetHost()

    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = await startInProcessRun(spawnRequest(parent), {})
    await run.result

    expect(run.localAgent?.session.events.some(event =>
      event.type === 'request/header'
      && JSON.stringify(event.data).includes('section for preset_only'))).toBe(true)
    await run.dispose()
  })

  it('records the composition it ran under on the child header', async () => {
    const { parent } = await setupPresetHost()

    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = await startInProcessRun(spawnRequest(parent), {})
    await run.result

    // Without this the child's own history reads back under the deployment
    // default, which is a different tool set than the one it actually used.
    expect(run.localAgent?.session.header.agentPreset).toBe('coding')
    await run.dispose()
  })

  it('honours a tool filter over the preset tools it inherited', async () => {
    const { ctx, parent } = await setupPresetHost()

    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = await startInProcessRun(
      { ...spawnRequest(parent), toolFilter: { deny: ['preset_only'] } },
      {},
    )
    await run.result

    // The capability filter is the only thing bounding a delegated child, and
    // every tool it can name now arrives from the preset rather than the host.
    expect(ctx.tools.schemas(run.localAgent).map(schema => schema.name)).toEqual([])
    await run.dispose()
  })

  it('follows a parent that switched preset while blank', async () => {
    const { ctx, parent } = await setupPresetHost()
    // A DIFFERENT preset, so the assertion below distinguishes reading the
    // parent's live scope chain from reading its creation header — re-linking
    // to the same id would pass either way.
    await ctx.agentPresets.recompose(parent.ctx, 'reviewing')

    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = await startInProcessRun(spawnRequest(parent), {})
    await run.result

    expect(ctx.tools.schemas(run.localAgent).map(schema => schema.name)).toEqual(['reviewing_only'])
    expect(run.localAgent?.session.header.agentPreset).toBe('reviewing')
    await run.dispose()
  })
})
