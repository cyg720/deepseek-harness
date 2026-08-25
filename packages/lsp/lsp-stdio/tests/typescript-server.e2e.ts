/**
 * Keyless real-server e2e: drives the real `typescript-language-server` through the full
 * `ctx.lsp` → `dsh-lsp-stdio` stack over the base protocol, exercising all four operations. No API
 * key needed — the server is a local dev dependency. This establishes one compatibility floor
 * (TypeScript), not a cross-language claim.
 */
/**
 * 文件职责：验证 LSP 连接、生命周期、协议转换与语言服务器协作行为（typescript-server.e2e.ts）。
 * 技术维度：TypeScript、Vitest、JSON-RPC/LSP 协议、Node.js 流与可控进程。
 * 产品维度：保障语言服务器能力能被 Agent 稳定调用。
 * 逻辑维度：准备连接或测试进程，发送协议消息并核对结果与清理。
 * 关键边界：帧长度、进程退出和取消均可能导致异步失败。
 * 新手阅读建议：先读辅助对象，再看连接流程，最后阅读异常场景。
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import Lsp, { type LspQueryRequest, type LspQueryResult } from '@deepseek-ai/dsh-lsp'
import * as LspLocal from '@deepseek-ai/dsh-lsp-stdio'

// The server binary is a dev dependency of this package; resolve its pnpm-hoisted .bin path.
/** 中文说明：变量 serverBin 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const serverBin = join(
  new URL('..', import.meta.url).pathname,
  'node_modules',
  '.bin',
  'typescript-language-server',
)

/** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let root: string
/** 中文说明：变量 ws 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let ws: string
/** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let ctx: Context

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'lsp-ts-e2e-')))
  ws = join(root, 'proj')
  await mkdir(ws)
  await writeFile(join(ws, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, module: 'nodenext' } }))
  // A small program with a definition, a reference, an interface + implementation, and a typed value.
  await writeFile(join(ws, 'shapes.ts'), [
    'export interface Shape {',
    '  area(): number',
    '}',
    '',
    'export class Circle implements Shape {',
    '  constructor(private r: number) {}',
    '  area(): number { return Math.PI * this.r * this.r }',
    '}',
    '',
    'export function describe(s: Shape): string {',
    '  return `area=${s.area()}`',
    '}',
    '',
    'const c = new Circle(2)',
    'export const text = describe(c)',
    '',
  ].join('\n'))

  ctx = new Context()
  await ctx.plugin(Lsp)
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(LocalFileSystem, { cwd: process.cwd() })
  await ctx.plugin(LspLocal, {
    servers: {
      typescript: {
        command: serverBin,
        args: ['--stdio'],
        extensionToLanguage: { '.ts': 'typescript', '.tsx': 'typescriptreact' },
      },
    },
  })
}, 60_000)

afterAll(async () => {
  if (ctx) await ctx.fiber.dispose()
  if (root) await rm(root, { recursive: true, force: true })
})

/** One-based helper mirroring the model contract, converted to the seam's zero-based position. */
/** 中文说明：函数 at 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function at(operation: LspQueryRequest['operation'], line1: number, char1: number, filePath = 'shapes.ts'): LspQueryRequest {
  return { operation, filePath, position: { line: line1 - 1, character: char1 - 1 }, workspaceRoot: ws }
}

/** 中文说明：函数 locations 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function locations(result: LspQueryResult): readonly { uri: string }[] {
  if (result.kind !== 'locations') throw new Error(`expected locations, got ${result.kind}`)
  return result.locations
}

describe('real typescript-language-server', () => {
  it('resolves the definition of a call site to its declaration', async () => {
    // `export const text = describe(c)` (line 15): `describe` begins at column 21.
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await ctx.lsp.query(at('goToDefinition', 15, 22))
    /** 中文说明：变量 locs 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const locs = locations(result)
    expect(locs.length).toBeGreaterThanOrEqual(1)
    expect(locs.some(l => l.uri.endsWith('shapes.ts'))).toBe(true)
  }, 60_000)

  it('finds references to a symbol including its declaration', async () => {
    // References to `describe` from its declaration (line 10, col 17).
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await ctx.lsp.query(at('findReferences', 10, 17))
    /** 中文说明：变量 locs 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const locs = locations(result)
    // At least the declaration plus the call site.
    expect(locs.length).toBeGreaterThanOrEqual(2)
  }, 60_000)

  it('resolves implementations of an interface', async () => {
    // Implementations of `Shape` (line 1, col 18) → Circle.
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await ctx.lsp.query(at('goToImplementation', 1, 18))
    /** 中文说明：变量 locs 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const locs = locations(result)
    expect(locs.length).toBeGreaterThanOrEqual(1)
  }, 60_000)

  it('returns hover information for a typed symbol', async () => {
    // Hover on `Circle` in `new Circle(2)` (line 14, col 15).
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await ctx.lsp.query(at('hover', 14, 15))
    expect(result.kind).toBe('hover')
    if (result.kind === 'hover') {
      expect(result.hover).not.toBeNull()
      expect(result.hover?.contents).toContain('Circle')
    }
  }, 60_000)
})
