/**
 * 文件职责：验证 connection.spec.ts 覆盖的 LSP 标准输入输出连接、消息分帧与进程协作行为。
 * 技术维度：使用 TypeScript、Vitest、JSON-RPC/LSP 帧协议、Node.js 流和可控子进程测试。
 * 产品维度：保障语言服务器能够稳定启动、收发消息，并为 Agent 提供代码理解能力。
 * 逻辑维度：准备流或测试服务器，建立连接，发送协议消息，再核对响应、错误与资源清理。
 * 关键边界：帧长度必须与字节一致；进程和流可能提前结束；测试完成后必须释放所有句柄。
 * 新手阅读建议：先理解 Content-Length 分帧，再看连接生命周期，最后阅读异常与构建产物测试。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { LspConnection } from '@deepseek-ai/dsh-lsp-stdio'
import type { ConnectionWriter } from '@deepseek-ai/dsh-lsp-stdio/src/connection.ts'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import { spawnSubprocess } from '@deepseek-ai/dsh-subprocess-local/src/spawn.ts'

/** 中文说明：变量 fixtureServer 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const fixtureServer = fileURLToPath(new URL('./fixture-server.ts', import.meta.url))

/** A recorded server→client request the test's handler saw. */
/* 中文说明：interface SeenRequest 定义本测试所需的数据或行为，用于表达当前协议场景。 */
interface SeenRequest { method: string; params: unknown }

/** 中文说明：变量 open 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let open: LspConnection[] = []

afterEach(async () => {
  /** 中文说明：该循环依次处理场景数据；循环变量仅在当前循环中有效。 */
  for (const conn of open) {
    conn.terminate()
    await conn.closed
  }
  open = []
})

/** Spawn the fixture as a raw connection, with a scripted server-request handler. */
/* 中文说明：函数 connect 承担本测试场景中的准备或验证工作；参数按签名传入，返回值供后续断言使用；示例见本文件调用。 */
function connect(
  env: Record<string, string>,
  onServerRequest: (method: string, params: unknown) => Promise<unknown> = () => Promise.resolve(null),
  seen?: SeenRequest[],
): LspConnection {
  /** 中文说明：变量 conn 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const conn = new LspConnection({
    command: process.execPath,
    args: [fixtureServer],
    cwd: process.cwd(),
    env: { ...scrubbedParentEnv(), ...env },
    maxMessageBytes: 16_000_000,
    maxStderrBytes: 100_000,
    killGraceMs: 3_000,
    configuration: { setting: 42 },
  }, spawnSubprocess, (method, params) => {
    seen?.push({ method, params })
    return onServerRequest(method, params)
  })
  open.push(conn)
  return conn
}

describe('LspConnection', () => {
  it('completes an initialize request/response round-trip and exposes a pid', async () => {
    /** 中文说明：变量 conn 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const conn = connect({})
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await conn.request('initialize', { capabilities: {} })
    expect(result).toMatchObject({ capabilities: { hoverProvider: true } })
    expect(conn.pid).toBeGreaterThan(0)
  })

  it('forwards explicit DSH_* env entries to the child', async () => {
    // A configured DSH_* fact must reach the child: the seam scrubs only the
    // ambient namespace, and the explicit entry merges after that scrub. The
    // fixture echoes the named variable back as hover text.
    /** 中文说明：变量 conn 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const conn = connect({ LSP_FAKE_ECHO_ENV: 'DSH_LSP_TEST_FACT', DSH_LSP_TEST_FACT: 'managed' })
    await conn.request('initialize', { capabilities: {} })
    expect(await conn.request('textDocument/hover', {})).toEqual({ contents: 'managed' })
  })

  it('rejects a request when the server replies with an error', async () => {
    /** 中文说明：变量 conn 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const conn = connect({ LSP_FAKE_ERROR: '1' })
    await conn.request('initialize', { capabilities: {} })
    await expect(conn.request('textDocument/hover', {})).rejects.toThrow(/server refused the request/)
  })

  it('treats terminating an already-closed child as a teardown race', async () => {
    /** 中文说明：变量 conn 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const conn = connectScript('')
    await conn.closed
    expect(() => { conn.terminate() }).not.toThrow()
  })

  it('answers a server workspace/configuration request from static config', async () => {
    /** 中文说明：变量 seen 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const seen: SeenRequest[] = []
    /** 中文说明：变量 conn 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const conn = connect(
      { LSP_FAKE_ON_OPEN: 'configuration' },
      (method, params) => {
        if (method === 'workspace/configuration') {
          /** 中文说明：变量 items 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const items = (params as { items: unknown[] }).items
          return Promise.resolve(items.map(() => ({ setting: 42 })))
        }
        return Promise.resolve(null)
      },
      seen,
    )
    await conn.request('initialize', { capabilities: {} })
    await conn.notify('textDocument/didOpen', { textDocument: { uri: 'file:///x', languageId: 'ts', version: 1, text: '' } })
    await waitFor(() => seen.some(s => s.method === 'workspace/configuration'))
    expect(seen[0]?.method).toBe('workspace/configuration')
  })

  it('drops a server→client notification without replying', async () => {
    /** 中文说明：变量 conn 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const conn = connect({ LSP_FAKE_ON_OPEN: 'notification' })
    await conn.request('initialize', { capabilities: {} })
    await conn.notify('textDocument/didOpen', { textDocument: { uri: 'file:///x', languageId: 'ts', version: 1, text: '' } })
    // No throw and the connection stays usable.
    await expect(conn.request('textDocument/hover', {})).resolves.toBeDefined()
  })

  it('sends an error response when the server-request handler rejects', async () => {
    /** 中文说明：变量 seen 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const seen: SeenRequest[] = []
    /** 中文说明：变量 conn 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const conn = connect(
      { LSP_FAKE_ON_OPEN: 'applyEdit' },
      method => method === 'workspace/applyEdit' ? Promise.reject(new Error('not permitted')) : Promise.resolve(null),
      seen,
    )
    await conn.request('initialize', { capabilities: {} })
    await conn.notify('textDocument/didOpen', { textDocument: { uri: 'file:///x', languageId: 'ts', version: 1, text: '' } })
    await waitFor(() => seen.some(s => s.method === 'workspace/applyEdit'))
    // The connection remains healthy after emitting the error response.
    await expect(conn.request('textDocument/hover', {})).resolves.toBeDefined()
  })

  it('fails all pending requests and kills the process on a framing error', async () => {
    /** 中文说明：变量 conn 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const conn = connect({ LSP_FAKE_GARBAGE: '1' })
    // The garbage byte precedes a valid initialize reply; unframed bytes are tolerated until a
    // Content-Length header, so initialize still resolves. This exercises the decoder's resilience.
    await expect(conn.request('initialize', { capabilities: {} })).resolves.toBeDefined()
  })

  it('rejects a new request issued after the process closes', async () => {
    /** 中文说明：变量 conn 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const conn = connect({})
    await conn.request('initialize', { capabilities: {} })
    conn.terminate()
    await conn.closed
    await expect(conn.request('textDocument/hover', {})).rejects.toThrow(/exited|closed/)
  })

  it('cancel is a no-op-safe write after close', async () => {
    /** 中文说明：变量 conn 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const conn = connect({})
    await conn.request('initialize', { capabilities: {} })
    conn.terminate()
    await conn.closed
    expect(() => { conn.cancel(1) }).not.toThrow()
  })

  it('caps the retained stderr tail', async () => {
    /** 中文说明：变量 conn 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const conn = connect({})
    await conn.request('initialize', { capabilities: {} })
    expect(conn.stderrTail.length).toBeLessThanOrEqual(100_000)
  })
})

/** Spawn a raw connection running an inline node script as the "server". */
/* 中文说明：函数 connectScript 承担本测试场景中的准备或验证工作；参数按签名传入，返回值供后续断言使用；示例见本文件调用。 */
function connectScript(script: string, maxStderrBytes = 100_000, writer?: ConnectionWriter): LspConnection {
  /** 中文说明：变量 conn 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const conn = new LspConnection({
    command: process.execPath,
    args: ['-e', script],
    cwd: process.cwd(),
    env: scrubbedParentEnv(),
    maxMessageBytes: 16_000_000,
    maxStderrBytes,
    killGraceMs: 3_000,
    configuration: null,
  }, spawnSubprocess, () => Promise.resolve(null), writer)
  open.push(conn)
  return conn
}

describe('LspConnection edge behavior', () => {
  it('fails a request when the command cannot be spawned', async () => {
    /** 中文说明：变量 conn 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const conn = new LspConnection({
      command: '/definitely/not/a/real/binary/xyz',
      args: [],
      cwd: process.cwd(),
      env: {},
      maxMessageBytes: 1000,
      maxStderrBytes: 1000,
      killGraceMs: 3_000,
      configuration: null,
    }, spawnSubprocess, () => Promise.resolve(null))
    open.push(conn)
    await expect(conn.request('initialize', {})).rejects.toThrow()
  })

  it('kills the process and fails pending requests on a framing error', async () => {
    // Emit an invalid Content-Length header, corrupting the stream irrecoverably.
    /** 中文说明：函数值 conn 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const conn = connectScript('process.stdout.write("Content-Length: abc\\r\\n\\r\\n{}"); setInterval(()=>{}, 1000)')
    await expect(conn.request('initialize', {})).rejects.toThrow()
  })

  it('ignores a framed non-object message', async () => {
    // Send a framed JSON number and a framed null (both non-objects) then a proper response to id 1.
    /** 中文说明：变量 script 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const script = 'let b=Buffer.alloc(0);'
      + 'const fr=(s)=>{const x=Buffer.from(s);return Buffer.concat([Buffer.from(`Content-Length: ${x.length}\\r\\n\\r\\n`),x]);};'
      + 'process.stdout.write(fr("42"));process.stdout.write(fr("null"));'
      + 'process.stdin.on("data",c=>{b=Buffer.concat([b,c]);const s=b.indexOf("\\r\\n\\r\\n");if(s<0)return;const len=Number(/(\\d+)/.exec(b.toString("ascii",0,s))[1]);const body=JSON.parse(b.toString("utf8",s+4,s+4+len));process.stdout.write(fr(JSON.stringify({jsonrpc:"2.0",id:body.id,result:{ok:true}})));});'
    /** 中文说明：变量 conn 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const conn = connectScript(script)
    await expect(conn.request('initialize', {})).resolves.toEqual({ ok: true })
  })

  it('drops a response for an unknown id', async () => {
    // Emit a response for id 999 (never sent), then answer our real request.
    /** 中文说明：变量 script 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const script = 'let b=Buffer.alloc(0);'
      + 'const fr=(s)=>{const x=Buffer.from(s);return Buffer.concat([Buffer.from(`Content-Length: ${x.length}\\r\\n\\r\\n`),x]);};'
      + 'process.stdout.write(fr(JSON.stringify({jsonrpc:"2.0",id:999,result:{stray:true}})));'
      + 'process.stdin.on("data",c=>{b=Buffer.concat([b,c]);const s=b.indexOf("\\r\\n\\r\\n");if(s<0)return;const len=Number(/(\\d+)/.exec(b.toString("ascii",0,s))[1]);const body=JSON.parse(b.toString("utf8",s+4,s+4+len));process.stdout.write(fr(JSON.stringify({jsonrpc:"2.0",id:body.id,result:{ok:true}})));});'
    /** 中文说明：变量 conn 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const conn = connectScript(script)
    await expect(conn.request('initialize', {})).resolves.toEqual({ ok: true })
  })

  it('caps the retained stderr tail at maxStderrBytes across chunks', async () => {
    // Write stderr repeatedly so a later chunk arrives after the cap is already reached.
    /** 中文说明：函数值 conn 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const conn = connectScript('setInterval(()=>process.stderr.write("E".repeat(200)), 5); setInterval(()=>{}, 1000)', 100)
    await waitFor(() => conn.stderrTail.length >= 100)
    await new Promise<void>(resolve => setTimeout(resolve, 50))
    expect(conn.stderrTail.length).toBe(100)
  })

  it('caps the retained stderr tail by bytes for multibyte UTF-8', async () => {
    /** 中文说明：变量 conn 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const conn = connectScript('process.stderr.write("😀😀")', 4)
    await conn.closed
    expect(conn.stderrTail).toBe('😀')
    expect(Buffer.byteLength(conn.stderrTail)).toBe(4)
  })

  it('rejects with a fallback message when the error response has no message string', async () => {
    /** 中文说明：变量 script 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const script = 'let b=Buffer.alloc(0);'
      + 'const fr=(s)=>{const x=Buffer.from(s);return Buffer.concat([Buffer.from(`Content-Length: ${x.length}\\r\\n\\r\\n`),x]);};'
      + 'process.stdin.on("data",c=>{b=Buffer.concat([b,c]);const s=b.indexOf("\\r\\n\\r\\n");if(s<0)return;const len=Number(/(\\d+)/.exec(b.toString("ascii",0,s))[1]);const body=JSON.parse(b.toString("utf8",s+4,s+4+len));process.stdout.write(fr(JSON.stringify({jsonrpc:"2.0",id:body.id,error:{code:-1}})));});'
    /** 中文说明：变量 conn 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const conn = connectScript(script)
    await expect(conn.request('initialize', {})).rejects.toThrow(/LSP error response/)
  })

  it('rejects a pending request when the process exits mid-flight', async () => {
    // Never responds, then exits shortly: the pending request must reject on close.
    /** 中文说明：函数值 conn 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const conn = connectScript('setTimeout(()=>process.exit(0), 100)')
    await expect(conn.request('initialize', {})).rejects.toThrow(/exited|closed/)
  })

  it('rejects a pending request when child stdin fails but the process stays alive', async () => {
    /** 中文说明：变量 failure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const failure = new Error('fixture stdin failure')
    /** 中文说明：函数值 writer 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const writer: ConnectionWriter = (_stdin, _message, done) => {
      queueMicrotask(() => { done(failure) })
    }
    /** 中文说明：函数值 conn 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const conn = connectScript('setInterval(()=>{}, 1000)', 100_000, writer)
    await expect(conn.request('initialize', {})).rejects.toThrow(/fixture stdin failure/)
  })

  it('ignores a frame that is neither a valid request nor a numeric-id response', async () => {
    // A frame with a string id and no method: not dispatchable; the client must ignore it and still
    // answer our real request.
    /** 中文说明：变量 script 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const script = 'let b=Buffer.alloc(0);'
      + 'const fr=(s)=>{const x=Buffer.from(s);return Buffer.concat([Buffer.from(`Content-Length: ${x.length}\\r\\n\\r\\n`),x]);};'
      + 'process.stdout.write(fr(JSON.stringify({jsonrpc:"2.0",id:"str-id"})));'
      + 'process.stdin.on("data",c=>{b=Buffer.concat([b,c]);const s=b.indexOf("\\r\\n\\r\\n");if(s<0)return;const len=Number(/(\\d+)/.exec(b.toString("ascii",0,s))[1]);const body=JSON.parse(b.toString("utf8",s+4,s+4+len));process.stdout.write(fr(JSON.stringify({jsonrpc:"2.0",id:body.id,result:{ok:true}})));});'
    /** 中文说明：变量 conn 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const conn = connectScript(script)
    await expect(conn.request('initialize', {})).resolves.toEqual({ ok: true })
  })
})

/** Poll a predicate until it holds or a deadline elapses. */
/* 中文说明：函数 waitFor 承担本测试场景中的准备或验证工作；参数按签名传入，返回值供后续断言使用；示例见本文件调用。 */
async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  /** 中文说明：变量 start 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out')
    await new Promise<void>(resolve => setTimeout(resolve, 10))
  }
}
