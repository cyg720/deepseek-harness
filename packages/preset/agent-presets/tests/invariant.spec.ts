/**
 * 文件职责：验证 invariant.spec.ts 覆盖的 Agent 预设发现、装载与会话行为。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件上下文和临时配置目录。
 * 产品维度：保障用户选择的 Agent 预设能稳定生效并保持会话一致。
 * 逻辑维度：准备预设配置，装载插件，触发会话流程，再核对状态与错误。
 * 关键边界：配置来源和优先级必须明确；临时资源必须在用例结束时释放。
 * 新手阅读建议：先看夹具与辅助函数，再按发现、装载、会话顺序阅读用例。
 */
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry, { assembleContextFor } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { describe, expect, it } from 'vitest'
import AgentPresets, { livePresetMounts, type Config } from '@deepseek-ai/dsh-agent-presets'
import * as AgentPresetsInvariant from '@deepseek-ai/dsh-agent-presets/invariant'

/** 中文说明：常量 FIXTURES 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
/** 中文说明：常量 ROOTS 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const ROOTS = [
  { path: join(FIXTURES, 'system'), trust: 'system' as const },
  { path: join(FIXTURES, 'user'), trust: 'user' as const },
]

/** 中文说明：函数 harness 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function harness(roster: Partial<Config> = {}): Promise<Context> {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(FIXTURES).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(AgentPresets, { default: 'standard', roots: ROOTS, includeUserRoot: false, ...roster })
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin(AgentPresetsInvariant)
  return ctx
}

describe('agent-presets invariants', () => {
  it('keeps the standing composition alive across the agents that joined it', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await harness()
    /** 中文说明：变量 handle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const handle = await ctx.agents.create({
      sessionId: SessionId('inv-live'),
      setup: async (agentCtx: Context) => void await ctx.agentPresets.mount(agentCtx, 'standard'),
    })

    expect(livePresetMounts().map(mount => mount.presetId)).toContain('standard')

    // A standing mount survives its agents: the composition a session joined
    // is shared, so one session ending must not strip it from the next.
    await handle.dispose()
    expect(livePresetMounts().map(mount => mount.presetId)).toContain('standard')

    // A second agent reuses the same mount rather than adding one.
    await ctx.agents.create({
      sessionId: SessionId('inv-live-2'),
      setup: async (agentCtx: Context) => void await ctx.agentPresets.mount(agentCtx, 'standard'),
    })
    expect(livePresetMounts().filter(mount => mount.presetId === 'standard')).toHaveLength(1)

    // Whole-tree teardown is the boundary that does reclaim it.
    await ctx.fiber.dispose()
    expect(livePresetMounts().map(mount => mount.presetId)).not.toContain('standard')
  })

  it('rejects a composition that publishes a process-global service after its audit', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await harness()
    await ctx.agents.create({
      sessionId: SessionId('inv-late'),
      setup: async (agentCtx: Context) => void await ctx.agentPresets.mount(agentCtx, 'late'),
    })
    /** 中文说明：函数值 publishLate 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const publishLate = (globalThis as { __PUBLISH_LATE__?: () => void }).__PUBLISH_LATE__
    expect(publishLate).toBeTypeOf('function')

    expect(() => { publishLate?.() }).toThrow(/published process-global service\(s\) \[fixtureLateSvc\]/)
  })

  it('stays quiet while every composition keeps its services out of the root realm', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await harness()

    await expect(ctx.agents.create({
      sessionId: SessionId('inv-isolated'),
      setup: async (agentCtx: Context) => void await ctx.agentPresets.mount(agentCtx, 'isolated'),
    })).resolves.toBeDefined()
  })

  it('rejects an agent that addresses a model without joining any preset', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await harness()
    // The delegation shape: an agent composed outside the roster joined no
    // standing mount, so every registry view it reads is the empty global
    // layer. Publication alone stays legal — `recompose` binds exactly such an
    // agent — so nothing fires until that empty world reaches a prompt.
    /** 中文说明：变量 handle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const handle = await ctx.agents.create({ sessionId: SessionId('inv-unjoined') })

    await expect(ctx.systemPrompt.assemble(assembleContextFor(handle.agent)))
      .rejects.toThrow(/without joining any agent preset/)
  })

  it('rejects one just the same when the derived home root is the whole roster', async () => {
    // The shape this plugin defaults to: an app configures nothing and the
    // roster is the harness home alone. A roster is a roster however its roots
    // were resolved, so the fail-loud half must not go quiet here — it read
    // `config.roots` once, which is empty in exactly this case.
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await harness({ roots: [], includeUserRoot: true })
    /** 中文说明：变量 handle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const handle = await ctx.agents.create({ sessionId: SessionId('inv-derived-only') })

    await expect(ctx.systemPrompt.assemble(assembleContextFor(handle.agent)))
      .rejects.toThrow(/without joining any agent preset/)
  })

  it('stays silent for a composition that opted out of every root', async () => {
    // `includeUserRoot: false` with no configured roots is a deployment that
    // mounts the roster but keeps its agents on the host plane; there is no
    // roster to join, so an unjoined agent is not a violation.
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await harness({ roots: [], includeUserRoot: false })
    /** 中文说明：变量 handle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const handle = await ctx.agents.create({ sessionId: SessionId('inv-no-roster') })

    await expect(ctx.systemPrompt.assemble(assembleContextFor(handle.agent))).resolves.toBeDefined()
  })

  it('admits a joined agent, a scopeless read, and a standing-key read', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await harness()
    /** 中文说明：变量 handle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const handle = await ctx.agents.create({
      sessionId: SessionId('inv-joined'),
      setup: async (agentCtx: Context) => void await ctx.agentPresets.mount(agentCtx, 'standard'),
    })

    await expect(ctx.systemPrompt.assemble(assembleContextFor(handle.agent))).resolves.toBeDefined()
    // A scopeless assembly belongs to no agent, so it cannot be an unjoined one.
    await expect(ctx.systemPrompt.assemble({})).resolves.toBeDefined()
    // Neither can a scope that is not an agent at all: a standing preset key
    // has no parent of its own, so a chain-length rule would reject the cold
    // read that resolves presenters in it. `context.agent` is what keeps this
    // check to agent assemblies.
    /** 中文说明：变量 standing 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const standing = await ctx.agentPresets.standingKeyFor('standard')
    await expect(ctx.systemPrompt.assemble({ scope: standing })).resolves.toBeDefined()
  })
})
