/**
 * 文件职责：验证 Claude 风格 PreToolUse Hook 能在真实 ACP 示例中阻止模型执行 bash 写文件。
 * 技术维度：使用 Vitest、真实 ACP 子进程、临时 hooks.json、真实模型和磁盘反向验证。
 * 产品维度：确保部署者能用进程级 Hook 策略拦截危险工具操作，而不会让整个回合异常终止。
 * 逻辑维度：在临时启动目录写入全匹配 Hook，启动智能体，发送写文件任务，再确认操作被拒且文件不存在。
 * 关键边界：需要真实 API 密钥；Hook 配置相对启动 cwd；最终结论以磁盘状态而非模型回答为准。
 * 新手阅读建议：先读 hooks.json 内容，再看 ACP 初始化与 prompt，最后查看 stopReason 和文件不存在断言。
 */
import { mkdtemp, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import {
  launchAcpTestAgent,
  type AgentUnderTest,
  type LaunchedAcpTestAgent,
} from '@deepseek-ai/dsh-session-snapshot'
import { cleanupAcpExampleTest } from './cleanup.ts'

/**
 * With-key e2e for the Claude hook bridge. The process-level `./hooks.json` is
 * resolved from a temporary launch cwd and blocks all PreToolUse calls; a real
 * model is asked to write there, and absence of the file proves interception.
 * The test owns and disposes the ACP subprocess.
 */
/* 中文说明：进程级 hooks.json 拒绝所有 PreToolUse，真实模型尝试写文件后以文件缺失证明拦截。 */

/* ACP 示例的入口、组合配置和 TypeScript 路径。 */
const AGENT: AgentUnderTest = {
  binScript: fileURLToPath(new URL('../../../../src/bin.ts', import.meta.url)),
  configPath: fileURLToPath(new URL('../cordis.yml', import.meta.url)),
  profile: 'acp',
  tsconfigPath: fileURLToPath(new URL('../../../../../../tsconfig.json', import.meta.url)),
}

const STANDARD_EXECUTION_UPDATES = new Set([
  'agent_message_chunk',
  'agent_thought_chunk',
  'tool_call',
  'tool_call_update',
  'usage_update',
])

let spawned: LaunchedAcpTestAgent | undefined
/** 当前 Hook 配置和会话所在的临时目录。 */
let workdir: string | undefined

afterEach(async () => {
  const ownedSpawned = spawned
  const ownedWorkdir = workdir
  spawned = undefined
  workdir = undefined
  await cleanupAcpExampleTest(ownedSpawned, ownedWorkdir)
})

describe.skipIf(!process.env.DEEPSEEK_API_KEY)('acp-agent e2e: a PreToolUse hook blocks bash (real model)', () => {
  it('denies every bash command, so the requested file is never written (verified on disk)', async () => {
    workdir = await mkdtemp(join(tmpdir(), 'acp-hooks-e2e-'))
    // `configPath` is process-relative, so placing the match-all hook in the
    // launch cwd selects it; hook commands themselves run in the session cwd.
    await writeFile(join(workdir, 'hooks.json'), JSON.stringify({
      hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'echo "bash blocked by policy" >&2; exit 2' }] }] },
    }))

    spawned = launchAcpTestAgent({
      agent: AGENT,
      cwd: workdir,
      env: { DSH_PERMISSION_MODE: 'danger-full-access' },
    })
    const { client, updates } = spawned

    await client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const { sessionId } = await client.newSession({ cwd: workdir, mcpServers: [] })

    const res = await client.prompt({
      sessionId,
      prompt: [{ type: 'text', text: 'Use the bash tool to write the exact text HOOK_FAIL into a file named proof.txt in the current directory. Then stop.' }],
    })
    // The turn completes normally (the block is a tool-result error fed back to
    // the model, not a turn failure).
    expect(['end_turn', 'max_tokens']).toContain(res.stopReason)

    // Assert the denied operation independently of the model response.
    await expect(access(join(workdir, 'proof.txt'))).rejects.toThrow()

    // ACP publishes committed semantic execution facts, never hook internals or UI projections.
    expect(updates.some(update => update.sessionUpdate === 'agent_message_chunk')).toBe(true)
    expect(updates.every(update => STANDARD_EXECUTION_UPDATES.has(update.sessionUpdate))).toBe(true)
  }, 180_000)
})
