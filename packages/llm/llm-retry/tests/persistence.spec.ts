/**
 * 文件职责：验证 persistence.spec.ts 覆盖的 LLM 配置、调用与事件处理行为。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件上下文和可控测试替身验证运行时协作。
 * 产品维度：保障模型接入在配置变化、认证、重试与异常场景下仍能给 Agent 稳定反馈。
 * 逻辑维度：准备上下文与测试数据，触发被测流程，再核对请求、事件、结果和清理行为。
 * 关键边界：测试替身必须保持确定性；敏感凭据不可写入日志；异步资源必须在用例结束时释放。
 * 新手阅读建议：先看测试数据和辅助函数，再按 describe/it 场景阅读，最后对照被测插件实现。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SqliteSessionPersistence from '@deepseek-ai/dsh-session-persistence-sqlite'
import { RetryId } from '@deepseek-ai/dsh-llm-retry'
import type {} from '../src/index.ts'

/** 中文说明：变量 dirs 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const dirs: string[] = []

afterEach(async () => {
  /** 中文说明：该循环依次处理场景数据；循环变量仅在当前循环中有效。 */
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

/** 中文说明：函数 backend 承担本测试场景中的准备或验证工作；参数按签名传入，返回值供后续断言使用；示例见本文件调用。 */
async function backend(kind: 'jsonl' | 'sqlite'): Promise<Context> {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  if (kind === 'jsonl') {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = await mkdtemp(join(tmpdir(), 'dsh-llm-retry-jsonl-'))
    dirs.push(root)
    await ctx.plugin(JsonlSessionPersistence, { root })
  } else {
    await ctx.plugin(SqliteSessionPersistence, { path: ':memory:' })
  }
  return ctx
}

describe.each(['jsonl', 'sqlite'] as const)('%s retry-event persistence', (kind) => {
  it('round-trips the event losslessly without adding a model message', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await backend(kind)
    try {
      /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const session = ctx.sessions.create(SessionId(`retry-${kind}`))
      session.append('turn/start', { turn: 1 })
      session.append('step/start', { turn: 1, step: 1 })
      session.append('request/header', {
        header: { config: { provider: 'mock', model: 'mock' } },
        reason: 'initial',
      })
      /** 中文说明：变量 event 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const event = session.append('llm/retry', {
        retryId: RetryId(`retry-${kind}-chain`),
        turn: 1,
        step: 1,
        provider: 'mock',
        mode: 'always',
        policyKey: '["always",500,10000,0.1]',
        retry: 1,
        delayMs: 750,
        failure: { message: 'provider busy', code: 'RATE_LIMIT', status: 429 },
      })
      session.append('step/end', { turn: 1, step: 1 })
      session.append('turn/end', { turn: 1, reason: { kind: 'error', error: { message: 'provider busy', code: 'RATE_LIMIT', status: 429 },
      },
      })

      expect(session.deriveMessages()).toEqual([])
      await ctx.sessions.flush(session)
      /** 中文说明：变量 loaded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const loaded = await ctx.sessionPersistence.load(session.id)

      expect(loaded.events.find(item => item.type === 'llm/retry')).toEqual(event)
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
