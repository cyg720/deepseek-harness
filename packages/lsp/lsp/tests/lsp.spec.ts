/**
 * 文件职责：验证 lsp.spec.ts 覆盖的LSP 语言服务行为与异常场景。
 * 技术维度：使用 TypeScript、Vitest、异步协议连接和可控测试替身。
 * 产品维度：保障 Agent 能稳定使用LSP 语言服务提供的外部能力。
 * 逻辑维度：准备上下文与协议数据，触发被测流程，再核对结果、呈现和资源清理。
 * 关键边界：远端消息不可信；连接可能中断；异步资源必须在用例结束时释放。
 * 新手阅读建议：先读辅助函数和夹具，再按 describe/it 阅读正常、失败与重连场景。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Lsp, {
  finalExtension,
  LspError,
  LspProviderId,
  /** 中文说明：type LspProvider 定义本测试所需的数据或行为，用于表达当前协议场景。 */
  type LspProvider,
  /** 中文说明：type LspProviderQuery 定义本测试所需的数据或行为，用于表达当前协议场景。 */
  type LspProviderQuery,
  /** 中文说明：type LspQueryResult 定义本测试所需的数据或行为，用于表达当前协议场景。 */
  type LspQueryResult,
} from '@deepseek-ai/dsh-lsp'

/** A scripted provider that records the queries it receives. */
/* 中文说明：函数 makeProvider 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function makeProvider(
  id: string,
  extensionToLanguage: Record<string, string>,
  result: LspQueryResult = { kind: 'locations', locations: [], resolvedWorkspaceUri: 'file:///ws' },
): LspProvider & { seen: LspProviderQuery[]; seenSignals: (AbortSignal | undefined)[] } {
  /** 中文说明：变量 seen 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const seen: LspProviderQuery[] = []
  /** 中文说明：变量 seenSignals 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const seenSignals: (AbortSignal | undefined)[] = []
  return {
    id: LspProviderId(id),
    extensionToLanguage,
    seen,
    seenSignals,
    query(request, signal) {
      seen.push(request)
      seenSignals.push(signal)
      return Promise.resolve(result)
    },
  }
}

/** Mount an Lsp service on a fresh root context. */
/* 中文说明：函数 mountLsp 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function mountLsp(): Promise<{ ctx: Context; lsp: Lsp }> {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  await ctx.plugin(Lsp)
  return { ctx, lsp: ctx.lsp as Lsp }
}

/** 中文说明：变量 hover 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const hover: LspQueryResult = { kind: 'hover', hover: { contents: 'x' } }

/** 中文说明：函数 query 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function query(filePath: string, operation: LspProviderQuery['operation'] = 'goToDefinition'): Parameters<Lsp['query']>[0] {
  return { operation, filePath, position: { line: 0, character: 0 }, workspaceRoot: '/ws' }
}

describe('finalExtension', () => {
  it('lowercases and keeps only the final extension', () => {
    expect(finalExtension('src/Foo.TS')).toBe('.ts')
    expect(finalExtension('a/b/foo.d.ts')).toBe('.ts')
    expect(finalExtension('C:\\proj\\Main.CS')).toBe('.cs')
  })

  it('returns empty for no extension or a leading-dot dotfile', () => {
    expect(finalExtension('Makefile')).toBe('')
    expect(finalExtension('.bashrc')).toBe('')
    expect(finalExtension('dir.d/file')).toBe('')
  })
})

describe('Lsp registration', () => {
  it('registers a provider and routes a query to it, then releases on dispose', async () => {
    const { lsp } = await mountLsp()
    /** 中文说明：变量 provider 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const provider = makeProvider('ts', { '.ts': 'typescript' })
    /** 中文说明：变量 dispose 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dispose = lsp.registerProvider(provider)

    await expect(lsp.query(query('a.ts'))).resolves.toEqual({ kind: 'locations', locations: [], resolvedWorkspaceUri: 'file:///ws' })
    expect(provider.seen[0]).toMatchObject({ filePath: 'a.ts', languageId: 'typescript' })

    dispose()
    await expect(lsp.query(query('a.ts'))).rejects.toThrow(expect.objectContaining({ code: 'LSP_UNAVAILABLE' }))
  })

  it('normalizes extension keys to lowercase leading-dot and derives the language id', async () => {
    const { lsp } = await mountLsp()
    /** 中文说明：变量 provider 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const provider = makeProvider('ts', { TS: 'typescript' })
    lsp.registerProvider(provider)
    await lsp.query(query('a.ts'))
    expect(provider.seen[0]?.languageId).toBe('typescript')
  })

  it('rejects an empty provider id (LSP_INVALID_PROVIDER)', async () => {
    const { lsp } = await mountLsp()
    expect(() => lsp.registerProvider(makeProvider('  ', { '.ts': 'typescript' })))
      .toThrow(expect.objectContaining({ code: 'LSP_INVALID_PROVIDER' }))
  })

  it('rejects a provider with no extensions (LSP_INVALID_PROVIDER)', async () => {
    const { lsp } = await mountLsp()
    expect(() => lsp.registerProvider(makeProvider('ts', {})))
      .toThrow(expect.objectContaining({ code: 'LSP_INVALID_PROVIDER' }))
  })

  it('rejects an invalid extension mapping (LSP_INVALID_PROVIDER)', async () => {
    const { lsp } = await mountLsp()
    expect(() => lsp.registerProvider(makeProvider('ts', { '.tar.gz': 'archive' })))
      .toThrow(expect.objectContaining({ code: 'LSP_INVALID_PROVIDER' }))
  })

  it('rejects an empty language id (LSP_INVALID_PROVIDER)', async () => {
    const { lsp } = await mountLsp()
    expect(() => lsp.registerProvider(makeProvider('ts', { '.ts': '  ' })))
      .toThrow(expect.objectContaining({ code: 'LSP_INVALID_PROVIDER' }))
  })

  it('rejects an extension mapped twice within one provider (LSP_INVALID_PROVIDER)', async () => {
    const { lsp } = await mountLsp()
    expect(() => lsp.registerProvider(makeProvider('ts', { '.ts': 'typescript', TS: 'ts2' })))
      .toThrow(expect.objectContaining({ code: 'LSP_INVALID_PROVIDER' }))
  })

  it('rejects a duplicate provider id (LSP_CONFLICT)', async () => {
    const { lsp } = await mountLsp()
    lsp.registerProvider(makeProvider('ts', { '.ts': 'typescript' }))
    expect(() => lsp.registerProvider(makeProvider('ts', { '.tsx': 'typescriptreact' })))
      .toThrow(expect.objectContaining({ code: 'LSP_CONFLICT' }))
  })

  it('rejects an extension already owned by another provider (LSP_CONFLICT)', async () => {
    const { lsp } = await mountLsp()
    lsp.registerProvider(makeProvider('ts', { '.ts': 'typescript' }))
    expect(() => lsp.registerProvider(makeProvider('other', { '.ts': 'other-lang' })))
      .toThrow(expect.objectContaining({ code: 'LSP_CONFLICT' }))
  })

  it('publishes nothing when a later extension conflicts (atomic reservation)', async () => {
    const { lsp } = await mountLsp()
    lsp.registerProvider(makeProvider('ts', { '.ts': 'typescript' }))
    // This provider's `.py` is free but `.ts` conflicts: the whole registration must roll back.
    expect(() => lsp.registerProvider(makeProvider('py-ts', { '.py': 'python', '.ts': 'x' })))
      .toThrow(expect.objectContaining({ code: 'LSP_CONFLICT' }))
    // `.py` must NOT have been reserved.
    await expect(lsp.query(query('a.py'))).rejects.toThrow(expect.objectContaining({ code: 'LSP_UNAVAILABLE' }))
  })

  it('releases every extension and the id together on dispose', async () => {
    const { lsp } = await mountLsp()
    /** 中文说明：变量 dispose 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dispose = lsp.registerProvider(makeProvider('multi', { '.ts': 'typescript', '.tsx': 'typescriptreact' }))
    dispose()
    await expect(lsp.query(query('a.ts'))).rejects.toThrow(expect.objectContaining({ code: 'LSP_UNAVAILABLE' }))
    await expect(lsp.query(query('a.tsx'))).rejects.toThrow(expect.objectContaining({ code: 'LSP_UNAVAILABLE' }))
    // The id is free again after release.
    expect(() => lsp.registerProvider(makeProvider('multi', { '.ts': 'typescript' }))).not.toThrow()
  })

  it('selection is order-independent across two providers', async () => {
    const { lsp } = await mountLsp()
    /** 中文说明：变量 ts 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ts = makeProvider('ts', { '.ts': 'typescript' }, hover)
    /** 中文说明：变量 py 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const py = makeProvider('py', { '.py': 'python' })
    lsp.registerProvider(ts)
    lsp.registerProvider(py)
    await expect(lsp.query(query('a.py'))).resolves.toEqual({ kind: 'locations', locations: [], resolvedWorkspaceUri: 'file:///ws' })
    await expect(lsp.query(query('a.ts', 'hover'))).resolves.toEqual(hover)
  })

  it('forwards the abort signal verbatim to the provider', async () => {
    const { lsp } = await mountLsp()
    /** 中文说明：变量 provider 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const provider = makeProvider('ts', { '.ts': 'typescript' })
    lsp.registerProvider(provider)
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    await lsp.query(query('a.ts'), controller.signal)
    expect(provider.seenSignals[0]).toBe(controller.signal)
  })

  it('fails LSP_UNAVAILABLE when no provider handles the extension', async () => {
    const { lsp } = await mountLsp()
    lsp.registerProvider(makeProvider('ts', { '.ts': 'typescript' }))
    await expect(lsp.query(query('a.py'))).rejects.toThrow(expect.objectContaining({ code: 'LSP_UNAVAILABLE' }))
  })

  it('disposes provider registrations when the contributing fiber is disposed (HMR safety)', async () => {
    const { ctx, lsp } = await mountLsp()
    /** 中文说明：函数值 fiber 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const fiber = await ctx.plugin(Object.assign((inner: Context) => {
      inner.lsp.registerProvider(makeProvider('ts', { '.ts': 'typescript' }))
    }, { inject: ['lsp'] }))
    await expect(lsp.query(query('a.ts'))).resolves.toEqual({ kind: 'locations', locations: [], resolvedWorkspaceUri: 'file:///ws' })
    await fiber.dispose()
    await expect(lsp.query(query('a.ts'))).rejects.toThrow(expect.objectContaining({ code: 'LSP_UNAVAILABLE' }))
  })

  it('LspError carries its structured code', () => {
    expect(new LspError('m', 'LSP_UNAVAILABLE').code).toBe('LSP_UNAVAILABLE')
  })

  it('brands a provider id without altering the string', () => {
    expect(LspProviderId('ts')).toBe('ts')
  })
})
