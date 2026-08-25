/**
 * 文件职责：验证 LSP 连接、生命周期、协议转换与语言服务器协作行为（lifecycle.spec.ts）。
 * 技术维度：TypeScript、Vitest、JSON-RPC/LSP 协议、Node.js 流与可控进程。
 * 产品维度：保障语言服务器能力能被 Agent 稳定调用。
 * 逻辑维度：准备连接或测试进程，发送协议消息并核对结果与清理。
 * 关键边界：帧长度、进程退出和取消均可能导致异步失败。
 * 新手阅读建议：先读辅助对象，再看连接流程，最后阅读异常场景。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Lsp, { type LspProvider, type LspQueryRequest, type LspQueryResult } from '@deepseek-ai/dsh-lsp'
import { deadline } from '@deepseek-ai/dsh-timeout'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import * as LspLocal from '@deepseek-ai/dsh-lsp-stdio'
import type { LspLocalServerConfig } from '@deepseek-ai/dsh-lsp-stdio'

/** 中文说明：变量 fixtureServer 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const fixtureServer = fileURLToPath(new URL('./fixture-server.ts', import.meta.url))

/** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let root: string
/** 中文说明：变量 ws 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let ws: string

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'lsp-local-')))
  ws = join(root, 'ws')
  await mkdir(ws)
  await writeFile(join(ws, 'a.ts'), 'const x = 1\nconst y = x\n')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/** One fake stdio server entry with optional behavior and host-bound overrides. */
/** 中文说明：函数 fakeServer 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function fakeServer(fakeEnv: Record<string, string> = {}, overrides: Partial<LspLocalServerConfig> = {}): LspLocalServerConfig {
  return {
    command: process.execPath,
    args: [fixtureServer],
    env: { ...fakeEnv },
    extensionToLanguage: { '.ts': 'typescript' },
    ...overrides,
  }
}

/** Mount the real seam + lsp-stdio plugin driving one fake server. */
/** 中文说明：函数 mount 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function mount(
  fakeEnv: Record<string, string> = {},
  overrides: Partial<LspLocalServerConfig> = {},
  captureProvider?: (provider: LspProvider) => void,
): Promise<Context> {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  await ctx.plugin(Lsp)
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(LocalFileSystem, { cwd: process.cwd() })
  /** 中文说明：变量 register 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const register = ctx.lsp.registerProvider.bind(ctx.lsp)
  /** 中文说明：变量 registrationSpy 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const registrationSpy = captureProvider === undefined
    ? undefined
    : vi.spyOn(ctx.lsp, 'registerProvider').mockImplementation((provider) => {
      captureProvider(provider)
      return register(provider)
    })
  try {
    await ctx.plugin(LspLocal, {
      servers: { fake: fakeServer(fakeEnv, overrides) },
    })
  } finally {
    registrationSpy?.mockRestore()
  }
  return ctx
}

/** 中文说明：函数 query 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function query(operation: LspQueryRequest['operation'], filePath = 'a.ts'): LspQueryRequest {
  return { operation, filePath, position: { line: 0, character: 6 }, workspaceRoot: ws }
}

/** A single Location JSON pointing into the workspace. */
/** 中文说明：函数 locationJson 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function locationJson(line: number): unknown {
  return { uri: pathToFileURL(join(ws, 'a.ts')).href, range: { start: { line, character: 0 }, end: { line, character: 3 } } }
}

describe('lsp-stdio end to end over a fake server', () => {
  it('routes different extensions to independent configured servers', async () => {
    await writeFile(join(ws, 'a.py'), 'x = 1\n')
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(Lsp)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(LocalFileSystem, { cwd: process.cwd() })
    await ctx.plugin(LspLocal, {
      servers: {
        typescript: fakeServer({ LSP_FAKE_HOVER: JSON.stringify({ contents: 'ts' }) }),
        python: fakeServer(
          { LSP_FAKE_HOVER: JSON.stringify({ contents: 'py' }) },
          { extensionToLanguage: { '.py': 'python' } },
        ),
      },
    })
    expect(await ctx.lsp.query(query('hover', 'a.ts'))).toEqual({ kind: 'hover', hover: { contents: 'ts' } })
    expect(await ctx.lsp.query(query('hover', 'a.py'))).toEqual({ kind: 'hover', hover: { contents: 'py' } })
    await ctx.fiber.dispose()
  })

  it('resolves definition to normalized locations', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await mount({ LSP_FAKE_DEF: JSON.stringify(locationJson(0)) })
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await ctx.lsp.query(query('goToDefinition'))
    expect(result).toEqual<LspQueryResult>({
      kind: 'locations',
      locations: [{ uri: pathToFileURL(join(ws, 'a.ts')).href, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } } }],
      resolvedWorkspaceUri: pathToFileURL(ws).href,
    })
    await ctx.fiber.dispose()
  })

  it('maps a LocationLink for implementation', async () => {
    /** 中文说明：变量 link 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const link = { targetUri: pathToFileURL(join(ws, 'a.ts')).href, targetSelectionRange: { start: { line: 1, character: 0 }, end: { line: 1, character: 2 } } }
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await mount({ LSP_FAKE_IMPL: JSON.stringify([link]) })
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await ctx.lsp.query(query('goToImplementation'))
    expect(result).toMatchObject({ kind: 'locations', locations: [{ range: { start: { line: 1, character: 0 } } }] })
    await ctx.fiber.dispose()
  })

  it('returns references (server includes the declaration)', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await mount({ LSP_FAKE_REFS: JSON.stringify([locationJson(0), locationJson(1)]) })
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await ctx.lsp.query(query('findReferences'))
    expect(result).toMatchObject({ kind: 'locations' })
    if (result.kind !== 'locations') throw new Error('expected locations')
    expect(result.locations).toHaveLength(2)
    await ctx.fiber.dispose()
  })

  it('normalizes a hover MarkupContent', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await mount({ LSP_FAKE_HOVER: JSON.stringify({ contents: { kind: 'markdown', value: 'docs' } }) })
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await ctx.lsp.query(query('hover'))
    expect(result).toEqual({ kind: 'hover', hover: { contents: 'docs' } })
    await ctx.fiber.dispose()
  })

  it('returns an empty locations result for a null definition', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await mount({ LSP_FAKE_DEF: 'null' })
    expect(await ctx.lsp.query(query('goToDefinition'))).toEqual({ kind: 'locations', locations: [], resolvedWorkspaceUri: pathToFileURL(ws).href })
    await ctx.fiber.dispose()
  })

  it('returns a null hover for a null result', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await mount({ LSP_FAKE_HOVER: 'null' })
    expect(await ctx.lsp.query(query('hover'))).toEqual({ kind: 'hover', hover: null })
    await ctx.fiber.dispose()
  })

  it('rejects a non-utf-16 position encoding at initialize without retrying', async () => {
    /** 中文说明：变量 marker 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const marker = join(root, 'initialize-rejection-exit.log')
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await mount({
      LSP_FAKE_ENCODING: 'utf-8',
      LSP_FAKE_DEF: 'null',
      LSP_FAKE_EXIT_MARKER: marker,
    })
    await expect(ctx.lsp.query(query('goToDefinition'))).rejects.toThrow(/unsupported position encoding/)
    expect(await readFile(marker, 'utf8')).toBe('EXIT\nCLEAN\n')
    await ctx.fiber.dispose()
  })

  it('does not pool a poisoned instance when initialize rejects', async () => {
    // A utf-8 server makes `initialize` reject; the instance must be torn down (not left with a
    // permanently-rejecting `ready`) so a later query starts a fresh process rather than reusing it.
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await mount({ LSP_FAKE_ENCODING: 'utf-8', LSP_FAKE_DEF: 'null' })
    await expect(ctx.lsp.query(query('goToDefinition'))).rejects.toThrow(/unsupported position encoding/)
    // A second query must also fail the same way (fresh instance), and must NOT hang on a poisoned one.
    await expect(ctx.lsp.query(query('goToDefinition'))).rejects.toThrow(/unsupported position encoding/)
    await ctx.fiber.dispose()
  })

  it('rejects a server without transient-open sync (None)', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await mount({ LSP_FAKE_SYNC: '0', LSP_FAKE_DEF: 'null' })
    await expect(ctx.lsp.query(query('goToDefinition'))).rejects.toThrow(/transient textDocument\/didOpen/)
    await ctx.fiber.dispose()
  })

  it('accepts openClose options sync', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await mount({ LSP_FAKE_SYNC: JSON.stringify({ openClose: true, change: 2 }), LSP_FAKE_DEF: 'null' })
    expect(await ctx.lsp.query(query('goToDefinition'))).toEqual({ kind: 'locations', locations: [], resolvedWorkspaceUri: pathToFileURL(ws).href })
    await ctx.fiber.dispose()
  })

  it('fails a query for an unsupported operation', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await mount({ LSP_FAKE_CAPS: JSON.stringify({ hoverProvider: false }), LSP_FAKE_DEF: 'null' })
    await expect(ctx.lsp.query(query('hover'))).rejects.toThrow(/does not support hover/)
    await ctx.fiber.dispose()
  })

  it('rejects a source outside the workspace before startup', async () => {
    /** 中文说明：变量 outside 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const outside = join(root, 'out.ts')
    await writeFile(outside, 'x')
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await mount({ LSP_FAKE_DEF: 'null' })
    await expect(ctx.lsp.query({ ...query('goToDefinition'), filePath: outside })).rejects.toThrow(/outside the workspace/)
    await ctx.fiber.dispose()
  })

  it('serializes queries through one instance and runs them in order', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await mount({ LSP_FAKE_DEF: JSON.stringify(locationJson(0)) })
    /** 中文说明：变量 results 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const results = await Promise.all([
      ctx.lsp.query(query('goToDefinition')),
      ctx.lsp.query(query('goToDefinition')),
      ctx.lsp.query(query('goToDefinition')),
    ])
    /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
    for (const result of results) expect(result).toMatchObject({ kind: 'locations' })
    await ctx.fiber.dispose()
  })

  it('reads a queued query source only when its lifecycle starts', async () => {
    /** 中文说明：变量 marker 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const marker = join(root, 'opened.jsonl')
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await mount({
      LSP_FAKE_DEF: 'null',
      LSP_FAKE_REPLY_DELAY_MS: '300',
      LSP_FAKE_OPEN_MARKER: marker,
    })
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = ctx.lsp.query(query('goToDefinition'))
    await waitFor(async () => (await markerLines(marker)).length === 1)
    /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const second = ctx.lsp.query(query('goToDefinition'))
    await writeFile(join(ws, 'a.ts'), 'const changed = 2\n')
    await Promise.all([first, second])
    expect(await markerLines(marker)).toEqual([
      'const x = 1\nconst y = x\n',
      'const changed = 2\n',
    ])
    await ctx.fiber.dispose()
  })

  it('aborts an in-flight query when the signal fires', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await mount({ LSP_FAKE_HANG: '1' })
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = ctx.lsp.query(query('goToDefinition'), controller.signal)
    controller.abort(new Error('caller cancelled'))
    await expect(pending).rejects.toThrow(/cancelled/)
    await ctx.fiber.dispose()
  })

  it('honors an already-aborted signal before any host I/O or startup', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await mount({ LSP_FAKE_DEF: 'null' })
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    controller.abort(new Error('pre-aborted'))
    await expect(ctx.lsp.query(query('goToDefinition'), controller.signal)).rejects.toThrow(/pre-aborted/)
    await ctx.fiber.dispose()
  })

  it('surfaces the server stderr tail in the exit error', async () => {
    // A server that writes to stderr then exits without answering: the query rejection carries the
    // retained stderr tail so the failure is diagnosable.
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await mount({}, {
      command: process.execPath,
      args: ['-e', 'process.stderr.write("FATAL: boom\\n"); setTimeout(()=>process.exit(1), 50)'],
    })
    await expect(ctx.lsp.query(query('goToDefinition'))).rejects.toThrow(/FATAL: boom/)
    await ctx.fiber.dispose()
  })

  it('classifies a timeout deadline as the abort reason', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await mount({ LSP_FAKE_HANG: '1' })
    using d = deadline(undefined, 50, 'TEST_TIMEOUT')
    await expect(ctx.lsp.query(query('goToDefinition'), d.signal)).rejects.toThrow(/TEST_TIMEOUT/)
    await ctx.fiber.dispose()
  })

  it('fails the active query when the server crashes on open, and replaces it next query', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await mount({ LSP_FAKE_CRASH_ON_OPEN: '1', LSP_FAKE_DEF: 'null' }, { shutdownTimeoutMs: 100, killGraceMs: 100 })
    await expect(ctx.lsp.query(query('goToDefinition'))).rejects.toThrow()
    // A later query starts a fresh process; still crashes, but proves the slot was replaced (no hang).
    await expect(ctx.lsp.query(query('goToDefinition'))).rejects.toThrow()
    await ctx.fiber.dispose()
  })

  it('evicts a pooled server that died while idle and serves the next query from a fresh one', async () => {
    // The first query succeeds, then the server exits before the second arrives, leaving a dead
    // instance in the pool. The next query must evict-and-replace it and still succeed, rather than
    // failing once on the closed connection first.
    /** 中文说明：变量 provider 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let provider: LspProvider | undefined
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await mount(
      { LSP_FAKE_EXIT_AFTER_REPLY: '1', LSP_FAKE_DEF: JSON.stringify(locationJson(0)) },
      {},
      (registered) => { provider = registered },
    )
    expect(await ctx.lsp.query(query('goToDefinition'))).toMatchObject({ kind: 'locations' })
    if (provider === undefined) throw new Error('expected lsp-stdio to register a provider')
    // This implementation-local test reaches the private pool only to synchronize with its actual
    // close state. A fixed wall-clock sleep can expire before a CPU-starved child runs its exit timer.
    /** 中文说明：变量 instances 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const instances = (provider as unknown as {
      readonly instances: ReadonlyMap<string, { readonly dead: boolean }>
    }).instances
    /** 中文说明：变量 instance 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const instance = [...instances.values()][0]
    // The query's finally may already have observed the exit and evicted the dead slot. When the
    // slot remains, synchronize with its close before proving the next query replaces it.
    if (instance !== undefined) await waitFor(async () => instance.dead)
    expect(await ctx.lsp.query(query('goToDefinition'))).toMatchObject({ kind: 'locations' })
    await ctx.fiber.dispose()
  })

  it('does not spawn a server when the signal aborts during source read', async () => {
    // Abort right after issuing the query: the abort lands while canonicalizeWorkspace/readHostSource
    // are awaited, so the pre-spawn recheck must reject without ever creating a pooled instance.
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await mount({ LSP_FAKE_DEF: 'null' })
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = ctx.lsp.query(query('goToDefinition'), controller.signal)
    controller.abort(new Error('mid-read cancel'))
    await expect(pending).rejects.toThrow(/mid-read cancel/)
    // A subsequent live query still works, proving no half-created instance poisoned the pool.
    expect(await ctx.lsp.query(query('goToDefinition'))).toEqual({ kind: 'locations', locations: [], resolvedWorkspaceUri: pathToFileURL(ws).href })
    await ctx.fiber.dispose()
  })

  it('aborts and awaits a workspace lookup when the provider is disposed', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await mount({ LSP_FAKE_DEF: 'null' })
    /** 中文说明：变量 fs 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fs = ctx.fs
    /** 中文说明：变量 resolve 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const resolve = fs.resolve.bind(fs)
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = Promise.withResolvers<AbortSignal>()
    /** 中文说明：变量 release 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const release = Promise.withResolvers<undefined>()
    vi.spyOn(fs, 'resolve').mockImplementation(async (path, options) => {
      if (path !== ws) return await resolve(path, options)
      /** 中文说明：变量 signal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const signal = options?.signal
      if (signal === undefined) throw new Error('workspace lookup missing provider lifetime signal')
      started.resolve(signal)
      return await rejectWhenAborted(signal, release.promise)
    })

    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = ctx.lsp.query(query('goToDefinition'))
    /** 中文说明：变量 signal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const signal = await started.promise
    /** 中文说明：变量 disposed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let disposed = false
    /** 中文说明：函数值 disposing 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const disposing = ctx.fiber.dispose().then(() => { disposed = true })
    await new Promise<void>(resolve => setImmediate(resolve))

    expect(signal.aborted).toBe(true)
    expect(disposed).toBe(false)
    release.resolve(undefined)
    await expect(pending).rejects.toThrow('provider is disposed')
    await expect(disposing).resolves.toBeUndefined()
  })

  it('aborts a queued source stream when the provider is disposed', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await mount({ LSP_FAKE_DEF: 'null' })
    /** 中文说明：变量 fs 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fs = ctx.fs
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = Promise.withResolvers<AbortSignal>()
    vi.spyOn(fs, 'streamText').mockImplementation(async (_target, signal) => {
      if (signal === undefined) throw new Error('source read missing provider lifetime signal')
      started.resolve(signal)
      return (async function* () {
        await rejectWhenAborted(signal)
        yield ''
      })()
    })

    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = ctx.lsp.query(query('goToDefinition'))
    /** 中文说明：变量 signal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const signal = await started.promise
    /** 中文说明：变量 disposing 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const disposing = ctx.fiber.dispose()

    await expect(pending).rejects.toThrow('provider is disposed')
    await expect(disposing).resolves.toBeUndefined()
    expect(signal.aborted).toBe(true)
  })

  it('waits for every owned teardown before aggregating instance failures', async () => {
    /** 中文说明：变量 provider 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let provider: LspProvider | undefined
    /** 中文说明：函数值 ctx 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const ctx = await mount({ LSP_FAKE_DEF: 'null' }, {}, (registered) => { provider = registered })
    if (provider === undefined) throw new Error('expected lsp-stdio to register a provider')
    /** 中文说明：变量 internals 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const internals = provider as unknown as {
      readonly instances: Map<string, { dispose(): Promise<void> }>
      readonly queues: Map<string, Promise<void>>
      readonly workspaceLookups: Set<Promise<void>>
      disposeAll(): Promise<void>
    }
    /** 中文说明：变量 firstFailure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const firstFailure = new Error('first instance cleanup failed')
    /** 中文说明：变量 secondFailure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const secondFailure = new Error('second instance cleanup failed')
    /** 中文说明：变量 release 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const release = Promise.withResolvers<undefined>()
    internals.instances.set('first', { dispose: async () => { throw firstFailure } })
    internals.instances.set('second', { dispose: async () => { throw secondFailure } })
    internals.queues.set('pending', release.promise)
    internals.workspaceLookups.add(Promise.resolve())

    /** 中文说明：变量 settled 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let settled = false
    /** 中文说明：函数值 disposing 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const disposing = internals.disposeAll().finally(() => { settled = true })
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(settled).toBe(false)
    release.resolve(undefined)
    await expect(disposing).rejects.toMatchObject({
      errors: [firstFailure, secondFailure],
      message: 'lsp-stdio instance teardown failed',
    })
    expect(internals.instances.size).toBe(0)
    expect(internals.queues.size).toBe(0)
    expect(internals.workspaceLookups.size).toBe(0)
    await ctx.fiber.dispose()
  })

  it('waits for every provider before reporting plugin teardown failure', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    /** 中文说明：变量 disposalErrors 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const disposalErrors: unknown[] = []
    ctx.logger.error = ((error: unknown) => { disposalErrors.push(error) }) as typeof ctx.logger.error
    await ctx.plugin(Lsp)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(LocalFileSystem, { cwd: process.cwd() })
    /** 中文说明：变量 providers 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const providers: LspProvider[] = []
    /** 中文说明：变量 register 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const register = ctx.lsp.registerProvider.bind(ctx.lsp)
    /** 中文说明：函数值 registrationSpy 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const registrationSpy = vi.spyOn(ctx.lsp, 'registerProvider').mockImplementation((provider) => {
      providers.push(provider)
      return register(provider)
    })
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = await ctx.plugin(LspLocal, {
      servers: {
        first: fakeServer(),
        second: fakeServer({}, { extensionToLanguage: { '.js': 'javascript' } }),
      },
    })
    registrationSpy.mockRestore()
    expect(providers).toHaveLength(2)
    /** 中文说明：变量 failure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const failure = new Error('provider cleanup failed')
    /** 中文说明：变量 release 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const release = Promise.withResolvers<undefined>()
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = providers[0] as LspProvider & { disposeAll(): Promise<void> }
    /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const second = providers[1] as LspProvider & { disposeAll(): Promise<void> }
    first.disposeAll = async () => { throw failure }
    second.disposeAll = async () => { await release.promise }

    /** 中文说明：变量 disposed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let disposed = false
    /** 中文说明：函数值 disposing 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const disposing = fiber.dispose().then(() => { disposed = true })
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(disposed).toBe(false)
    expect(disposalErrors).toEqual([])
    release.resolve(undefined)
    await disposing
    expect(disposalErrors).toEqual([failure])
    await ctx.fiber.dispose()
  })

  it('runs distinct workspaces in parallel instances', async () => {
    /** 中文说明：变量 ws2 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ws2 = join(root, 'ws2')
    await mkdir(ws2)
    await writeFile(join(ws2, 'a.ts'), 'const z = 2\n')
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await mount({ LSP_FAKE_DEF: JSON.stringify(locationJson(0)) })
    const [r1, r2] = await Promise.all([
      ctx.lsp.query({ ...query('goToDefinition'), workspaceRoot: ws }),
      ctx.lsp.query({ ...query('goToDefinition'), workspaceRoot: ws2 }),
    ])
    expect(r1).toMatchObject({ kind: 'locations' })
    expect(r2).toMatchObject({ kind: 'locations' })
    await ctx.fiber.dispose()
  })

  it('disposes cleanly, terminating a server that ignores shutdown', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await mount({ LSP_FAKE_NO_SHUTDOWN: '1', LSP_FAKE_DEF: 'null' }, { killGraceMs: 100, shutdownTimeoutMs: 100 })
    await ctx.lsp.query(query('goToDefinition'))
    await expect(ctx.fiber.dispose()).resolves.toBeUndefined()
  })

  it('rejects at load when the command is not found', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(Lsp)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(LocalFileSystem, { cwd: process.cwd() })
    await expect(ctx.plugin(LspLocal, {
      servers: {
        missing: {
          command: 'definitely-not-a-real-lsp-binary-xyz',
          args: [],
          extensionToLanguage: { '.ts': 'typescript' },
        },
      },
    })).rejects.toThrow(/was not found on PATH/)
    await ctx.fiber.dispose()
  })
})

/** Read the fixture's JSON-lines didOpen marker, returning no entries before it exists. */
/** 中文说明：函数 markerLines 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function markerLines(path: string): Promise<string[]> {
  try {
    /** 中文说明：变量 text 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const text = await readFile(path, 'utf8')
    return text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as string)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

/** Poll an asynchronous condition until it succeeds or the test-local deadline expires. */
/** 中文说明：函数 waitFor 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function waitFor(condition: () => Promise<boolean>, timeoutMs = 3000): Promise<void> {
  /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const started = Date.now()
  while (!await condition()) {
    if (Date.now() - started > timeoutMs) throw new Error('waitFor timed out')
    await new Promise<void>(resolve => setTimeout(resolve, 10))
  }
}

/** Hold one fake provider operation until cancellation, optionally behind a cleanup gate. */
/** 中文说明：函数 rejectWhenAborted 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function rejectWhenAborted<T>(signal: AbortSignal, release: Promise<unknown> = Promise.resolve()): Promise<T> {
  return new Promise((_resolve, reject) => {
    /** 中文说明：函数值 onAbort 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const onAbort = (): void => {
      void release.then(() => {
        reject(signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason)))
      })
    }
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
  })
}
