/**
 * 文件职责：验证 invariant.spec.ts 覆盖的计划调度行为与失败场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件上下文和受控系统资源。
 * 产品维度：保障 Agent 使用计划调度时得到稳定且可诊断的结果。
 * 逻辑维度：准备配置与资源，触发被测流程，再核对结果、事件、错误和清理。
 * 关键边界：平台能力可能不同；持久化数据和外部输入不可信；异步资源必须完全释放。
 * 新手阅读建议：先读辅助函数和平台条件，再看正常路径，最后阅读恢复与失败用例。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry, { InvariantError } from '@deepseek-ai/dsh-invariants'
import SessionStore, { SessionId, SessionLogOffset, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import * as scheduleInvariant from '../src/invariant.ts'
import { ScheduleId } from '../src/domain.ts'
import type { ScheduleChange } from '../src/types.ts'

function event(data: unknown, seq: SessionSeq): SessionEvent {
  return { type: 'schedule/change', seq, time: 1, data } as SessionEvent
}

/** 中文说明：函数 create 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function create(id: string): ScheduleChange {
  return {
    version: 1,
    operation: 'create',
    schedule: {
      id: ScheduleId(id),
      kind: 'after',
      prompt: 'check logs',
      afterSeconds: 1,
      scheduledAt: '2026-08-05T12:00:01.000Z',
    },
  }
}

/** 中文说明：函数 createEvery 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function createEvery(id: string): ScheduleChange {
  return {
    version: 1,
    operation: 'create',
    schedule: {
      id: ScheduleId(id),
      kind: 'every',
      prompt: 'check metrics',
      everySeconds: 300,
      scheduledAt: '2026-08-05T12:05:00.000Z',
    },
  }
}

/** 中文说明：函数 harness 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function harness() {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantRegistry)
  /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const fiber = await ctx.plugin(scheduleInvariant)
  return { ctx, fiber }
}

describe('Schedule package invariant', () => {
  it('accepts valid candidates and rejects invalid transitions before append', async () => {
    const { ctx } = await harness()
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = ctx.sessions.create(SessionId('schedule-invariant'))
    session.append('turn/start', { turn: 1 })
    session.append('schedule/change', create('schedule-1'))
    expect(session.snapshotEvents()).toHaveLength(2)

    expect(() => session.append('schedule/change', {
      version: 1,
      operation: 'delete',
      id: ScheduleId('missing'),
    })).toThrow(InvariantError)
    expect(session.snapshotEvents()).toHaveLength(2)

    session.append('schedule/change', { version: 1, operation: 'dispatch', id: ScheduleId('schedule-1') })
    expect(session.snapshotEvents()).toHaveLength(3)
    await ctx.fiber.dispose()
  })

  it('requires a decision time for Every dispatch and advances the live stream', async () => {
    const { ctx } = await harness()
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = ctx.sessions.create(SessionId('schedule-every-invariant'))
    session.append('schedule/change', createEvery('schedule-every'))
    expect(() => session.append('schedule/change', {
      version: 1,
      operation: 'dispatch',
      id: ScheduleId('schedule-every'),
    })).toThrow(InvariantError)
    session.append('schedule/change', {
      version: 1,
      operation: 'dispatch',
      id: ScheduleId('schedule-every'),
      acceptedAt: '2026-08-05T12:17:34.000Z',
    })
    expect(session.snapshotEvents()).toHaveLength(2)
    await ctx.fiber.dispose()
  })

  it('rejects a malformed existing owned stream during companion setup', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(InvariantRegistry)
    ctx.sessions.create(SessionId('schedule-invalid-seed'), {
      seed: [event({ version: 9, operation: 'delete', id: 'schedule-1' }, SessionSeq(0))],
    })
    await expect(ctx.plugin(scheduleInvariant).then(() => undefined)).rejects.toThrow(InvariantError)
    await ctx.fiber.dispose()
  })

  it('rejects a malformed seeded session created after companion setup', async () => {
    const { ctx } = await harness()
    /** 中文说明：变量 id 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const id = SessionId('schedule-invalid-future-seed')
    expect(() => ctx.sessions.create(id, {
      seed: [event({ version: 9, operation: 'delete', id: 'schedule-1' }, SessionSeq(0))],
    })).toThrow(InvariantError)
    expect(ctx.sessions.get(id)).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('ignores inherited Schedule events before a fork seed boundary', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(InvariantRegistry)
    /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const child = ctx.sessions.create(SessionId('schedule-fork'), {
      seed: [event({ version: 9, operation: 'delete', id: 'parent' }, SessionSeq(0))],
      inheritedEventCount: SessionLogOffset(1),
      meta: { parentSession: SessionId('parent'), isSeeded: true },
    })
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = await ctx.plugin(scheduleInvariant)
    child.append('schedule/change', create('child'))
    expect(child.snapshotEvents().at(-1)?.data).toMatchObject({ operation: 'create' })
    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})
