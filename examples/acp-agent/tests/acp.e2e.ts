/**
 * 文件职责：通过真实标准输入输出 ACP 子进程验证示例智能体的协议纯净度和有密钥任务执行。
 * 技术维度：使用 Vitest、ACP SDK ClientSideConnection、真实子进程、临时工作目录和世界状态断言。
 * 产品维度：确保 ACP 客户端能稳定启动示例、发送任务，并以实际文件结果而非智能体自述判断成功。
 * 逻辑维度：无密钥场景初始化并检查 stdout 全为 JSON-RPC；有密钥场景发送提示并验证落盘文件。
 * 关键边界：协议通道不得混入日志；真实任务无密钥时自跳过；每个场景后必须清理子进程和目录。
 * 新手阅读建议：先读 AGENT 启动描述，再看无密钥 stdout 检查，最后阅读真实提示与文件验证场景。
 */
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import {
  launchAcpTestAgent,
  type AgentUnderTest,
  type LaunchedAcpTestAgent,
} from '@deepseek-ai/dsh-acp-snapshot'
import { cleanupAcpExampleTest } from './cleanup.ts'

/**
 * End-to-end: boot examples/acp-agent as a real subprocess speaking ACP over
 * its stdio, drive it with a real ClientSideConnection, send a real prompt, and
 * verify the WORLD (a file the agent wrote), not the agent's self-report. Owns
 * and disposes the subprocess in afterEach. Key-gated.
 *
 * Also asserts stdout purity (only framed JSON-RPC on stdout) — that one runs
 * WITHOUT a key, since it only needs the server to boot and answer initialize.
 */
/** 中文说明：真实子进程通过 ACP stdio 交互，结果以写入文件验证；协议纯净度检查无需真实密钥。 */

/** ACP 示例的入口脚本、组合配置和 TypeScript 路径。 */
const AGENT: AgentUnderTest = {
  binScript: fileURLToPath(new URL('../../../packages/examples/acp-demo/src/bin.ts', import.meta.url)),
  configPath: fileURLToPath(new URL('../cordis.yml', import.meta.url)),
  tsconfigPath: fileURLToPath(new URL('../../../tsconfig.json', import.meta.url)),
}
/** 真实写文件任务使用的显式完全访问权限环境。 */
const DANGER_FULL_ACCESS_ENV = { DSH_PERMISSION_MODE: 'danger-full-access' }

/** 当前测试拥有的 ACP 子进程句柄，afterEach 中释放。 */
let spawned: LaunchedAcpTestAgent | undefined
/** 当前子进程使用的临时工作目录。 */
let workdir: string | undefined

afterEach(async () => {
  /** 转移给清理函数的子进程引用，避免共享状态重复释放。 */
  const ownedSpawned = spawned
  /** 转移给清理函数的工作目录引用。 */
  const ownedWorkdir = workdir
  spawned = undefined
  workdir = undefined
  await cleanupAcpExampleTest(ownedSpawned, ownedWorkdir)
})

describe('acp-agent over real stdio (no key required)', () => {
  it('emits only framed JSON-RPC on stdout', async () => {
    workdir = await mkdtemp(join(tmpdir(), 'acp-e2e-'))
    // Inspect the launcher's raw-byte tee in addition to driving its SDK client.
    // A dummy key lets the deepseek adapter APPLY (it only checks the key is
    // present at boot, not valid — the key is used only on a real model call,
    // which this purity test never triggers). So this runs WITHOUT real creds.
    spawned = launchAcpTestAgent({
      agent: AGENT,
      cwd: workdir,
      env: {
        DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY ?? 'sk-dummy-for-boot',
        ...DANGER_FULL_ACCESS_ENV,
      },
    })
    await spawned.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })

    const lines = spawned.rawStdout().split('\n').filter(line => line.trim().length > 0)
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) {
      // Every stdout line MUST parse as JSON (a JSON-RPC frame). A non-JSON
      // line means a logger/print leaked onto the protocol channel.
      expect(() => JSON.parse(line) as unknown).not.toThrow()
    }
  }, 30_000)

  it('session/new succeeds over real stdio (no model call)', async () => {
    // REGRESSION GUARD (this exact RPC exposed the missing-inject Loader bug):
    // `session/new` drives the
    // full bridge → `ctx.agents.create({sessionId, meta:{cwd}})` → AgentLoop →
    // registry/persistence path, ALL of which run from the JSON-RPC read loop
    // OUTSIDE the bridge plugin's injection scope. A lazy `ctx.<service>` read
    // on that path throws and the RPC fails with an Internal error — yet the
    // call never touches the model, so this reproduces WITHOUT a key. The
    // key-gated prompt test below never caught it (it needs real creds); the
    // initialize-only purity test never caught it (initialize does not reach
    // the factory). This closes that gap: boot the real subprocess and create a
    // session, asserting the RPC RESOLVES (not rejects with an inject error).
    workdir = await mkdtemp(join(tmpdir(), 'acp-e2e-'))
    // A dummy key lets the deepseek adapter boot (it only checks presence, not
    // validity, at apply time); no model call is made, so the key is never used.
    spawned = launchAcpTestAgent({
      agent: AGENT,
      cwd: workdir,
      env: {
        DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY ?? 'sk-dummy-for-boot',
        ...DANGER_FULL_ACCESS_ENV,
      },
    })
    const { client } = spawned

    await client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const { sessionId } = await client.newSession({ cwd: workdir, mcpServers: [] })
    expect(typeof sessionId).toBe('string')
    expect(sessionId.length).toBeGreaterThan(0)
  }, 60_000)
})

describe.skipIf(!process.env.DEEPSEEK_API_KEY)('acp-agent e2e: real prompt over ACP', () => {
  it('runs a real turn and the agent writes the requested file (verified on disk)', async () => {
    workdir = await mkdtemp(join(tmpdir(), 'acp-e2e-'))
    spawned = launchAcpTestAgent({ agent: AGENT, cwd: workdir, env: DANGER_FULL_ACCESS_ENV })
    const { client, updates } = spawned

    await client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    // Any absolute cwd is honored; use the temp `workdir` as this session's
    // workspace (the bash tool will run there) — it need not equal the launch dir.
    const { sessionId } = await client.newSession({ cwd: workdir, mcpServers: [] })

    const res = await client.prompt({
      sessionId,
      prompt: [{ type: 'text', text: 'Use the bash tool to write the exact text ACP_OK into a file named proof.txt in the current directory. Then stop.' }],
    })
    expect(['end_turn', 'max_tokens']).toContain(res.stopReason)

    // Assert the filesystem effect independently of the model response.
    const proof = await readFile(join(workdir, 'proof.txt'), 'utf8')
    expect(proof).toContain('ACP_OK')

    // The transport exposes only committed assistant text; tool execution is
    // proved by the world effect above and remains session-log data.
    expect(updates.length).toBeGreaterThan(0)
    expect(updates.every(update => update.sessionUpdate === 'agent_message_chunk')).toBe(true)
  }, 180_000)
})
