/**
 * 文件职责：验证 provider.spec.ts 覆盖的会话标题行为、持久化与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、事件日志、SQLite 或 OpenTelemetry。
 * 产品维度：保障 Agent 的会话标题状态稳定、可重放且可诊断。
 * 逻辑维度：准备或解析会话数据，执行核心流程，再处理结果、错误与资源清理。
 * 关键边界：持久化和遥测输入不可信；敏感数据必须脱敏；事件与数据库资源必须正确收尾。
 * 新手阅读建议：先看数据类型和辅助函数，再读写入/投影主流程，最后关注恢复、脱敏和失败场景。
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import LlmRuntime, { createUserMessage, LlmAdapter  } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionTitleService, { type SessionTitleProvider } from '@deepseek-ai/dsh-session-title'
import * as providerPlugin from '@deepseek-ai/dsh-session-title-first-prompt-llm'

/** 中文说明：class RecordingAdapter 定义本测试所需的数据或行为，用于表达会话标题场景。 */
class RecordingAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    yield { type: 'text-delta', index: 0, text: 'First-message model title' }
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
  provider: 'title-route',
  model: 'title-model',
} as const

/** 中文说明：函数 settle 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('first-prompt LLM title provider', () => {
  it('rejects an impossible empty provider request at its own boundary', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionTitleService, TITLE_CONFIG)
    /** 中文说明：变量 registered 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let registered: SessionTitleProvider | undefined
    vi.spyOn(ctx.sessionTitle, 'register').mockImplementation((provider) => {
      registered = provider
      return async () => undefined
    })
    providerPlugin.apply(ctx, LLM_CONFIG)

    await expect(registered!.generate({
      session: Session.create(SessionId('empty-first-provider')),
      messages: [],
      signal: new AbortController().signal,
    })).rejects.toThrow(/requires one human message/)
  })

  it('always selects only the first eligible human message, including explicit refresh', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionTitleService, TITLE_CONFIG)
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new RecordingAdapter()
    ctx.llm.registerAdapter(['title-route'], adapter)
    await ctx.plugin(providerPlugin, LLM_CONFIG)
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = ctx.sessions.create(SessionId('first-plugin'))
    session.append('turn/start', { turn: 1 })
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'first input' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    await settle()
    session.append('request/header', {
      header: { config: { provider: 'main', model: 'main-model' } }, reason: 'initial',
    })
    await settle()
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'second input must be ignored' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    await ctx.sessionTitle.refresh(session)

    expect(adapter.requests).toHaveLength(2)
    /** 中文说明：该循环依次处理会话数据；循环变量仅在当前循环中有效。 */
    for (const options of adapter.requests) {
      /** 中文说明：变量 content 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const content = options.messages[0]?.content[0]
      expect(content?.type === 'text' && content.text).toContain('first input')
      expect(content?.type === 'text' && content.text).not.toContain('second input must be ignored')
    }
    expect(ctx.sessionTitle.get(session)).toMatchObject({ messageSeqs: [first.seq] })
  })
})
