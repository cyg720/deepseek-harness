/**
 * 文件职责：验证ACP 示例的 load-path.e2e.ts 行为与边界。
 * 技术维度：TypeScript、Cordis、异步资源生命周期、远程文件/进程接口和 Vitest。
 * 产品维度：保证ACP 示例在真实组装、失败和清理场景中可靠。
 * 逻辑维度：构造服务或远程替身，驱动操作并断言结果。
 * 关键边界：凭据不得泄漏；远程句柄、终端和后台进程必须在取消或卸载时释放。
 * 新手阅读建议：先读接口和夹具，再按创建、操作、错误和清理流程阅读。
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  /** 中文说明：类型或类 Agent 约束远程资源或测试数据职责。 */
  type Agent as AcpAgent,
  /** 中文说明：类型或类 Client 约束远程资源或测试数据职责。 */
  type Client,
  /** 中文说明：类型或类 RequestPermissionRequest 约束远程资源或测试数据职责。 */
  type RequestPermissionRequest,
  /** 中文说明：类型或类 RequestPermissionResponse 约束远程资源或测试数据职责。 */
  type RequestPermissionResponse,
  /** 中文说明：类型或类 SessionNotification 约束远程资源或测试数据职责。 */
  type SessionNotification,
} from '@agentclientprotocol/sdk'

/**
 * Source-path Loader smoke through the package's own bin, covering the
 * automation server's initialize and fresh-session path across the
 * `unwrapExports` shape implicated by postmortem 0001. Session creation reaches
 * the factory but not the model, so a dummy key is sufficient.
 */

/* 中文说明：测试局部值 binScript，由紧邻初始化决定。 */
const binScript = fileURLToPath(new URL('../src/bin.ts', import.meta.url))
/** 中文说明：测试局部值 tsxLoader，由紧邻初始化决定。 */
const tsxLoader = fileURLToPath(import.meta.resolve('tsx'))
// Repo root is four levels up from packages/examples/acp-demo/tests.
/** 中文说明：测试局部值 repoTsconfig，由紧邻初始化决定。 */
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

// A minimal opt-in leaf that loads this app + the two backends and the optional
// session-query consumer/policies, inlined so the package test owns its fixture.
/** 中文说明：测试局部值 CORDIS_YML，由紧邻初始化决定。 */
const CORDIS_YML = `
- id: llm-deepseek
  name: '@deepseek-ai/dsh-llm-deepseek'
- id: subprocess
  name: '@deepseek-ai/dsh-subprocess-local'
- id: bash
  name: '@deepseek-ai/dsh-bash-local'
- id: acp-agent
  name: '@deepseek-ai/dsh-acp-demo'
  config:
    provider: deepseek-official
    model: deepseek-v4-flash
    persona: 'You are a test agent.'
    workspaceContext: false
- id: tool-session-query
  name: '@deepseek-ai/dsh-tool-session-query'
- id: timeout-policy
  name: '@deepseek-ai/dsh-tool-call-timeout-policy'
- id: spill-local
  name: '@deepseek-ai/dsh-spill-local'
- id: spill-policy
  name: '@deepseek-ai/dsh-spill-policy'
  config:
    maxInlineBytes: 50000
`

/** 中文说明：类型或类 Spawned 约束远程资源或测试数据职责。 */
interface Spawned {
  child: ChildProcessWithoutNullStreams
  client: ClientSideConnection
  stderr: string[]
}

/** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
let spawned: Spawned | undefined
/** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
let workdir: string | undefined

afterEach(async () => {
  if (spawned !== undefined) {
    spawned.child.kill('SIGKILL')
    spawned = undefined
  }
  if (workdir !== undefined) await rm(workdir, { recursive: true, force: true })
  workdir = undefined
})

/** 中文说明：函数 boot 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function boot(): Promise<Spawned & { cwd: string }> {
  workdir = await mkdtemp(join(tmpdir(), 'acp-agent-pkg-'))
  /** 中文说明：测试局部值 cwd，由紧邻初始化决定。 */
  const cwd = workdir
  /** 中文说明：测试局部值 configPath，由紧邻初始化决定。 */
  const configPath = join(cwd, 'cordis.yml')
  await writeFile(configPath, CORDIS_YML)
  /** 中文说明：测试局部值 child，由紧邻初始化决定。 */
  const child = spawn(
    process.execPath,
    ['--import', tsxLoader, binScript, '--config', configPath],
    {
      cwd,
      env: {
        ...process.env,
        TSX_TSCONFIG_PATH: repoTsconfig,
        // Key-present check only; no prompt is sent, so the model is never called.
        DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY ?? 'keyless-acp-agent-smoke',
        DSH_HOME: join(cwd, '.dsh'),
        DSH_AGENTS_HOME: join(cwd, '.agents'),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  )
  /** 中文说明：测试局部值 stderr，由紧邻初始化决定。 */
  const stderr: string[] = []
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => stderr.push(chunk))
  /** 中文说明：测试局部值 stream，由紧邻初始化决定。 */
  const stream = ndJsonStream(
    Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
    Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
  )
  /** 中文说明：测试局部值 makeClient，由紧邻初始化决定。 */
  const makeClient = (_agent: AcpAgent): Client => ({
    sessionUpdate(_params: SessionNotification): Promise<void> {
      return Promise.resolve()
    },
    requestPermission(_params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
      return Promise.resolve({ outcome: { outcome: 'cancelled' } })
    },
  })
  /** 中文说明：测试局部值 client，由紧邻初始化决定。 */
  const client = new ClientSideConnection(makeClient, stream)
  spawned = { child, client, stderr }
  return { ...spawned, cwd }
}

describe('dsh-acp-demo real-load-path smoke (bin + Loader, keyless)', () => {
  it('boots via its bin and exposes only fresh text sessions', async () => {
    /** 中文说明：测试局部值 { client, cwd, stderr }，由紧邻初始化决定。 */
    const { client, cwd, stderr } = await boot()
    // initialize: a broken export shape (collapsed bridge plugin, dropped inject)
    // crashes the tree on the first service read here — see postmortem 0001.
    /** 中文说明：测试局部值 init，由紧邻初始化决定。 */
    const init = await client.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
    })
    expect(init.agentCapabilities).toEqual({
      promptCapabilities: { image: false, audio: false, embeddedContext: false },
    })

    // session/new reaches the agent FACTORY (create) without the model.
    /** 中文说明：测试局部值 { sessionId }，由紧邻初始化决定。 */
    const { sessionId } = await client.newSession({ cwd, mcpServers: [] })
    expect(sessionId).toBeTruthy()

    expect(stderr.join('')).not.toContain('without inject')
  }, 30_000)
})
