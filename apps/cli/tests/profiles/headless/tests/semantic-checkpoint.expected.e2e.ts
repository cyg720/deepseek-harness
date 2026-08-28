/**
 * 文件职责：验证中断的有副作用工具调用被恢复为“结果未知”语义检查点，并安全继续后续任务。
 * 技术维度：使用 Vitest、SessionStore、JSONL 持久化、Loader smoke、模型回放和会话快照归一化。
 * 产品维度：进程崩溃后避免盲目重试可能已执行的远程写操作，提示智能体谨慎确认真实状态。
 * 逻辑维度：程序化写入停在 tool/call 的会话，重启驱动恢复，发送继续任务，再比较归一化日志。
 * 关键边界：未知结果调用不能伪造成成功或失败；原事件序列必须合法；刷新模式才更新预期快照。
 * 新手阅读建议：先看 seedInterruptedSession 的事件序列，再理解无 tool/result 的含义，最后读恢复快照断言。
 */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { normalizeSessionSnapshot, type NormalizeContext } from '@deepseek-ai/dsh-session-snapshot'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { createUserMessage, ToolCallId , createMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SESSION_FORMAT_VERSION, SessionId, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { describe, expect, it } from 'vitest'

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'expected/semantic-checkpoint')
const replayFixture = join(fixtureDir, 'replay.jsonl')
/** 恢复回答的回放覆盖文档。 */
const replayOverride = join(fixtureDir, 'replay.override.json')
/** 恢复后持久会话的预期快照。 */
const sessionExpected = join(fixtureDir, 'session.expected.jsonl')
const configPath = fileURLToPath(new URL('../semantic-checkpoint.cordis.snapshot.yml', import.meta.url))
const binScript = fileURLToPath(new URL('../../../../../../packages/test-support/loader-smoke/tests/fixtures/headless-driver.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../../../../tsconfig.json', import.meta.url))
const sessionId = SessionId('semantic-checkpoint-unknown-outcome')
/** 表示当前运行是否允许刷新预期文件。 */
const refreshing = process.env.DSH_SNAPSHOT === 'refresh'
/** 恢复后交给智能体的安全继续任务。 */
const task = 'Continue safely from the interrupted operation.'

/** 在 root 中持久化一个停在工具调用后的会话并返回日志路径。 */
async function seedInterruptedSession(root: string, cwd: string): Promise<string> {
  /** 只挂载会话与 JSONL 持久化的最小 Cordis 上下文。 */
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  const meta: SessionHeader = {
    version: SESSION_FORMAT_VERSION,
    id: sessionId,
    createdAt: 1,
    cwd,
    delegationDepth: 0,
  }
  const events: SessionEvent[] = [
    { type: 'turn/start', seq: 0, time: 10, data: { turn: 1 } },
    { type: 'user/message', seq: 1, time: 11, data: createUserMessage({
      content: [{ type: 'text', text: 'Perform one side-effecting remote mutation.' }], source: { kind: 'user' },
    }), surfaceOp: 'append' },
    { type: 'step/start', seq: 2, time: 12, data: { turn: 1, step: 1 } },
    {
      type: 'assistant/message',
      seq: 3,
      time: 13,
      data: {
        turn: 1,
        step: 1,
        message: createMessage({
          role: 'assistant',
          content: [{ type: 'tool-call', id: ToolCallId('unknown-outcome-call'), name: 'write_remote', arguments: '{"value":1}' }],
          source: {
            kind: 'model',
            ...{ provider: 'deepseek-official', model: 'deepseek-v4-flash' },
          },
        }),
      },
      surfaceOp: 'append',
    },
    {
      type: 'tool/call',
      seq: 4,
      time: 14,
      data: {
        turn: 1,
        step: 1,
        callId: ToolCallId('unknown-outcome-call'),
        name: 'write_remote',
        arguments: '{"value":1}',
      },
    },
  ]
  try {
    await ctx.sessionPersistence.create(meta)
    await ctx.sessionPersistence.append(sessionId, events)
    const location = ctx.sessionPersistence.locate(meta)
    if (location === undefined) throw new Error('JSONL backend did not locate the seeded session')
    return location.path
  } finally {
    await ctx.fiber.dispose()
  }
}

describe('semantic checkpoint recovery snapshot', () => {
  it('resumes an unknown tool outcome through the headless stream-json app', async () => {
    let cwd = ''
    let sessionPath = ''
    const result = await runLoaderSmoke({
      label: 'semantic checkpoint headless stream-json snapshot',
      tempDirPrefix: 'dsh-semantic-snapshot-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath, task],
      tsconfigPath,
      env: {
        DSH_SNAPSHOT_FILE: replayFixture,
        DSH_SNAPSHOT_OVERRIDE: replayOverride,
      },
      prepare: async (runCwd) => {
        cwd = runCwd
        sessionPath = await seedInterruptedSession(join(runCwd, '.sessions'), runCwd)
      },
      inspect: async () => {
        const normalization: NormalizeContext = { sessionIds: [sessionId], cwd }
        const session = normalizeSessionSnapshot(await readFile(sessionPath, 'utf8'), normalization)
        if (refreshing) await writeFile(sessionExpected, session)
        expect(session).toBe(await readFile(sessionExpected, 'utf8'))
        expect(session).toContain('TOOL_OUTCOME_UNKNOWN')
        expect(session).toContain('Do not retry blindly.')
      },
    })

    expect(result.stderr).toBe('')
    const records = result.stdout.trimEnd().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
    expect(records.at(-1)).toMatchObject({
      type: 'result',
      sessionId,
      output: 'I will verify the external state before deciding whether to retry the side-effecting operation.',
    })
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
