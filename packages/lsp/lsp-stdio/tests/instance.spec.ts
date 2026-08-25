/**
 * 文件职责：验证 LSP 连接、生命周期、协议转换与语言服务器协作行为（instance.spec.ts）。
 * 技术维度：TypeScript、Vitest、JSON-RPC/LSP 协议、Node.js 流与可控进程。
 * 产品维度：保障语言服务器能力能被 Agent 稳定调用。
 * 逻辑维度：准备连接或测试进程，发送协议消息并核对结果与清理。
 * 关键边界：帧长度、进程退出和取消均可能导致异步失败。
 * 新手阅读建议：先读辅助对象，再看连接流程，最后阅读异常场景。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { LspInstance, readHostSource } from '@deepseek-ai/dsh-lsp-stdio'
import { encodeMessage } from '@deepseek-ai/dsh-lsp-stdio'
import type { ConnectionWriter } from '@deepseek-ai/dsh-lsp-stdio/src/connection.ts'
import type { InstanceSpec } from '@deepseek-ai/dsh-lsp-stdio/src/instance.ts'
import type { LspProviderQuery, LspQueryResult } from '@deepseek-ai/dsh-lsp'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import { spawnSubprocess } from '@deepseek-ai/dsh-subprocess-local/src/spawn.ts'

/** 中文说明：变量 fixtureServer 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const fixtureServer = fileURLToPath(new URL('./fixture-server.ts', import.meta.url))

/** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let root: string
/** 中文说明：变量 ws 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let ws: string
/** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let ctx: Context
/** 中文说明：变量 fs 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let fs: LocalFileSystem
/** 中文说明：变量 live 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let live: LspInstance[] = []

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'lsp-inst-')))
  ws = join(root, 'ws')
  await mkdir(ws)
  await writeFile(join(ws, 'a.ts'), 'const x = 1\n')
  ctx = new Context()
  await ctx.plugin(LocalFileSystem, { cwd: root })
  fs = ctx.fs as LocalFileSystem
})

afterEach(async () => {
  /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
  for (const instance of live) await instance.dispose()
  live = []
  await ctx.fiber.dispose()
  await rm(root, { recursive: true, force: true })
})

/** 中文说明：函数 makeInstance 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function makeInstance(
  env: Record<string, string> = {},
  overrides: Partial<InstanceSpec> = {},
  writer?: ConnectionWriter,
): LspInstance {
  /** 中文说明：变量 instance 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const instance = new LspInstance({
    command: process.execPath,
    args: [fixtureServer],
    cwd: ws,
    workspaceUri: pathToFileURL(ws).href,
    env: { ...scrubbedParentEnv(), ...env },
    configuration: { setting: 42 },
    initializationOptions: { init: true },
    maxMessageBytes: 16_000_000,
    maxStderrBytes: 100_000,
    shutdownTimeoutMs: 200,
    killGraceMs: 200,
    ...overrides,
  }, spawnSubprocess, writer)
  live.push(instance)
  return instance
}

/** 中文说明：函数 query 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function query(operation: LspProviderQuery['operation'] = 'goToDefinition'): LspProviderQuery {
  return { operation, filePath: 'a.ts', position: { line: 0, character: 6 }, workspaceRoot: ws, languageId: 'typescript' }
}

/** Run a query against an instance, reading the source first the way the provider does. */
/* 中文说明：函数 run 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function run(instance: LspInstance, operation: LspProviderQuery['operation'] = 'goToDefinition', signal?: AbortSignal): Promise<LspQueryResult> {
  /** 中文说明：变量 workspace 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const workspace = {
    target: await fs.resolve(ws),
    canonicalPath: ws,
    fileUrl: pathToFileURL(ws).href,
  }
  /** 中文说明：变量 source 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const source = await readHostSource(fs, 'a.ts', workspace, 4_000_000)
  return instance.query(query(operation), source, signal)
}

/** Build an instance whose "server" is an inline node script (for teardown-escalation control). */
/* 中文说明：函数 scriptInstance 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function scriptInstance(script: string, overrides: Partial<InstanceSpec> = {}): LspInstance {
  /** 中文说明：变量 instance 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const instance = new LspInstance({
    command: process.execPath,
    args: ['-e', script],
    cwd: ws,
    workspaceUri: pathToFileURL(ws).href,
    env: scrubbedParentEnv(),
    configuration: null,
    initializationOptions: null,
    maxMessageBytes: 16_000_000,
    maxStderrBytes: 100_000,
    shutdownTimeoutMs: 150,
    killGraceMs: 150,
    ...overrides,
  }, spawnSubprocess)
  live.push(instance)
  return instance
}

/** An inline server that answers initialize + definition and echoes a location. */
/* 中文说明：常量 RESPONDING_SERVER 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const RESPONDING_SERVER =
  'let b=Buffer.alloc(0);'
  + 'const fr=(o)=>{const x=Buffer.from(JSON.stringify({jsonrpc:"2.0",...o}));return Buffer.concat([Buffer.from(`Content-Length: ${x.length}\\r\\n\\r\\n`),x]);};'
  + 'process.stdin.on("data",c=>{b=Buffer.concat([b,c]);for(;;){const s=b.indexOf("\\r\\n\\r\\n");if(s<0)break;const len=Number(/(\\d+)/.exec(b.toString("ascii",0,s))[1]);if(b.length<s+4+len)break;const m=JSON.parse(b.toString("utf8",s+4,s+4+len));b=b.subarray(s+4+len);'
  + 'if(m.method==="initialize")process.stdout.write(fr({id:m.id,result:{capabilities:{positionEncoding:"utf-16",textDocumentSync:1,definitionProvider:true}}}));'
  + 'else if(m.method==="textDocument/definition")process.stdout.write(fr({id:m.id,result:null}));'
  + '}});'

/** 中文说明：函数值 locJson 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
const locJson = () => JSON.stringify({ uri: pathToFileURL(join(ws, 'a.ts')).href, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } } })

describe('LspInstance server-request handling', () => {
  it('answers workspace/configuration with the static config per item', async () => {
    /** 中文说明：变量 instance 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const instance = makeInstance({ LSP_FAKE_ON_OPEN: 'configuration', LSP_FAKE_DEF: locJson() })
    // The query drives didOpen, which makes the fake emit workspace/configuration; a healthy answer
    // keeps the query working.
    await expect(run(instance, 'goToDefinition')).resolves.toMatchObject({ kind: 'locations' })
  })

  it('accepts a lifecycle client/registerCapability request', async () => {
    /** 中文说明：变量 instance 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const instance = makeInstance({ LSP_FAKE_ON_OPEN: 'lifecycle', LSP_FAKE_DEF: 'null' })
    await expect(run(instance, 'goToDefinition')).resolves.toEqual({ kind: 'locations', locations: [], resolvedWorkspaceUri: pathToFileURL(ws).href })
  })

  it('rejects a workspace/applyEdit request but keeps serving', async () => {
    /** 中文说明：变量 instance 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const instance = makeInstance({ LSP_FAKE_ON_OPEN: 'applyEdit', LSP_FAKE_DEF: 'null' })
    await expect(run(instance, 'goToDefinition')).resolves.toEqual({ kind: 'locations', locations: [], resolvedWorkspaceUri: pathToFileURL(ws).href })
  })

  it('rejects an unknown server request but keeps serving', async () => {
    /** 中文说明：变量 instance 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const instance = makeInstance({ LSP_FAKE_ON_OPEN: 'unknown', LSP_FAKE_DEF: 'null' })
    await expect(run(instance, 'goToDefinition')).resolves.toEqual({ kind: 'locations', locations: [], resolvedWorkspaceUri: pathToFileURL(ws).href })
  })
})

describe('LspInstance query and abort', () => {
  it('sends includeDeclaration for references', async () => {
    /** 中文说明：变量 instance 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const instance = makeInstance({ LSP_FAKE_REFS: JSON.stringify([JSON.parse(locJson())]) })
    await expect(run(instance, 'findReferences')).resolves.toMatchObject({ kind: 'locations' })
  })

  it('rejects a query aborted before it starts', async () => {
    /** 中文说明：变量 instance 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const instance = makeInstance({ LSP_FAKE_DEF: 'null' })
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    controller.abort(new Error('pre-abort'))
    await expect(run(instance, 'goToDefinition', controller.signal)).rejects.toThrow(/pre-abort/)
  })

  it('cancels an in-flight request on abort and rejects', async () => {
    /** 中文说明：变量 instance 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const instance = makeInstance({ LSP_FAKE_HANG: '1' })
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    // Warm the instance first so the abort lands during the hanging request, not during startup.
    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = run(instance, 'goToDefinition', controller.signal)
    await new Promise<void>(resolve => setTimeout(resolve, 300))
    controller.abort(new Error('mid-flight'))
    await expect(pending).rejects.toThrow(/mid-flight/)
  })

  it('terminates the instance when the server ignores $/cancelRequest past the grace', async () => {
    // The hang server never honors cancellation, so after the bounded grace the instance must be torn
    // down (its process closed) rather than left with an active request.
    /** 中文说明：变量 instance 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const instance = makeInstance({ LSP_FAKE_HANG: '1' }, { killGraceMs: 100 })
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = run(instance, 'goToDefinition', controller.signal)
    await new Promise<void>(resolve => setTimeout(resolve, 300))
    controller.abort(new Error('mid-flight'))
    await expect(pending).rejects.toThrow(/mid-flight/)
    expect(instance.dead).toBe(true)
  })

  it('resolves the cancel grace when the server honors $/cancelRequest', async () => {
    // A server that answers $/cancelRequest by settling the pending request lets the grace race
    // resolve via the request rather than the timeout, so the instance is NOT force-terminated.
    /** 中文说明：变量 script 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const script = 'let b=Buffer.alloc(0),reqId=null;'
      + 'const fr=(o)=>{const x=Buffer.from(JSON.stringify({jsonrpc:"2.0",...o}));return Buffer.concat([Buffer.from(`Content-Length: ${x.length}\\r\\n\\r\\n`),x]);};'
      + 'process.stdin.on("data",c=>{b=Buffer.concat([b,c]);for(;;){const s=b.indexOf("\\r\\n\\r\\n");if(s<0)break;const len=Number(/(\\d+)/.exec(b.toString("ascii",0,s))[1]);if(b.length<s+4+len)break;const m=JSON.parse(b.toString("utf8",s+4,s+4+len));b=b.subarray(s+4+len);'
      + 'if(m.method==="initialize")process.stdout.write(fr({id:m.id,result:{capabilities:{positionEncoding:"utf-16",textDocumentSync:1,definitionProvider:true}}}));'
      + 'else if(m.method==="textDocument/definition")reqId=m.id;'
      + 'else if(m.method==="$/cancelRequest"&&reqId!==null)process.stdout.write(fr({id:reqId,error:{code:-32800,message:"request cancelled"}}));'
      + 'else if(m.method==="shutdown")process.stdout.write(fr({id:m.id,result:null}));'
      + 'else if(m.method==="exit")process.exit(0);'
      + '}});'
    /** 中文说明：变量 instance 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const instance = scriptInstance(script, { killGraceMs: 2_000 })
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = run(instance, 'goToDefinition', controller.signal)
    await new Promise<void>(resolve => setTimeout(resolve, 300))
    controller.abort(new Error('mid-flight'))
    await expect(pending).rejects.toThrow(/mid-flight/)
    // The server acknowledged cancellation within grace, so the instance was not force-killed.
    expect(instance.dead).toBe(false)
    await instance.dispose()
  })

  it('observes abort while awaiting a slow initialize handshake', async () => {
    // A server that answers nothing (not even initialize) leaves `ready` pending; an abort must be
    // observed during that wait instead of hanging the tool-timeout signal.
    /** 中文说明：函数值 instance 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const instance = scriptInstance('setInterval(()=>{},1000)', { killGraceMs: 100 })
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = run(instance, 'goToDefinition', controller.signal)
    await new Promise<void>(resolve => setTimeout(resolve, 150))
    controller.abort(new Error('handshake-abort'))
    await expect(pending).rejects.toThrow(/handshake-abort/)
    await instance.dispose()
  })

  it('terminates when abort interrupts a backpressured didOpen write', async () => {
    // The fixture consumes initialized, then stops reading. A document larger than the stdio pipe
    // keeps didOpen's write callback pending until cancellation forces bounded process teardown.
    await writeFile(join(ws, 'a.ts'), 'x'.repeat(2_000_000))
    /** 中文说明：变量 marker 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const marker = join(root, 'initialized.log')
    /** 中文说明：变量 instance 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const instance = makeInstance({
      LSP_FAKE_INITIALIZED_MARKER: marker,
      LSP_FAKE_PAUSE_STDIN_AFTER_INITIALIZED: '1',
    }, {
      shutdownTimeoutMs: 100,
      killGraceMs: 100,
    })
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = run(instance, 'goToDefinition', controller.signal)
    await waitForFile(marker)
    // Let the client enter the large didOpen write after the fixture has paused stdin.
    await new Promise<void>(resolve => setTimeout(resolve, 100))
    controller.abort(new Error('didOpen-abort'))
    await expect(pending).rejects.toThrow(/didOpen-abort/)
    expect(instance.dead).toBe(true)
  })

  it('terminates when stdin fails during the didOpen write', async () => {
    /** 中文说明：变量 instance 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const instance = makeInstance({}, {
      shutdownTimeoutMs: 100,
      killGraceMs: 100,
    }, failingWriter('textDocument/didOpen'))
    await expect(run(instance, 'goToDefinition')).rejects.toThrow()
    expect(instance.dead).toBe(true)
  })

  it('awaits process exit before rejecting a request write failure', async () => {
    /** 中文说明：变量 instance 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const instance = makeInstance({}, {
      shutdownTimeoutMs: 100,
      killGraceMs: 100,
    }, failingWriter('textDocument/definition'))
    // The pid is observed only to prove the owned subprocess reached quiescence before rejection.
    /** 中文说明：变量 pid 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pid = (instance as unknown as { connection: { pid: number } }).connection.pid
    await expect(run(instance, 'goToDefinition')).rejects.toThrow(/fixture textDocument\/definition failure/)
    expect(processAlive(pid)).toBe(false)
  })

  it('rejects when the server lacks the operation capability', async () => {
    /** 中文说明：变量 instance 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const instance = makeInstance({ LSP_FAKE_CAPS: JSON.stringify({ definitionProvider: false }), LSP_FAKE_DEF: 'null' })
    await expect(run(instance, 'goToDefinition')).rejects.toThrow(/does not support goToDefinition/)
  })

  it('propagates a server error response even when a signal is supplied (not an abort)', async () => {
    // A live signal is passed, but the request fails for a server reason; the catch must rethrow
    // without treating it as an abort.
    /** 中文说明：变量 instance 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const instance = makeInstance({ LSP_FAKE_ERROR: '1' })
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    await expect(run(instance, 'goToDefinition', controller.signal)).rejects.toThrow(/server refused/)
  })

  it('keeps a settled result but awaits teardown when didClose cannot be written', async () => {
    /** 中文说明：变量 instance 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const instance = makeInstance({
      LSP_FAKE_DEF: 'null',
    }, { shutdownTimeoutMs: 100, killGraceMs: 100 }, failingWriter('textDocument/didClose'))
    await expect(run(instance, 'goToDefinition')).resolves.toEqual({
      kind: 'locations',
      locations: [],
      resolvedWorkspaceUri: pathToFileURL(ws).href,
    })
    expect(instance.dead).toBe(true)
  })
})

describe('LspInstance disposal', () => {
  it('lets a server finish protocol exit before signal escalation', async () => {
    /** 中文说明：变量 marker 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const marker = join(root, 'graceful-exit.log')
    /** 中文说明：变量 instance 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const instance = makeInstance({
      LSP_FAKE_DEF: 'null',
      LSP_FAKE_EXIT_DELAY_MS: '75',
      LSP_FAKE_EXIT_MARKER: marker,
    }, { shutdownTimeoutMs: 500 })
    await run(instance, 'goToDefinition')
    await instance.dispose()
    expect(await readFile(marker, 'utf8')).toBe('EXIT\nCLEAN\n')
  })

  it('is idempotent — a second dispose awaits close without error', async () => {
    /** 中文说明：变量 instance 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const instance = makeInstance({ LSP_FAKE_DEF: 'null' })
    await run(instance, 'goToDefinition')
    await instance.dispose()
    await expect(instance.dispose()).resolves.toBeUndefined()
  })

  it('rejects a query after disposal', async () => {
    /** 中文说明：变量 instance 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const instance = makeInstance({ LSP_FAKE_DEF: 'null' })
    await run(instance, 'goToDefinition')
    await instance.dispose()
    await expect(run(instance, 'goToDefinition')).rejects.toThrow(expect.objectContaining({ code: 'LSP_DISPOSED' }))
  })

  it('reports dead after the process closes', async () => {
    /** 中文说明：变量 instance 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const instance = makeInstance({ LSP_FAKE_DEF: 'null' })
    await run(instance, 'goToDefinition')
    await instance.dispose()
    expect(instance.dead).toBe(true)
  })

  it('escalates to SIGKILL when the server ignores shutdown and SIGTERM', async () => {
    // Server answers initialize, ignores shutdown, and traps SIGTERM so only SIGKILL stops it.
    /** 中文说明：函数值 script 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const script = RESPONDING_SERVER + 'process.on("SIGTERM",()=>{});'
    /** 中文说明：变量 instance 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const instance = scriptInstance(script, { shutdownTimeoutMs: 100, killGraceMs: 100 })
    await run(instance, 'goToDefinition')
    await expect(instance.dispose()).resolves.toBeUndefined()
  })

  it('awaits a surviving process-tree helper on every concurrent dispose', async () => {
    /** 中文说明：变量 marker 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const marker = join(root, 'helper.pid')
    /** 中文说明：函数值 helper 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const helper = 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000);'
    /** 中文说明：变量 script 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const script = 'const{spawn}=require("node:child_process");const{writeFileSync}=require("node:fs");'
      + `const helper=spawn(process.execPath,["-e",${JSON.stringify(helper)}],{stdio:"ignore"});`
      + `writeFileSync(${JSON.stringify(marker)},String(helper.pid));`
      + RESPONDING_SERVER
    /** 中文说明：变量 instance 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const instance = scriptInstance(script, { shutdownTimeoutMs: 100, killGraceMs: 100 })
    await run(instance, 'goToDefinition')
    /** 中文说明：变量 helperPid 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const helperPid = Number(await readFile(marker, 'utf8'))
    try {
      /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const first = instance.dispose()
      await instance.dispose()
      expect(processAlive(helperPid)).toBe(false)
      await first
    } finally {
      if (processAlive(helperPid)) process.kill(helperPid, 'SIGKILL')
      await waitForProcessExit(helperPid)
    }
  })

  it('carries a non-Error abort reason as a generic aborted error', async () => {
    /** 中文说明：变量 instance 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const instance = makeInstance({ LSP_FAKE_HANG: '1' })
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = run(instance, 'goToDefinition', controller.signal)
    await new Promise<void>(resolve => setTimeout(resolve, 200))
    controller.abort('a string reason, not an Error')
    await expect(pending).rejects.toThrow(/aborted/)
  })
})

/** Probe a pid without changing its state. */
/* 中文说明：函数 processAlive 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
    throw error
  }
  if (process.platform !== 'linux') return true
  try {
    /** 中文说明：变量 stat 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    /** 中文说明：变量 state 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const state = stat.slice(stat.lastIndexOf(')') + 2).split(/\s+/, 1)[0]
    return !/^[ZXx]$/.test(state ?? '')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/** Wait until a process can no longer execute so temporary-workspace cleanup cannot race handle release. */
/* 中文说明：函数 waitForProcessExit 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function waitForProcessExit(pid: number, timeoutMs = 3_000): Promise<void> {
  /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const started = Date.now()
  while (processAlive(pid)) {
    if (Date.now() - started > timeoutMs) throw new Error(`process ${pid} did not exit`)
    await new Promise<void>(resolve => setTimeout(resolve, 10))
  }
}

/** Write normally except for one method whose callback receives a deterministic transport error. */
/* 中文说明：函数 failingWriter 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function failingWriter(method: string): ConnectionWriter {
  return (stdin, message, done) => {
    if ((message as { method?: unknown }).method === method) {
      queueMicrotask(() => { done(new Error(`fixture ${method} failure`)) })
      return
    }
    stdin.write(encodeMessage(message), done)
  }
}

/** Wait until a fixture marker exists, bounded so a broken handshake cannot hang the test. */
/* 中文说明：函数 waitForFile 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function waitForFile(path: string, timeoutMs = 3000): Promise<void> {
  /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const started = Date.now()
  /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
  for (;;) {
    try {
      await readFile(path)
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (Date.now() - started > timeoutMs) throw new Error('waitForFile timed out')
    await new Promise<void>(resolve => setTimeout(resolve, 10))
  }
}
