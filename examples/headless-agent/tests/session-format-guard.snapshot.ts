/**
 * Assembled-app regression for the session-format refusal surface: resuming a
 * log written by a "newer" harness (format version ahead, or an unknown
 * required event type) fails loud through the real Loader composition, and the
 * error the product user sees names the direction and the raw log path.
 * @module session-format-guard-snapshot
 */
/*
 * 文件职责：验证组装应用拒绝恢复更新格式或含未知必需事件的会话日志，并给出可操作错误。
 * 技术维度：使用 Vitest、SessionStore、JSONL 持久化、Loader smoke 和程序化事件日志。
 * 产品维度：避免旧版本 Harness 误读新日志造成数据损坏，并告诉用户升级方向和原始文件位置。
 * 逻辑维度：写入版本超前或事件未知的会话，启动真实恢复组合，再检查错误方向、事件名和日志路径。
 * 关键边界：可忽略未知事件不应触发拒绝；必需未知事件必须失败；错误必须保留原始路径供恢复。
 * 新手阅读建议：先读 seedSession 与 closedTurn，再比较版本超前和未知事件两个拒绝场景。
 */

import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import SessionStore, {
  SESSION_FORMAT_VERSION,
  SessionId,
  type SessionEvent,
  type SessionHeader,
} from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { describe, expect, it } from 'vitest'

/** 借用恢复模型 fixture 的场景目录。 */
const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'workspace-context-resume-snapshots/offline-edit')
/** 恢复过程使用的模型回放日志。 */
const replayFixture = join(fixtureDir, 'replay.jsonl')
const configPath = fileURLToPath(new URL('../workspace-context-resume.cordis.snapshot.yml', import.meta.url))
const binScript = fileURLToPath(new URL('./fixtures/headless-driver.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
// The resumed-agent fixture in the shared config resumes exactly this id.
// 中文说明：共享配置中的恢复智能体固定恢复此会话标识。
/** 被格式门禁尝试恢复的稳定会话标识。 */
const sessionId = SessionId('workspace-context-resume')

/** Persist one session with the given header version and events, returning its log path. */
/* 在 root 中写入 version 与 events 指定的会话并返回日志路径。 */
async function seedSession(root: string, cwd: string, version: number, events: SessionEvent[]): Promise<string> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  const meta: SessionHeader = { version, id: sessionId, createdAt: 1, cwd }
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

function closedTurn(): SessionEvent[] {
  return [
    { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
    { type: 'turn/end', seq: 1, time: 2, data: { turn: 1, reason: { kind: 'completed' } } },
  ]
}

describe('session format guard through the assembled app', () => {
  it('refuses to resume a newer-format log, naming the upgrade direction and the raw log path', async () => {
    let sessionPath = ''
    const result = await runLoaderSmoke({
      label: 'newer-format resume refusal',
      tempDirPrefix: 'dsh-format-guard-version-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath, 'Try to resume.'],
      tsconfigPath,
      env: { DSH_SNAPSHOT_FILE: replayFixture },
      expectedExitCode: 1,
      prepare: async (runCwd) => {
        sessionPath = await seedSession(join(runCwd, '.sessions'), runCwd, SESSION_FORMAT_VERSION + 99, closedTurn())
      },
    })
    expect(result.stderr).toContain(
      `session "${sessionId}" uses log format v${SESSION_FORMAT_VERSION + 99}, but this harness reads only v${SESSION_FORMAT_VERSION}: the log was written by a newer harness — upgrade the harness to open it`,
    )
    // macOS reports the temp dir via the /private symlink parent; assert the
    // stable path suffix instead of the realpath-dependent prefix.
    expect(result.stderr).toContain('(raw log: ')
    expect(result.stderr).toContain(sessionPath.slice(sessionPath.indexOf('/.sessions/')))
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('refuses to resume a log with an unknown required event type', async () => {
    let sessionPath = ''
    const result = await runLoaderSmoke({
      label: 'unknown-event resume refusal',
      tempDirPrefix: 'dsh-format-guard-event-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath, 'Try to resume.'],
      tsconfigPath,
      env: { DSH_SNAPSHOT_FILE: replayFixture },
      expectedExitCode: 1,
      prepare: async (runCwd) => {
        sessionPath = await seedSession(join(runCwd, '.sessions'), runCwd, SESSION_FORMAT_VERSION, [
          ...closedTurn(),
          { type: 'future/event', seq: 2, time: 3, data: { payload: 1 } } as unknown as SessionEvent,
        ])
      },
    })
    expect(result.stderr).toContain(
      `session "${sessionId}" contains event type "future/event" (seq 2) unknown to this harness and not marked ignorable; refusing to interpret the log — it was likely written by a newer harness`,
    )
    // macOS reports the temp dir via the /private symlink parent; assert the
    // stable path suffix instead of the realpath-dependent prefix.
    expect(result.stderr).toContain('(raw log: ')
    expect(result.stderr).toContain(sessionPath.slice(sessionPath.indexOf('/.sessions/')))
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
