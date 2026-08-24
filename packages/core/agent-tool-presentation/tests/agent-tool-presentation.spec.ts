/**
 * The row an agent preset carries to pick its tool presentation. What it owes
 * its caller: the choice reaches THIS agent and no other, it unwinds with the
 * agent, and a code mode composed against a deployment with no code runtime
 * stops at mount — where a preset's activation audit can name it — rather
 * than at the first prompt assembly.
 */
/**
 * 文件职责：验证工具呈现的 agent-tool-presentation.spec.ts 行为与不变量。
 * 技术维度：Vitest、Cordis、会话事件、模型适配器和可控工具夹具。
 * 产品维度：防止工具呈现在取消、恢复、错误或并发场景中产生回归。
 * 逻辑维度：构造服务与事件，驱动执行流程，再断言日志、请求、状态和清理。
 * 关键边界：测试后台任务必须结束；模型可见输入必须可从日志重建；工具调用顺序不可破坏。
 * 新手阅读建议：先读 mock/辅助函数，再按成功、错误、恢复和生命周期场景阅读。
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createScope } from '@deepseek-ai/dsh-scope'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { CodeRuntime } from '@deepseek-ai/dsh-code-runtime'
import type { CodeRunRequest, CodeRunResult } from '@deepseek-ai/dsh-code-runtime'
import ToolRuntime, { RUN_CODE_NAME, defineTool } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { apply, Config, inject, name } from '@deepseek-ai/dsh-agent-tool-presentation'

/** A runtime that never runs anything: presentation never dispatches. */
/** 中文说明：测试类型或类 StubRuntime 约束夹具数据和行为。 */
class StubRuntime extends CodeRuntime {
  readonly language = 'typescript'
  readonly isolation = 'stub'

  run(_request: CodeRunRequest): Promise<CodeRunResult> {
    return Promise.resolve({ logs: [] })
  }
}

/** A host plane with one tool, optionally carrying a code runtime. */
/** 中文说明：测试辅助函数 host 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
async function host(options: { runtime?: boolean } = {}) {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime, {})
  if (options.runtime !== false) await ctx.plugin(StubRuntime)
  ctx.tools.register(defineTool({
    name: 'echo',
    description: 'Echo tool.',
    parameters: { value: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: args => Promise.resolve(args.value),
  }))
  return ctx
}

/** Mount the row under one agent's scope, as a preset subtree does. */
/** 中文说明：测试辅助函数 mount 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
async function mount(ctx: Context, config: Config, id = 'agent') {
  /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
  const agent = { id: SessionId(id) } as Agent
  /** 中文说明：测试局部值 inner!: Context，由紧邻初始化决定，仅在当前场景使用。 */
  let inner!: Context
  /** 中文说明：测试局部值 fiber，由紧邻初始化决定，仅在当前场景使用。 */
  const fiber = ctx.plugin(Object.assign((host: Context) => {
    inner = createScope(host, agent).ctx
  }, { inject: ['tools', 'systemPrompt'] }))
  await fiber.await()
  /** 中文说明：测试局部值 row，由紧邻初始化决定，仅在当前场景使用。 */
  const row = inner.plugin({ name, inject: [...inject], Config, apply }, config)
  await row.await()
  return { agent, fiber, row }
}

describe('the tool-presentation row', () => {
  it('declares the services it uses without holding a code runtime hostage', () => {
    // A `native` row must mount where no runtime is composed, so the wait is
    // conditional inside apply rather than static metadata.
    expect(inject).toEqual(['tools'])
  })

  it('gives its own agent Code Mode and leaves the rest native', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await host()
    /** 中文说明：测试局部值 coded，由紧邻初始化决定，仅在当前场景使用。 */
    const coded = await mount(ctx, { mode: 'code' }, 'coded')
    /** 中文说明：测试局部值 plain，由紧邻初始化决定，仅在当前场景使用。 */
    const plain = await mount(ctx, { mode: 'native' }, 'plain')

    /** 中文说明：测试局部值 codedAssembly，由紧邻初始化决定，仅在当前场景使用。 */
    const codedAssembly = await ctx.systemPrompt.assemble({ scope: coded.agent })
    /** 中文说明：测试局部值 plainAssembly，由紧邻初始化决定，仅在当前场景使用。 */
    const plainAssembly = await ctx.systemPrompt.assemble({ scope: plain.agent })

    expect(codedAssembly.tools.map(tool => tool.name)).toEqual([RUN_CODE_NAME])
    expect(codedAssembly.sections.find(section => section.name === 'tools:sdk')?.text).toContain('echo')
    expect(plainAssembly.tools.map(tool => tool.name)).toEqual(['echo'])
  })

  it('presents both forms when asked for both', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await host()
    /** 中文说明：测试局部值 { agent }，由紧邻初始化决定，仅在当前场景使用。 */
    const { agent } = await mount(ctx, { mode: 'both' })

    /** 中文说明：测试局部值 assembly，由紧邻初始化决定，仅在当前场景使用。 */
    const assembly = await ctx.systemPrompt.assemble({ scope: agent })

    expect(assembly.tools.map(tool => tool.name)).toEqual(['echo', RUN_CODE_NAME])
  })

  it('restores the deployment default when the agent unloads', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await host()
    /** 中文说明：测试局部值 { agent, row }，由紧邻初始化决定，仅在当前场景使用。 */
    const { agent, row } = await mount(ctx, { mode: 'code' })

    await row.dispose()

    // HMR safety: the preset subtree is torn down with its agent, and the
    // presentation must go with it rather than outliving the composition.
    /** 中文说明：测试局部值 assembly，由紧邻初始化决定，仅在当前场景使用。 */
    const assembly = await ctx.systemPrompt.assemble({ scope: agent })
    expect(assembly.tools.map(tool => tool.name)).toEqual(['echo'])
    expect(assembly.sections.some(section => section.name === 'tools:sdk')).toBe(false)
  })

  it('waits for a code runtime the deployment does not compose', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await host({ runtime: false })

    /** 中文说明：测试局部值 { agent, row }，由紧邻初始化决定，仅在当前场景使用。 */
    const { agent, row } = await mount(ctx, { mode: 'code' })

    // Pending, not applied: `dsh-agent-presets` rejects a mount holding a row
    // that never reached a usable state, naming this id — so the preset fails
    // where the operator can act, instead of at the first request.
    expect(row.ctx.get('codeRuntime')).toBeUndefined()
    /** 中文说明：测试局部值 assembly，由紧邻初始化决定，仅在当前场景使用。 */
    const assembly = await ctx.systemPrompt.assemble({ scope: agent })
    expect(assembly.tools.map(tool => tool.name)).toEqual(['echo'])
  })

  it('applies once the runtime arrives', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await host({ runtime: false })
    /** 中文说明：测试局部值 { agent }，由紧邻初始化决定，仅在当前场景使用。 */
    const { agent } = await mount(ctx, { mode: 'code' })

    await ctx.plugin(StubRuntime)

    /** 中文说明：测试局部值 assembly，由紧邻初始化决定，仅在当前场景使用。 */
    const assembly = await ctx.systemPrompt.assemble({ scope: agent })
    expect(assembly.tools.map(tool => tool.name)).toEqual([RUN_CODE_NAME])
  })

  it('requires a mode rather than defaulting one', () => {
    // An omitted value would mean the row was composed for nothing: a preset
    // without this row already gets the deployment default.
    expect(() => Config({} as never)).toThrow()
  })
})
