/** Production JSONL restart evidence through the real Agent resume lifecycle. */
/**
 * 文件职责：验证 jsonl-restart.spec.ts 覆盖的计划调度行为与失败场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件上下文和受控系统资源。
 * 产品维度：保障 Agent 使用计划调度时得到稳定且可诊断的结果。
 * 逻辑维度：准备配置与资源，触发被测流程，再核对结果、事件、错误和清理。
 * 关键边界：平台能力可能不同；持久化数据和外部输入不可信；异步资源必须完全释放。
 * 新手阅读建议：先读辅助函数和平台条件，再看正常路径，最后阅读恢复与失败用例。
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import * as toolSchedule from '../src/index.ts'
import {
  ScheduleId,
  createAfterScheduleRecord,
  foldScheduleEvents,
} from '../src/domain.ts'

/** 中文说明：变量 roots 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const roots: string[] = []
/** 中文说明：变量 contexts 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const contexts: Context[] = []

afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/** 中文说明：class RecordingAdapter 定义本测试所需的数据或行为，用于表达计划调度场景。 */
class RecordingAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    /** 中文说明：变量 response 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const response: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'Reminder acknowledged.' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
    /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
    for (const chunk of response) yield chunk
  }
}

/** 中文说明：函数 mountPersistence 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function mountPersistence(root: string): Promise<Context> {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  return ctx
}

/** 中文说明：函数 mountRuntime 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function mountRuntime(root: string, adapter: RecordingAdapter): Promise<Context> {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  ctx.llm.registerAdapter(['mock'], adapter)
  await ctx.plugin(toolSchedule)
  return ctx
}

/** 中文说明：函数 disposeContext 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function disposeContext(ctx: Context): Promise<void> {
  /** 中文说明：变量 index 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const index = contexts.indexOf(ctx)
  if (index >= 0) contexts.splice(index, 1)
  await ctx.fiber.dispose()
}

/** 中文说明：函数 waitForDispatch 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function waitForDispatch(ctx: Context, sessionId: SessionId): Promise<void> {
  return new Promise((resolve) => {
    /** 中文说明：函数值 stop 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const stop = ctx.on('session/event', (session, event) => {
      if (session.id !== sessionId
        || event.type !== 'schedule/change'
        || event.data.operation !== 'dispatch') return
      stop()
      resolve()
    })
  })
}

/** 中文说明：函数 settleCurrentTasks 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function settleCurrentTasks(): Promise<void> {
  await new Promise<void>(resolve => setImmediate(resolve))
}

describe('Schedule production JSONL restart', () => {
  it('resumes one overdue reminder exactly once across fresh runtime mounts', async () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = await mkdtemp(join(tmpdir(), 'dsh-schedule-jsonl-'))
    roots.push(root)
    /** 中文说明：变量 sessionId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sessionId = SessionId('schedule-jsonl-restart')
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = await mountPersistence(root)

    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = first.sessions.create(sessionId, { meta: { cwd: '/tmp' } })
    /** 中文说明：变量 pendingRecord 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pendingRecord = createAfterScheduleRecord(
      ScheduleId('schedule-1'), 'restart reminder', 1, Date.now() - 60_000,
    )
    pending.append('schedule/change', { version: 1, operation: 'create', schedule: pendingRecord })
    await expect(first.sessions.flush(pending)).resolves.toBe(true)
    await disposeContext(first)

    /** 中文说明：变量 dispatchingAdapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dispatchingAdapter = new RecordingAdapter()
    /** 中文说明：变量 restarted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const restarted = await mountRuntime(root, dispatchingAdapter)
    /** 中文说明：变量 dispatched 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dispatched = waitForDispatch(restarted, sessionId)
    /** 中文说明：变量 handle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const handle = await restarted.agents.resume({
      resumeSessionId: sessionId,
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    await dispatched
    await handle.agent.whenIdle()
    await expect(restarted.sessions.flush(handle.agent.session)).resolves.toBe(true)
    /** 中文说明：变量 dispatchedStored 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dispatchedStored = await restarted.sessionPersistence.inspect(sessionId)
    expect(foldScheduleEvents(dispatchedStored.events, dispatchedStored.meta.seedLength ?? 0).active)
      .toEqual([])
    /** 中文说明：函数值 dispatches 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const dispatches = dispatchedStored.events.filter(event =>
      event.type === 'schedule/change' && event.data.operation === 'dispatch')
    expect(dispatches).toHaveLength(1)
    expect(dispatchingAdapter.requests).toHaveLength(1)
    await handle.dispose()
    await disposeContext(restarted)

    /** 中文说明：变量 replayAdapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const replayAdapter = new RecordingAdapter()
    /** 中文说明：变量 replayed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const replayed = await mountRuntime(root, replayAdapter)
    /** 中文说明：变量 replayHandle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const replayHandle = await replayed.agents.resume({
      resumeSessionId: sessionId,
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    await replayed.sessions.flush(replayHandle.agent.session)
    await replayHandle.agent.whenIdle()
    await settleCurrentTasks()
    await replayed.sessions.flush(replayHandle.agent.session)

    expect(replayAdapter.requests).toEqual([])
    expect(replayHandle.agent.session.events.filter(event =>
      event.type === 'schedule/change' && event.data.operation === 'dispatch')).toHaveLength(1)
    /** 中文说明：变量 replayedStored 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const replayedStored = await replayed.sessionPersistence.inspect(sessionId)
    expect(replayedStored.events.filter(event =>
      event.type === 'schedule/change' && event.data.operation === 'dispatch')).toHaveLength(1)
    await replayHandle.dispose()
    await disposeContext(replayed)
  })
})
