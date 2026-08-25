/**
 * 文件职责：验证系统提示词的 tool-order.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis、Vitest、会话事件、JSON 模式和服务作用域。
 * 产品维度：保证系统提示词在配置、错误、恢复和生命周期场景中可靠。
 * 逻辑维度：构造输入并驱动服务，再断言输出、日志和清理。
 * 关键边界：持久与凭据数据属于不可信边界；工具和提示词必须保持模型可见内容可重建。
 * 新手阅读建议：先读类型和夹具，再按正常、非法输入、作用域和清理场景阅读。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt, { PromptAssembly, TOOL_ORDER_REST } from '@deepseek-ai/dsh-system-prompt'
import type { ToolSchema } from '@deepseek-ai/dsh-llm'

/** 中文说明：函数 tool 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function tool(name: string, description = name): ToolSchema {
  return { name, description, parameters: { type: 'object', properties: {} } }
}

/** 中文说明：函数 mount 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function mount(config: { persona?: string; toolOrder?: string[] } = {}): Promise<Context> {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, config)
  return ctx
}

/** 中文说明：函数 names 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function names(assembly: PromptAssembly): string[] {
  return assembly.tools.map(t => t.name)
}

describe('SystemPrompt tool order', () => {
  // The ONE place the public constant's value is pinned; everything else
  // (tests and deployment configs alike) references TOOL_ORDER_REST.
  it('exports the rest entry as "<unlisted-tools>"', () => {
    expect(TOOL_ORDER_REST).toBe('<unlisted-tools>')
  })

  it('assembles tools in lexicographic name order when no toolOrder is configured', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mount()
    ctx.systemPrompt.tools(() => ({ schemas: [tool('charlie'), tool('alpha')] }))
    ctx.systemPrompt.tools(() => ({ schemas: [tool('bravo')] }))
    expect(names(await ctx.systemPrompt.assemble())).toEqual(['alpha', 'bravo', 'charlie'])
  })

  it('assembles the same order regardless of provider registration order', async () => {
    /** 中文说明：测试局部值 forward，由紧邻初始化决定。 */
    const forward = await mount()
    forward.systemPrompt.tools(() => ({ schemas: [tool('alpha')] }))
    forward.systemPrompt.tools(() => ({ schemas: [tool('zulu')] }))
    /** 中文说明：测试局部值 backward，由紧邻初始化决定。 */
    const backward = await mount()
    backward.systemPrompt.tools(() => ({ schemas: [tool('zulu')] }))
    backward.systemPrompt.tools(() => ({ schemas: [tool('alpha')] }))
    expect(names(await forward.systemPrompt.assemble())).toEqual(['alpha', 'zulu'])
    expect(names(await backward.systemPrompt.assemble())).toEqual(['alpha', 'zulu'])
  })

  it('applies a configured toolOrder: listed positions, rest at the rest entry lexicographically', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mount({ toolOrder: ['todo_write', TOOL_ORDER_REST, 'bash'] })
    ctx.systemPrompt.tools(() => ({ schemas: [tool('bash'), tool('echo_b'), tool('todo_write'), tool('echo_a')] }))
    expect(names(await ctx.systemPrompt.assemble())).toEqual(['todo_write', 'echo_a', 'echo_b', 'bash'])
  })

  it('rejects the assembly when toolOrder names a tool that is not registered (misconfiguration blocks work)', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mount({ toolOrder: ['todo_write', 'ghost', TOOL_ORDER_REST, 'wraith'] })
    ctx.systemPrompt.tools(() => ({ schemas: [tool('bash'), tool('todo_write')] }))
    await expect(ctx.systemPrompt.assemble()).rejects.toThrow(
      'toolOrder lists unregistered tools "ghost", "wraith"; known tools: bash, todo_write')
  })

  it('names the single unregistered tool when no tools are registered at all', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mount({ toolOrder: ['ghost', TOOL_ORDER_REST] })
    await expect(ctx.systemPrompt.assemble()).rejects.toThrow(
      'toolOrder lists unregistered tool "ghost"; known tools: (none)')
  })

  it.each([
    ['without an explicit toolOrder', undefined],
    ['with only the rest entry configured', [TOOL_ORDER_REST]],
  ])('rejects a provider tool named like the reserved rest entry %s', async (_case, toolOrder) => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mount(toolOrder === undefined ? {} : { toolOrder })
    ctx.systemPrompt.tools(() => ({ schemas: [tool(TOOL_ORDER_REST)] }))
    await expect(ctx.systemPrompt.assemble()).rejects.toThrow(
      `tool provider returned reserved tool name "${TOOL_ORDER_REST}"`)
  })

  it('keeps collection order between tools that share a name (stable sort)', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mount()
    ctx.systemPrompt.tools(() => ({ schemas: [tool('dup', 'first'), tool('anchor'), tool('dup', 'second')] }))
    /** 中文说明：测试局部值 assembly，由紧邻初始化决定。 */
    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.tools.map(t => t.description)).toEqual(['anchor', 'first', 'second'])
  })

  it('canonicalizes BEFORE the assemble waterfall: listeners see the ordered list and own their own edits', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mount()
    ctx.systemPrompt.tools(() => ({ schemas: [tool('zulu'), tool('alpha')] }))
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    let seen: string[] | undefined
    ctx.on('system-prompt/assemble', function (assembly, _context, next) {
      seen = assembly.tools.map(t => t.name)
      // A listener-appended tool is NOT re-sorted — same contract as sections:
      // canonicalization applies to what the registry contributed, and a
      // listener owns the determinism of what it emits.
      assembly.tools.push(tool('aardvark'))
      return next()
    })
    /** 中文说明：测试局部值 assembly，由紧邻初始化决定。 */
    const assembly = await ctx.systemPrompt.assemble()
    expect(seen).toEqual(['alpha', 'zulu'])
    expect(names(assembly)).toEqual(['alpha', 'zulu', 'aardvark'])
  })

  it.each([
    ['an empty list', []],
    ['a list without the rest entry', ['bash', 'todo_write']],
  ])('rejects %s at load (the rest entry is required)', async (_case, toolOrder) => {
    await expect(new Context().plugin(SystemPrompt, { toolOrder })).rejects.toThrow(`must contain the "${TOOL_ORDER_REST}" rest entry`)
  })

  it.each([
    ['a duplicate tool name', ['bash', 'bash', TOOL_ORDER_REST]],
    ['a duplicate rest entry', [TOOL_ORDER_REST, 'bash', TOOL_ORDER_REST]],
  ])('rejects %s at load', async (_case, toolOrder) => {
    await expect(new Context().plugin(SystemPrompt, { toolOrder })).rejects.toThrow('more than once')
  })

  it('throws from direct construction too', () => {
    expect(() => new SystemPrompt(new Context(), { toolOrder: ['bash'] })).toThrow('rest entry')
  })
})
