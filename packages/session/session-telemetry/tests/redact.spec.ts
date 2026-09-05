/**
 * 文件职责：验证 redact.spec.ts 覆盖的会话遥测行为、持久化与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、事件日志、SQLite 或 OpenTelemetry。
 * 产品维度：保障 Agent 的会话遥测状态稳定、可重放且可诊断。
 * 逻辑维度：准备或解析会话数据，执行核心流程，再处理结果、错误与资源清理。
 * 关键边界：持久化和遥测输入不可信；敏感数据必须脱敏；事件与数据库资源必须正确收尾。
 * 新手阅读建议：先看数据类型和辅助函数，再读写入/投影主流程，最后关注恢复、脱敏和失败场景。
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
/**
 * The `session-telemetry/record` waterfall contract: pass-through when no listener is
 * mounted, listener stacking and replacement, ops-record coverage, the
 * untouched canonical log, and the fail-closed containment of a throwing rule.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import {
  SessionTelemetryCoordinator,
  /** 中文说明：type SessionTelemetrySink 定义本测试所需的数据或行为，用于表达会话遥测场景。 */
  type SessionTelemetrySink,
  /** 中文说明：type SessionTelemetryRecord 定义本测试所需的数据或行为，用于表达会话遥测场景。 */
  type SessionTelemetryRecord,
} from '../src/index.ts'

/** 中文说明：常量 FIXTURE_SECRET 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const FIXTURE_SECRET = 'sk-fixture1234567890'

/** 中文说明：class CollectingBackend 定义本测试所需的数据或行为，用于表达会话遥测场景。 */
class CollectingBackend implements SessionTelemetrySink {
  records: SessionTelemetryRecord[] = []
  emit(record: SessionTelemetryRecord): void {
    this.records.push(record)
  }
  async shutdown(): Promise<void> {}
}

/** 中文说明：函数 setup 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function setup() {
  /** 中文说明：变量 backend 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const backend = new CollectingBackend()
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const fiber = await ctx.plugin({
    name: 'fake-telemetry',
    inject: ['sessions'],
    apply: (inner: Context) => void new SessionTelemetryCoordinator(inner, backend),
  })
  return { ctx, backend, fiber }
}

describe('session-telemetry/record waterfall', () => {
  it('passes records through unchanged when no listener is mounted', async () => {
    const { ctx, backend } = await setup()
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = ctx.sessions.create(SessionId('w'))
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: `key ${FIXTURE_SECRET}` }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    /** 中文说明：变量 body 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const body = backend.records[0]!.body as { content: { text: string }[] }
    expect(body.content[0]!.text).toBe(`key ${FIXTURE_SECRET}`)
  })

  it('applies a mounted rule to every outbound record, ops records included', async () => {
    const { ctx, backend, fiber } = await setup()
    ctx.on('session-telemetry/record', (_record, next) => {
      /** 中文说明：变量 record 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const record = next()
      return { ...record, body: { scrubbed: true } }
    })
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = ctx.sessions.create(SessionId('rule'))
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: FIXTURE_SECRET }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    expect(backend.records[0]!.body).toEqual({ scrubbed: true })
    // The dispose-time shutdown ops record passes through the same waterfall.
    await fiber.dispose()
    /** 中文说明：函数值 ops 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const ops = backend.records.filter(record => record.channel === 'ops')
    expect(ops).toHaveLength(1)
    expect(ops[0]!.body).toEqual({ scrubbed: true })
  })

  it('keeps the canonical log untouched by a mounted rule', async () => {
    const { ctx } = await setup()
    ctx.on('session-telemetry/record', (_record, next) => ({ ...next(), body: null }))
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = ctx.sessions.create(SessionId('log'))
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: FIXTURE_SECRET }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    const logged = session.snapshotEvents()[0]!.data as { content: { text: string }[] }
    expect(logged.content[0]!.text).toBe(FIXTURE_SECRET)
  })

  it('stacks listeners outermost-first around next()', async () => {
    const { ctx, backend } = await setup()
    /** 中文说明：变量 order 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const order: string[] = []
    ctx.on('session-telemetry/record', (_record, next) => {
      order.push('outer-before')
      /** 中文说明：变量 record 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const record = next()
      order.push('outer-after')
      return { ...record, attributes: { ...record.attributes, outer: 1 } }
    })
    ctx.on('session-telemetry/record', (_record, next) => {
      order.push('inner')
      /** 中文说明：变量 record 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const record = next()
      return { ...record, attributes: { ...record.attributes, inner: 1 } }
    })
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = ctx.sessions.create(SessionId('stack'))
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    expect(order).toEqual(['outer-before', 'inner', 'outer-after'])
    expect(backend.records[0]!.attributes).toMatchObject({ outer: 1, inner: 1 })
  })

  it('a listener that skips next() replaces everything beneath it', async () => {
    const { ctx, backend } = await setup()
    /** 中文说明：变量 inner 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const inner = { called: false }
    ctx.on('session-telemetry/record', () => ({ channel: 'ops', time: 0, severity: 'info', attributes: {}, body: 'replaced' } satisfies SessionTelemetryRecord))
    ctx.on('session-telemetry/record', (_record, next) => {
      inner.called = true
      return next()
    })
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = ctx.sessions.create(SessionId('veto'))
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    expect(backend.records[0]!.body).toBe('replaced')
    expect(inner.called).toBe(false)
  })

  it('a throwing rule withholds the record fail-closed without disturbing the log', async () => {
    const { ctx, backend } = await setup()
    ctx.on('session-telemetry/record', () => {
      throw new Error('rule exploded')
    })
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = ctx.sessions.create(SessionId('closed'))
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    expect(backend.records).toHaveLength(0)
    expect(session.snapshotEvents()).toHaveLength(1)
  })
})
