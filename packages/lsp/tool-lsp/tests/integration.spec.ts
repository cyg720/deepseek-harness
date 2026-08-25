/**
 * 文件职责：验证 integration.spec.ts 覆盖的LSP 语言服务行为与异常场景。
 * 技术维度：使用 TypeScript、Vitest、异步协议连接和可控测试替身。
 * 产品维度：保障 Agent 能稳定使用LSP 语言服务提供的外部能力。
 * 逻辑维度：准备上下文与协议数据，触发被测流程，再核对结果、呈现和资源清理。
 * 关键边界：远端消息不可信；连接可能中断；异步资源必须在用例结束时释放。
 * 新手阅读建议：先读辅助函数和夹具，再按 describe/it 阅读正常、失败与重连场景。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import Lsp from '@deepseek-ai/dsh-lsp'
import * as LspLocal from '@deepseek-ai/dsh-lsp-stdio'
import * as TimeoutPolicy from '@deepseek-ai/dsh-tool-call-timeout-policy'
import * as ToolLsp from '@deepseek-ai/dsh-tool-lsp'

/**
 * Focused in-process integration of the model-facing tool, seam, local provider, and timeout policy.
 * The `lsp-definition` ACP snapshot owns the shipped Loader/app entry path.
 */

/* 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let root: string
/** 中文说明：变量 ws 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let ws: string

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'lsp-tool-int-')))
  ws = join(root, 'ws')
  await mkdir(ws)
  await writeFile(join(ws, 'a.ts'), 'const x = 1\n')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/** An inline stdio server that answers initialize + definition; `hang` makes textDocument/* stall. */
/* 中文说明：函数 serverScript 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function serverScript(hang: boolean): string {
  /** 中文说明：变量 definition 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const definition = JSON.stringify({ uri: pathToFileURL(join(ws, 'a.ts')).href, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } } })
  return 'let b=Buffer.alloc(0);'
    + `const DEF=${definition};`
    + 'const fr=(o)=>{const x=Buffer.from(JSON.stringify({jsonrpc:"2.0",...o}));return Buffer.concat([Buffer.from(`Content-Length: ${x.length}\\r\\n\\r\\n`),x]);};'
    + 'process.stdin.on("data",c=>{b=Buffer.concat([b,c]);for(;;){const s=b.indexOf("\\r\\n\\r\\n");if(s<0)break;const len=Number(/(\\d+)/.exec(b.toString("ascii",0,s))[1]);if(b.length<s+4+len)break;const m=JSON.parse(b.toString("utf8",s+4,s+4+len));b=b.subarray(s+4+len);'
    + 'if(m.method==="initialize")process.stdout.write(fr({id:m.id,result:{capabilities:{positionEncoding:"utf-16",textDocumentSync:1,definitionProvider:true}}}));'
    + `else if(m.method==="textDocument/definition"){${hang ? '' : 'process.stdout.write(fr({id:m.id,result:DEF}));'}}`
    + 'else if(m.method==="shutdown")process.stdout.write(fr({id:m.id,result:null}));'
    + 'else if(m.method==="exit")process.exit(0);'
    + '}});'
}

/** 中文说明：函数 mount 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function mount(hang: boolean, timeoutMs?: number): Promise<Context> {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(Lsp)
  await ctx.plugin(LocalFileSystem, { cwd: process.cwd() })
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(LspLocal, {
    servers: {
      inline: {
        command: process.execPath,
        args: ['-e', serverScript(hang)],
        extensionToLanguage: { '.ts': 'typescript' },
        shutdownTimeoutMs: 200,
        killGraceMs: 200,
      },
    },
  })
  await ctx.plugin(TimeoutPolicy)
  await ctx.plugin(ToolLsp, timeoutMs !== undefined ? { timeoutMs } : {})
  return ctx
}

/** 中文说明：变量 seq 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let seq = 0
/** 中文说明：变量 testToolSignal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const testToolSignal = new AbortController().signal
/** 中文说明：函数 call 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function call(ctx: Context, args: unknown) {
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: `int-${++seq}` as never,
    name: 'lsp',
    arguments: args,
    agent: { session: { header: { cwd: ws } } } as never,
  })
}

describe('tool-lsp integration', () => {
  it('round-trips a definition query through the real provider and renders a location', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await mount(false)
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await call(ctx, { operation: 'goToDefinition', file_path: 'a.ts', line: 1, character: 7 })
    expect(result.isError).toBe(false)
    expect(result.content[0]).toEqual({ type: 'text', text: 'a.ts:1:1' })
    await ctx.fiber.dispose()
  }, 30_000)

  it('enforces the TOOL_TIMEOUT budget when the server hangs', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await mount(true, 300)
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await call(ctx, { operation: 'goToDefinition', file_path: 'a.ts', line: 1, character: 7 })
    expect(result.isError).toBe(true)
    expect(result.error?.info?.code).toBe('TOOL_TIMEOUT')
    await ctx.fiber.dispose()
  }, 30_000)
})
