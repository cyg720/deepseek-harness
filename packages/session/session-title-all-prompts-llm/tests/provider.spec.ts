/**
 * 文件职责：验证 provider.spec.ts 覆盖的会话标题行为、持久化与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、事件日志、SQLite 或 OpenTelemetry。
 * 产品维度：保障 Agent 的会话标题状态稳定、可重放且可诊断。
 * 逻辑维度：准备或解析会话数据，执行核心流程，再处理结果、错误与资源清理。
 * 关键边界：持久化和遥测输入不可信；敏感数据必须脱敏；事件与数据库资源必须正确收尾。
 * 新手阅读建议：先看数据类型和辅助函数，再读写入/投影主流程，最后关注恢复、脱敏和失败场景。
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import LlmRuntime, { createUserMessage, LlmAdapter  } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionTitleService from '@deepseek-ai/dsh-session-title'
import * as providerPlugin from '@deepseek-ai/dsh-session-title-all-prompts-llm'

/** 中文说明：class RecordingAdapter 定义本测试所需的数据或行为，用于表达会话标题场景。 */
class RecordingAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    yield { type: 'text-delta', index: 0, text: 'All messages model title' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** 中文说明：常量 TITLE_CONFIG 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const TITLE_CONFIG = { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80 } as const
/** 中文说明：常量 LLM_CONFIG 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const LLM_CONFIG = {
  targetWords: 5,
  targetCjkCharacters: 10,
  maxInputBytes: 1_000,
  maxOutputTokens: 32,
  timeoutMs: 1_000,
} as const

/** 中文说明：函数 settle 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('all-messages LLM title provider', () => {
  it('includes seeded history and the latest prompt while inheriting the logged request route', async () => {
    /** 中文说明：变量 seeded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const seeded = Session.create(SessionId('seed-source'))
    seeded.append('turn/start', { turn: 1 })
    /** 中文说明：变量 inherited 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const inherited = seeded.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'inherited prompt' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    seeded.append('session/title', {
      title: 'Inherited fallback', messageSeqs: [inherited.seq], source: { kind: 'fallback' },
    })
    seeded.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionTitleService, TITLE_CONFIG)
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new RecordingAdapter()
    ctx.llm.registerAdapter(['current-route'], adapter)
    await ctx.plugin(providerPlugin, LLM_CONFIG)
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = ctx.sessions.create(SessionId('all-plugin'), {
      seed: seeded.events,
      meta: { parentSession: seeded.id, seedLength: seeded.seq },
    })
    session.append('turn/start', { turn: 2 })
    /** 中文说明：变量 latest 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const latest = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'latest prompt' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    await settle()
    session.append('request/header', {
      header: { config: { provider: 'current-route', model: 'current-model' } }, reason: 'resume',
    })
    await settle()

    expect(adapter.requests[0]).toMatchObject({ provider: 'current-route', model: 'current-model' })
    /** 中文说明：变量 content 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const content = adapter.requests[0]?.messages[0]?.content[0]
    expect(content?.type === 'text' && content.text).toContain('inherited prompt')
    expect(content?.type === 'text' && content.text).toContain('latest prompt')
    expect(ctx.sessionTitle.get(session)).toMatchObject({
      messageSeqs: [inherited.seq, latest.seq],
    })
  })
})
