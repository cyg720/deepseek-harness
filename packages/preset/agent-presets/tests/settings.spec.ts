/**
 * The default preset is a user setting. `config.default` is the deployment's
 * engineering default; the settings document overrides it and is hot-reloaded,
 * so a person can change which preset new sessions get without a restart.
 */
/*
 * 文件职责：验证 settings.spec.ts 覆盖的 Agent 预设发现、装载与会话行为。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件上下文和临时配置目录。
 * 产品维度：保障用户选择的 Agent 预设能稳定生效并保持会话一致。
 * 逻辑维度：准备预设配置，装载插件，触发会话流程，再核对状态与错误。
 * 关键边界：配置来源和优先级必须明确；临时资源必须在用例结束时释放。
 * 新手阅读建议：先看夹具与辅助函数，再按发现、装载、会话顺序阅读用例。
 */

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import FileSettingsProvider from '@deepseek-ai/dsh-settings-file'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { describe, expect, it } from 'vitest'
import AgentPresets, { COMPOSITION_FILE, SETTINGS_NAMESPACE } from '@deepseek-ai/dsh-agent-presets'

/** 中文说明：常量 FIXTURES 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
/** 中文说明：常量 ROOTS 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const ROOTS = [{ path: join(FIXTURES, 'system'), trust: 'system' as const }]
/** 中文说明：常量 NS 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const NS = settingsNamespace(SETTINGS_NAMESPACE)

/**
 * A composition with a real file-backed settings provider. `settingsFiber` is
 * the provider's own handle, so a test can take it away the way a reload does.
 */
/* 中文说明：函数 harness 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function harness(
  extraRoots: readonly { path: string; trust: 'system' | 'user' }[] = [],
): Promise<{ ctx: Context; settingsFile: string; settingsFiber: { dispose: () => unknown } }> {
  /** 中文说明：变量 home 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const home = await mkdtemp(join(tmpdir(), 'dsh-preset-settings-'))
  /** 中文说明：变量 settingsFile 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const settingsFile = join(home, 'settings.yaml')
  await writeFile(settingsFile, '{}\n')

  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(FIXTURES).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  /** 中文说明：变量 settingsFiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const settingsFiber = ctx.plugin(FileSettingsProvider, { path: settingsFile, watch: false })
  await settingsFiber
  await ctx.plugin(AgentPresets, { default: 'standard', roots: [...ROOTS, ...extraRoots], includeShippedRoot: false, includeUserRoot: false })
  return { ctx, settingsFile, settingsFiber }
}

/** 中文说明：函数值 toolNames 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
const toolNames = (ctx: Context, agent?: unknown): string[] =>
  ctx.tools.schemas(agent as never).map(schema => schema.name).sort()

describe('the default preset as a user setting', () => {
  it('falls back to the composition default while the user set none', async () => {
    const { ctx } = await harness()

    expect(ctx.agentPresets.defaultId).toBe('standard')
  })

  it('takes the user default over the composition default', async () => {
    const { ctx } = await harness()

    await ctx.settings.update(NS, { default: 'minimal' })

    expect(ctx.agentPresets.defaultId).toBe('minimal')
  })

  it('composes a new session from the user default', async () => {
    const { ctx } = await harness()
    await ctx.settings.update(NS, { default: 'minimal' })

    /** 中文说明：变量 handle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const handle = await ctx.agents.create({
      sessionId: SessionId('settings-default'),
      setup: async (agentCtx: Context) => void await ctx.agentPresets.mount(agentCtx),
    })
    try {
      expect(toolNames(ctx, handle.agent)).toEqual(['beta'])
    } finally {
      await handle.dispose()
    }
  })

  it('leaves a running session on the preset it was composed from', async () => {
    const { ctx } = await harness()
    /** 中文说明：变量 running 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const running = await ctx.agents.create({
      sessionId: SessionId('settings-running'),
      setup: async (agentCtx: Context) => void await ctx.agentPresets.mount(agentCtx),
    })
    try {
      expect(toolNames(ctx, running.agent)).toEqual(['alpha'])

      // Changing the default mid-flight must not reach an agent that already
      // composed: its history was produced under `standard`'s tools.
      await ctx.settings.update(NS, { default: 'minimal' })

      expect(ctx.agentPresets.defaultId).toBe('minimal')
      expect(toolNames(ctx, running.agent)).toEqual(['alpha'])
    } finally {
      await running.dispose()
    }
  })

  it('re-inherits the composition default when the user setting is cleared', async () => {
    const { ctx } = await harness()
    await ctx.settings.update(NS, { default: 'minimal' })
    expect(ctx.agentPresets.defaultId).toBe('minimal')

    await ctx.settings.replace(NS, {})

    expect(ctx.agentPresets.defaultId).toBe('standard')
  })

  it('clears a user default it has just deleted', async () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = await mkdtemp(join(tmpdir(), 'dsh-preset-authored-'))
    await mkdir(join(root, 'mine'))
    await writeFile(
      join(root, 'mine', COMPOSITION_FILE),
      `- id: only\n  name: ${join(FIXTURES, 'plugins', 'contribute.js')}\n  config:\n    tool: only\n`,
    )
    const { ctx } = await harness([{ path: root, trust: 'user' as const }])
    await ctx.settings.update(NS, { default: 'mine' })
    expect(ctx.agentPresets.defaultId).toBe('mine')

    await ctx.agentPresets.remove('mine')

    // Nothing will ever supply that id again, so leaving the setting pointed at
    // it would fail every session created without an explicit pick. Clearing it
    // exposes the deployment's own default underneath.
    expect(ctx.agentPresets.defaultId).toBe('standard')
    expect((await ctx.agentPresets.resolve()).id).toBe('standard')
  })

  it('reports an unknown user default only when a session tries to use it', async () => {
    const { ctx } = await harness()

    // Storing it succeeds — the roster is a live directory, so a name that is
    // absent now may exist by the time a session asks for it.
    await ctx.settings.update(NS, { default: 'no-such-preset' })

    await expect(ctx.agentPresets.resolve())
      .rejects.toThrow(/preset "no-such-preset" not found/)
  })
})

describe('a settings provider that goes away', () => {
  it('falls back to the composition default when the provider unloads', async () => {
    const { ctx, settingsFiber } = await harness()
    await ctx.settings.update(NS, { default: 'minimal' })
    expect(ctx.agentPresets.defaultId).toBe('minimal')

    // Unloading the provider takes the user layer with it; the roster keeps
    // working on its composition default rather than holding a stale override.
    await settingsFiber.dispose()

    expect(ctx.agentPresets.defaultId).toBe('standard')
  })
})
