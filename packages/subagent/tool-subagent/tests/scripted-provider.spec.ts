/**
 * 文件职责：验证 scripted-provider.spec.ts 覆盖的子代理工具行为与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、进程流、终端会话或快照规范化。
 * 产品维度：保障 Agent 的子代理工具能力稳定、可复现且可诊断。
 * 逻辑维度：准备输入和资源，执行核心流程，收集事件或输出，再处理错误与清理。
 * 关键边界：进程退出与取消可能竞态；外部输出不可信；清理必须等待子资源完全停止。
 * 新手阅读建议：先看类型和夹具，再读启动/收集主流程，最后关注平台差异、规范化和清理。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { type Agent } from '@deepseek-ai/dsh-agent'
import SubagentRuntime, { type SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as scripted from './scripted-provider.ts'

/** A minimal parent; the scripted provider only reads its id. */
/** 中文说明：函数 fakeParent 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function fakeParent(id = 'parent-1'): Agent {
  return { id: SessionId(id) } as unknown as Agent
}

/** 中文说明：函数 baseRequest 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function baseRequest(over: Partial<SubagentStartRequest> = {}): SubagentStartRequest {
  return {
    prompt: [{ type: 'text', text: 'task' }],
    parent: fakeParent(),
    signal: new AbortController().signal,
    ...over,
  }
}

/** 中文说明：函数 mount 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function mount(config: Partial<scripted.Config> = {}): Promise<Context> {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  await ctx.plugin(SubagentRuntime)
  await scripted.mountScriptedProvider(ctx, { name: 'mock', ...config })
  return ctx
}

describe('scripted subagent provider fixture', () => {
  it('registers through the real service and returns the scripted reply', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await mount({ reply: 'hello from fixture' })
    expect(ctx.subagents.list()).toEqual(['mock'])

    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = await ctx.subagents.start('mock', baseRequest())
    await expect(run.result).resolves.toEqual({
      output: [{ type: 'text', text: 'hello from fixture' }],
      structured: undefined,
      stopReason: 'completed',
    })
    await run.dispose()
  })

  it('registers under a configurable name', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await mount({ name: 'spawn' })
    expect(ctx.subagents.list()).toEqual(['spawn'])
  })

  it('returns configured and default structured results', async () => {
    /** 中文说明：变量 configured 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const configured = await mount({ reply: 'r', structured: { answer: 42 } })
    /** 中文说明：变量 schema 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const schema = { type: 'object' as const, properties: { answer: { type: 'number' as const } } }
    /** 中文说明：变量 configuredRun 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const configuredRun = await configured.subagents.start('mock', baseRequest({ outputSchema: schema }))
    await expect(configuredRun.result).resolves.toMatchObject({ structured: { answer: 42 } })

    /** 中文说明：变量 fallback 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fallback = await mount({ reply: 'fallback reply' })
    /** 中文说明：变量 fallbackRun 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fallbackRun = await fallback.subagents.start('mock', baseRequest({ outputSchema: schema }))
    await expect(fallbackRun.result).resolves.toMatchObject({ structured: { reply: 'fallback reply' } })
  })

  it('omits structured output when no schema is requested', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await mount({ capabilities: { outputSchema: false } })
    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = await ctx.subagents.start('mock', baseRequest())
    expect(await run.result).not.toHaveProperty('structured')
  })

  it('honors configured and cancellation stop reasons', async () => {
    /** 中文说明：变量 refused 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const refused = await mount({ stopReason: 'refusal' })
    /** 中文说明：变量 refusedRun 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const refusedRun = await refused.subagents.start('mock', baseRequest())
    await expect(refusedRun.result).resolves.toMatchObject({ stopReason: 'refusal' })

    /** 中文说明：变量 cancelled 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cancelled = await mount()
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    /** 中文说明：变量 cancelledRun 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cancelledRun = await cancelled.subagents.start('mock', baseRequest({ signal: controller.signal }))
    controller.abort()
    await expect(cancelledRun.result).resolves.toMatchObject({ stopReason: 'aborted' })
  })

  it('rejects cancellation before or during asynchronous publication', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await mount()
    /** 中文说明：变量 alreadyAborted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const alreadyAborted = new AbortController()
    alreadyAborted.abort()
    await expect(ctx.subagents.start('mock', baseRequest({ signal: alreadyAborted.signal })))
      .rejects.toThrow('scripted subagent start aborted before publication')

    /** 中文说明：变量 handoff 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const handoff = new AbortController()
    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = ctx.subagents.start('mock', baseRequest({ signal: handoff.signal }))
    handoff.abort()
    await expect(pending).rejects.toThrow('scripted subagent start aborted before publication')
  })

  it('unregisters with its owning fixture fiber', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SubagentRuntime)
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = await scripted.mountScriptedProvider(ctx, { name: 'mock' })
    expect(ctx.subagents.list()).toEqual(['mock'])
    await fiber.dispose()
    expect(ctx.subagents.list()).toEqual([])
  })
})
