/**
 * 文件职责：验证 persistence.spec.ts 覆盖的会话标题行为、持久化与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、事件日志、SQLite 或 OpenTelemetry。
 * 产品维度：保障 Agent 的会话标题状态稳定、可重放且可诊断。
 * 逻辑维度：准备或解析会话数据，执行核心流程，再处理结果、错误与资源清理。
 * 关键边界：持久化和遥测输入不可信；敏感数据必须脱敏；事件与数据库资源必须正确收尾。
 * 新手阅读建议：先看数据类型和辅助函数，再读写入/投影主流程，最后关注恢复、脱敏和失败场景。
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SqliteSessionPersistence from '@deepseek-ai/dsh-session-persistence-sqlite'
import SessionTitleService, { foldSessionTitle } from '@deepseek-ai/dsh-session-title'

/** 中文说明：常量 CONFIG 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const CONFIG = {
  fallbackMaxWords: 5,
  fallbackMaxBytes: 40,
  maxTitleBytes: 80,
} as const

/** 中文说明：变量 roots 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const roots: string[] = []

afterEach(async () => {
  /** 中文说明：该循环依次处理会话数据；循环变量仅在当前循环中有效。 */
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/** 中文说明：函数 appendPersistedTitle 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function appendPersistedTitle(ctx: Context, id: ReturnType<typeof SessionId>): Promise<void> {
  /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const session = ctx.sessions.create(id)
  session.append('turn/start', {
    turn: 1,
  })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Persist this session title' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  await ctx.sessionTitle.refresh(session)
}

/** 中文说明：函数 expectPersistedTitle 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function expectPersistedTitle(ctx: Context, id: ReturnType<typeof SessionId>): Promise<void> {
  /** 中文说明：变量 loaded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const loaded = await ctx.sessionPersistence.load(id)
  expect(foldSessionTitle(loaded.events)).toMatchObject({
    title: 'Persist this session title',
    messageSeqs: [1],
    source: { kind: 'fallback' },
    eventSeq: 3,
  })
  expect(loaded.events.map(event => event.type)).toEqual([
    'turn/start',
    'user/message',
    'turn/end',
    'session/title',
  ])
}

describe('session title persistence round trips', () => {
  it('round-trips through a remounted JSONL backend', async () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = await mkdtemp(join(tmpdir(), 'dsh-title-jsonl-'))
    roots.push(root)
    /** 中文说明：变量 id 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const id = SessionId('title-jsonl')
    /** 中文说明：变量 writer 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const writer = new Context()
    await writer.plugin(SessionStore)
    await writer.plugin(JsonlSessionPersistence, { root, compression: 'none' })
    await writer.plugin(SessionTitleService, CONFIG)
    await appendPersistedTitle(writer, id)
    await writer.fiber.dispose()

    /** 中文说明：变量 reader 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const reader = new Context()
    await reader.plugin(SessionStore)
    await reader.plugin(JsonlSessionPersistence, { root, compression: 'none' })
    await expectPersistedTitle(reader, id)
    await reader.fiber.dispose()
  })

  it('round-trips through a remounted SQLite backend', async () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = await mkdtemp(join(tmpdir(), 'dsh-title-sqlite-'))
    roots.push(root)
    /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = join(root, 'sessions.db')
    /** 中文说明：变量 id 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const id = SessionId('title-sqlite')
    /** 中文说明：变量 writer 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const writer = new Context()
    await writer.plugin(SessionStore)
    await writer.plugin(SqliteSessionPersistence, { path })
    await writer.plugin(SessionTitleService, CONFIG)
    await appendPersistedTitle(writer, id)
    await writer.fiber.dispose()

    /** 中文说明：变量 reader 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const reader = new Context()
    await reader.plugin(SessionStore)
    await reader.plugin(SqliteSessionPersistence, { path })
    await expectPersistedTitle(reader, id)
    await reader.fiber.dispose()
  })
})
