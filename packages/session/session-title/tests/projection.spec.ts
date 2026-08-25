/**
 * The `title` projection unit: mounting the title service beside the
 * projection registry serves the current normalized title (last-wins over
 * session/title events, the same events foldSessionTitle consumes) — null
 * before the first title — through the registry snapshot and the change
 * feed; compositions without the registry are unaffected; unmounting the
 * service removes the key (HMR safety). The bespoke session/title mux frame
 * is untouched by this unit (its retirement is the client value-store
 * migration's concern).
 */
/*
 * 文件职责：验证 projection.spec.ts 覆盖的会话标题行为、持久化与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、事件日志、SQLite 或 OpenTelemetry。
 * 产品维度：保障 Agent 的会话标题状态稳定、可重放且可诊断。
 * 逻辑维度：准备或解析会话数据，执行核心流程，再处理结果、错误与资源清理。
 * 关键边界：持久化和遥测输入不可信；敏感数据必须脱敏；事件与数据库资源必须正确收尾。
 * 新手阅读建议：先看数据类型和辅助函数，再读写入/投影主流程，最后关注恢复、脱敏和失败场景。
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SessionTitleService from '@deepseek-ai/dsh-session-title'

/** 中文说明：常量 CONFIG 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const CONFIG = { fallbackMaxWords: 8, fallbackMaxBytes: 64, maxTitleBytes: 256 }

/** 中文说明：函数 harness 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function harness(withTitleService: boolean): Promise<{ ctx: Context; session: Session }> {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  if (withTitleService) await ctx.plugin(SessionTitleService, CONFIG)
  return { ctx, session: ctx.sessions.create(SessionId('titled')) }
}

/** Append one session/title event directly (the replay-plane shape the unit folds). */
/* 中文说明：函数 appendTitle 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function appendTitle(session: Session, title: string): number {
  return session.append('session/title', { title, messageSeqs: [1], source: { kind: 'fallback' } }).seq
}

describe('title projection unit', () => {
  it('serves null before the first title event', async () => {
    const { ctx, session } = await harness(true)
    /** 中文说明：变量 snapshot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const snapshot = ctx.sessionProjections.snapshot(session)
    expect(snapshot.values.title).toBeNull()
  })

  it('serves the latest title last-wins and notifies the change feed with the causing seq', async () => {
    const { ctx, session } = await harness(true)
    /** 中文说明：变量 changes 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const changes: { key: string; value: unknown; seq: number }[] = []
    ctx.sessionProjections.onChanged((_session, key, value, seq) => {
      changes.push({ key, value, seq })
    })
    /** 中文说明：变量 firstSeq 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const firstSeq = appendTitle(session, 'First title')
    /** 中文说明：变量 secondSeq 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const secondSeq = appendTitle(session, 'Second title')
    // Unrelated event: same-reference apply, no notification.
    session.append('turn/start', { turn: 1 })
    expect(changes).toEqual([
      { key: 'title', value: 'First title', seq: firstSeq },
      { key: 'title', value: 'Second title', seq: secondSeq },
    ])
    /** 中文说明：变量 snapshot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const snapshot = ctx.sessionProjections.snapshot(session)
    expect(snapshot.values.title).toBe('Second title')
    expect(snapshot.asOfSeq).toBe(session.seq - 1)
  })

  it('folds titles already in the log when the service mounts late (lazy cell build)', async () => {
    const { ctx, session } = await harness(false)
    appendTitle(session, 'Pre-mount title')
    await ctx.plugin(SessionTitleService, CONFIG)
    expect(ctx.sessionProjections.snapshot(session).values.title).toBe('Pre-mount title')
  })

  it('has no title key without the title service, and drops it when the service unloads (HMR safety)', async () => {
    const { ctx, session } = await harness(false)
    expect('title' in ctx.sessionProjections.snapshot(session).values).toBe(false)
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = await ctx.plugin(SessionTitleService, CONFIG)
    appendTitle(session, 'Ephemeral')
    expect(ctx.sessionProjections.snapshot(session).values.title).toBe('Ephemeral')
    await fiber.dispose()
    expect('title' in ctx.sessionProjections.snapshot(session).values).toBe(false)
  })
})
