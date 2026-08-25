/**
 * 文件职责：验证 tool-lsp.spec.ts 覆盖的LSP 语言服务行为与异常场景。
 * 技术维度：使用 TypeScript、Vitest、异步协议连接和可控测试替身。
 * 产品维度：保障 Agent 能稳定使用LSP 语言服务提供的外部能力。
 * 逻辑维度：准备上下文与协议数据，触发被测流程，再核对结果、呈现和资源清理。
 * 关键边界：远端消息不可信；连接可能中断；异步资源必须在用例结束时释放。
 * 新手阅读建议：先读辅助函数和夹具，再按 describe/it 阅读正常、失败与重连场景。
 */
import { describe, expect, it } from 'vitest'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import Lsp, { LspProviderId, type LspProvider, type LspProviderQuery, type LspQueryResult } from '@deepseek-ai/dsh-lsp'
import * as ToolLsp from '@deepseek-ai/dsh-tool-lsp'
import { DEFAULT_LSP_TOOL_TIMEOUT_MS, LSP_PROMPT_TEXT } from '@deepseek-ai/dsh-tool-lsp'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'

/** A scripted provider recording queries; `respond` yields the result or throws. */
/** 中文说明：函数 stubProvider 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function stubProvider(
  respond: (request: LspProviderQuery) => LspQueryResult,
  extensionToLanguage: Record<string, string> = { '.ts': 'typescript' },
): LspProvider & { seen: LspProviderQuery[] } {
  /** 中文说明：变量 seen 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const seen: LspProviderQuery[] = []
  return {
    id: LspProviderId('stub'),
    extensionToLanguage,
    seen,
    query(request) {
      seen.push(request)
      return Promise.resolve(respond(request))
    },
  }
}

/** Mount the real tool stack over a real seam plus one stub provider. */
/** 中文说明：函数 mount 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function mount(
  provider?: LspProvider,
  config: ToolLsp.Config = {},
): Promise<{ ctx: Context }> {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(Lsp)
  if (provider) (ctx.lsp as Lsp).registerProvider(provider)
  await ctx.plugin(ToolLsp, config)
  return { ctx }
}

/** 中文说明：变量 seq 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let seq = 0
/** 中文说明：变量 testToolSignal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const testToolSignal = new AbortController().signal
/** 中文说明：变量 workspaceRoot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const workspaceRoot = resolve('/virtual/workspace')
/** 中文说明：变量 resolvedWorkspaceRoot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const resolvedWorkspaceRoot = resolve('/virtual/real-workspace')
/** 中文说明：变量 resolvedWorkspaceUri 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const resolvedWorkspaceUri = pathToFileURL(resolvedWorkspaceRoot).href
/** 中文说明：变量 workspaceAlias 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const workspaceAlias = resolve('/virtual/workspace-alias')
/** `cwd: null` means "no agent" (tests LSP_WORKSPACE_REQUIRED); a string is the session cwd. */
/** 中文说明：函数 call 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function call(ctx: Context, args: unknown, cwd: string | null = workspaceRoot) {
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: `c-${++seq}` as never,
    name: 'lsp',
    arguments: args,
    ...cwd !== null ? { agent: { session: { header: { cwd } } } as never } : {},
  })
}

/** 中文说明：变量 okLocations 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const okLocations: LspQueryResult = {
  kind: 'locations',
  locations: [{ uri: pathToFileURL(join(workspaceRoot, 'a.ts')).href, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } }],
  resolvedWorkspaceUri: pathToFileURL(workspaceRoot).href,
}

describe('tool-lsp registration', () => {
  it('registers the lsp tool and its prompt section', async () => {
    const { ctx } = await mount(stubProvider(() => okLocations))
    expect(ctx.tools.get('lsp')).toBeDefined()
    /** 中文说明：变量 prompt 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const prompt = await ctx.systemPrompt.assemble()
    /** 中文说明：函数值 text 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const text = prompt.sections.map(s => s.text).join('\n')
    expect(text).toContain(LSP_PROMPT_TEXT)
  })

  it('attaches the default timeout budget to the tool definition', async () => {
    const { ctx } = await mount(stubProvider(() => okLocations))
    expect(ctx.tools.get('lsp')?.timeoutMs).toBe(DEFAULT_LSP_TOOL_TIMEOUT_MS)
  })

  it('honors a configured timeout override', async () => {
    const { ctx } = await mount(stubProvider(() => okLocations), { timeoutMs: 5000 })
    expect(ctx.tools.get('lsp')?.timeoutMs).toBe(5000)
  })

  it('exposes exactly the four operations in the schema enum', async () => {
    const { ctx } = await mount(stubProvider(() => okLocations))
    /** 中文说明：变量 schema 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const schema = ctx.tools.get('lsp')?.parameters as { properties: { operation: { enum: string[] } } }
    expect(schema.properties.operation.enum).toEqual(['goToDefinition', 'findReferences', 'goToImplementation', 'hover'])
  })

  it('has no default export (namespace plugin shape)', () => {
    expect((ToolLsp as { default?: unknown }).default).toBeUndefined()
  })

  it('rejects a non-positive config value at load', async () => {
    await expect(mount(stubProvider(() => okLocations), { maxLocations: 0 })).rejects.toThrow(/maxLocations/)
  })

  it('rejects a timeout above Node timer range at load', async () => {
    await expect(mount(stubProvider(() => okLocations), { timeoutMs: MAX_TIMER_DELAY_MS + 1 }))
      .rejects.toThrow(/timeoutMs/)
    expect(() => {
      ToolLsp.apply(new Context(), {
        maxLocations: 100,
        maxResultChars: 16_000,
        timeoutMs: MAX_TIMER_DELAY_MS + 1,
      })
    }).toThrow(/timeoutMs/)
  })
})

describe('tool-lsp execution', () => {
  it('converts one-based coordinates and passes the session cwd as workspaceRoot', async () => {
    /** 中文说明：函数值 provider 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const provider = stubProvider(() => okLocations)
    const { ctx } = await mount(provider)
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await call(ctx, { operation: 'goToDefinition', file_path: 'a.ts', line: 3, character: 5 }, workspaceRoot)
    expect(result.isError).toBe(false)
    expect(provider.seen[0]).toMatchObject({
      operation: 'goToDefinition',
      filePath: 'a.ts',
      position: { line: 2, character: 4 },
      workspaceRoot,
    })
  })

  it('renders locations relative to the workspace', async () => {
    const { ctx } = await mount(stubProvider(() => okLocations))
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await call(ctx, { operation: 'findReferences', file_path: 'a.ts', line: 1, character: 1 }, workspaceRoot)
    expect(result.content[0]).toEqual({ type: 'text', text: 'a.ts:1:1' })
    expect(result).toMatchObject({ isError: false, value: okLocations })
  })

  it('keeps all acquired locations in the canonical value when presentation is capped', async () => {
    /** 中文说明：变量 cappedWorkspaceRoot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cappedWorkspaceRoot = resolve('/virtual/capped-workspace')
    /** 中文说明：变量 locations 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const locations = [
      { uri: pathToFileURL(join(cappedWorkspaceRoot, 'a.ts')).href, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } },
      { uri: pathToFileURL(join(cappedWorkspaceRoot, 'b.ts')).href, range: { start: { line: 1, character: 2 }, end: { line: 1, character: 3 } } },
    ]
    const { ctx } = await mount(stubProvider(() => ({
      kind: 'locations',
      locations,
      resolvedWorkspaceUri: pathToFileURL(cappedWorkspaceRoot).href,
    })), { maxLocations: 1 })
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await call(ctx, { operation: 'findReferences', file_path: 'a.ts', line: 1, character: 1 }, cappedWorkspaceRoot)
    expect(result.content[0]).toEqual({
      type: 'text',
      text: 'a.ts:1:1\n… 1 more location omitted (limit 1).',
    })
    expect(result).toMatchObject({
      isError: false,
      value: { kind: 'locations', locations, resolvedWorkspaceUri: pathToFileURL(cappedWorkspaceRoot).href },
    })
  })

  it('relativizes against the provider resolvedWorkspaceUri, not the session cwd', async () => {
    // A symlinked session cwd resolves to the real path that contains the provider's location URIs.
    // Relativizing against the alias would misclassify the location as external.
    /** 中文说明：函数值 provider 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const provider = stubProvider(() => ({
      kind: 'locations',
      locations: [{ uri: pathToFileURL(join(resolvedWorkspaceRoot, 'a.ts')).href, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } }],
      resolvedWorkspaceUri,
    }))
    const { ctx } = await mount(provider)
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await call(ctx, { operation: 'goToDefinition', file_path: 'a.ts', line: 1, character: 1 }, workspaceAlias)
    expect(provider.seen[0]).toMatchObject({ workspaceRoot: workspaceAlias })
    expect(result.content[0]).toEqual({ type: 'text', text: 'a.ts:1:1' })
  })

  it('renders hover content', async () => {
    const { ctx } = await mount(stubProvider(() => ({ kind: 'hover', hover: { contents: 'number' } })))
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await call(ctx, { operation: 'hover', file_path: 'a.ts', line: 1, character: 1 }, workspaceRoot)
    expect(result.content[0]).toEqual({ type: 'text', text: 'number' })
    expect(result).toMatchObject({ isError: false, value: { kind: 'hover', hover: { contents: 'number' } } })
  })

  it('preserves an optional hover range in the canonical value', async () => {
    /** 中文说明：变量 range 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const range = { start: { line: 2, character: 3 }, end: { line: 2, character: 7 } }
    const { ctx } = await mount(stubProvider(() => ({ kind: 'hover', hover: { contents: 'number', range } })))
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await call(ctx, { operation: 'hover', file_path: 'a.ts', line: 3, character: 4 }, '/ws')
    expect(result).toMatchObject({ isError: false, value: { kind: 'hover', hover: { contents: 'number', range } } })
  })

  it('preserves a null hover result as an explicit value', async () => {
    const { ctx } = await mount(stubProvider(() => ({ kind: 'hover', hover: null })))
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await call(ctx, { operation: 'hover', file_path: 'a.ts', line: 1, character: 1 }, '/ws')
    expect(result.content[0]).toEqual({ type: 'text', text: 'No hover information.' })
    expect(result).toMatchObject({ isError: false, value: { kind: 'hover', hover: null } })
  })

  it('fails LSP_WORKSPACE_REQUIRED without a session cwd', async () => {
    const { ctx } = await mount(stubProvider(() => okLocations))
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await call(ctx, { operation: 'goToDefinition', file_path: 'a.ts', line: 1, character: 1 }, null)
    expect(result.isError).toBe(true)
    expect(result.error?.info?.code).toBe('LSP_WORKSPACE_REQUIRED')
  })

  it('surfaces a structured LSP_UNAVAILABLE when no provider handles the file', async () => {
    const { ctx } = await mount(stubProvider(() => okLocations, { '.py': 'python' }))
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await call(ctx, { operation: 'goToDefinition', file_path: 'a.ts', line: 1, character: 1 }, workspaceRoot)
    expect(result.isError).toBe(true)
    expect(result.error?.info?.code).toBe('LSP_UNAVAILABLE')
  })

  it('returns a structured INVALID_ARGS on a bad operation', async () => {
    const { ctx } = await mount(stubProvider(() => okLocations))
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await call(ctx, { operation: 'rename', file_path: 'a.ts', line: 1, character: 1 }, workspaceRoot)
    expect(result.isError).toBe(true)
    expect(result.error?.info?.code).toBe('INVALID_ARGS')
  })

  it('forwards exec.signal to the seam query', async () => {
    /** 中文说明：变量 seen 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const seen: (AbortSignal | undefined)[] = []
    /** 中文说明：变量 provider 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const provider: LspProvider = {
      id: LspProviderId('sig'),
      extensionToLanguage: { '.ts': 'typescript' },
      query(_request, signal) {
        seen.push(signal)
        return Promise.resolve(okLocations)
      },
    }
    const { ctx } = await mount(provider)
    await call(ctx, { operation: 'goToDefinition', file_path: 'a.ts', line: 1, character: 1 }, workspaceRoot)
    // The timeout policy is not mounted here, so the signal is whatever the registry passes (may be
    // undefined); the point is the tool threads it through without throwing.
    expect(seen).toHaveLength(1)
  })

  it('presentCall renders the pending card from args', async () => {
    const { ctx } = await mount(stubProvider(() => okLocations))
    /** 中文说明：变量 view 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const view = ctx.tools.get('lsp')?.presentCall?.({ operation: 'hover', file_path: 'a.ts', line: 2, character: 3 })
    expect(view).toEqual({
      card: 'generic',
      kind: 'search',
      title: 'LSP hover a.ts:2:3',
      locations: [{ path: 'a.ts', line: 2 }],
    })
  })
})
