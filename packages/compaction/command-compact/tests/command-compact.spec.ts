/**
 * 文件职责：验证上下文压缩的 command-compact.spec.ts 行为。
 * 技术维度：Vitest、协议夹具、Worker/子进程或组件替身。
 * 产品维度：防止上下文压缩协议与生命周期回归。
 * 逻辑维度：构造输入，运行被测入口并断言输出与清理。
 * 关键边界：跨进程数据必须校验；Worker 和异步任务必须结束。
 * 新手阅读建议：先读协议夹具，再按成功、失败和清理场景阅读。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime, { type CommandResult } from '@deepseek-ai/dsh-commands'
import {
  CompactionId,
  CompactionEngine,
  ManualCompactionError,
  /** 中文说明：类型或类 CompactionAgentContext 约束协议数据或模块职责。 */
  type CompactionAgentContext,
  /** 中文说明：类型或类 CompactionResult 约束协议数据或模块职责。 */
  type CompactionResult,
  /** 中文说明：类型或类 CompactionTrigger 约束协议数据或模块职责。 */
  type CompactionTrigger,
  /** 中文说明：类型或类 ManualCompactAgentContext 约束协议数据或模块职责。 */
  type ManualCompactAgentContext,
} from '@deepseek-ai/dsh-compaction'
import { Session, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import * as commandCompact from '@deepseek-ai/dsh-command-compact'

/** 中文说明：测试局部值 COMPACTION_ID，由紧邻初始化决定。 */
const COMPACTION_ID = CompactionId('command-compact-test')

/** 中文说明：测试局部值 RESULT，由紧邻初始化决定。 */
const RESULT: CompactionResult = {
  compactionId: COMPACTION_ID,
  startSeq: SessionSeq(1),
  summarySeq: SessionSeq(2),
  endSeq: SessionSeq(3),
  summary: [{ type: 'text', text: 'summary' }],
  shadowedRange: { start: SessionSeq(1), end: SessionSeq(7) },
  shadowedSeqs: [SessionSeq(1), SessionSeq(3), SessionSeq(7)],
  shadowedTokenCount: 42,
}

/** 中文说明：类型或类 StubCompactionEngine 约束协议数据或模块职责。 */
class StubCompactionEngine extends CompactionEngine {
  result: CompactionResult | null = RESULT
  failure: unknown
  operation: (() => Promise<CompactionResult | null>) | undefined
  calls: { agent: ManualCompactAgentContext; signal: AbortSignal }[] = []

  override compactIfNeeded(
    _agent: CompactionAgentContext,
    _trigger: CompactionTrigger,
    _signal: AbortSignal,
  ): Promise<CompactionResult | null> {
    return Promise.resolve(null)
  }

  override compactRegion(): Promise<CompactionResult> {
    return Promise.resolve(RESULT)
  }

  override compactNow(
    agent: ManualCompactAgentContext,
    signal: AbortSignal,
    sourceCommandId?: Parameters<CompactionEngine['compactNow']>[2],
  ): Promise<CompactionResult | null> {
    this.calls.push({ agent, signal })
    if (this.operation !== undefined) return this.operation()
    return this.failure === undefined
      ? Promise.resolve(this.result === null ? null : this.appendResult(agent, this.result, sourceCommandId))
      // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- exercise arbitrary backend rejection values.
      : Promise.reject(this.failure)
  }

  private appendResult(
    agent: ManualCompactAgentContext,
    result: CompactionResult,
    sourceCommandId: Parameters<CompactionEngine['compactNow']>[2],
  ): CompactionResult {
    /** 中文说明：测试局部值 provenance，由紧邻初始化决定。 */
    const provenance = {
      compactionId: result.compactionId,
      ...sourceCommandId === undefined ? {} : { sourceCommandId },
    }
    agent.session.append('compaction/start', { ...provenance, turn: null })
    agent.session.append('compaction/summary', {
      ...provenance,
      summary: result.summary,
      shadowedRange: result.shadowedRange,
      shadowedSeqs: result.shadowedSeqs,
      shadowedTokenCount: result.shadowedTokenCount,
      provider: 'command-test',
      model: 'command-test',
    })
    agent.session.append('compaction/end', { ...provenance, turn: null })
    return { ...result, ...provenance }
  }
}

/** 中文说明：类型或类 Harness 约束协议数据或模块职责。 */
interface Harness {
  readonly ctx: Context
  readonly compact: StubCompactionEngine
  readonly agent: Agent
  readonly plugin: Awaited<ReturnType<Context['plugin']>>
}

/** 中文说明：函数 harness 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function harness(): Promise<Harness> {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  await ctx.plugin(CommandRuntime)
  /** 中文说明：测试局部值 compact，由紧邻初始化决定。 */
  const compact = new StubCompactionEngine(ctx)
  /** 中文说明：测试局部值 plugin，由紧邻初始化决定。 */
  const plugin = await ctx.plugin(commandCompact)
  /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
  const session = Session.create(SessionId('command-compact'))
  /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
  const agent = {
    session,
    status: 'idle',
    options: {},
    reserveTurnAdmission: () => () => undefined,
  } as unknown as Agent
  return { ctx, compact, agent, plugin }
}

/** 中文说明：函数 run 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function run(
  test: Harness,
  suffix = '',
  controller = new AbortController(),
): Promise<NonNullable<Awaited<ReturnType<CommandRuntime['execute']>>>> {
  /** 中文说明：测试局部值 execution，由紧邻初始化决定。 */
  const execution = await test.ctx.commands.execute(test.agent, `/compact${suffix}`, [], controller.signal)
  if (execution === undefined) throw new Error('compact command was not registered')
  return execution
}

/** Assert the executor-owned lifecycle pair and absence from model history. */
/* 中文说明：函数 expectLastLifecycle 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function expectLastLifecycle(
  test: Harness,
  args: string,
  outcome: CommandResult,
): string {
  const lifecycle = test.agent.session.snapshotEvents()
    .filter(event => event.type === 'command/run' || event.type === 'command/done')
    .slice(-2)
  /** 中文说明：测试局部值 runEvent，由紧邻初始化决定。 */
  const runEvent = lifecycle[0]
  /** 中文说明：测试局部值 doneEvent，由紧邻初始化决定。 */
  const doneEvent = lifecycle[1]
  if (runEvent?.type !== 'command/run' || doneEvent?.type !== 'command/done') {
    throw new Error(`expected command lifecycle pair, got ${lifecycle.map(event => event.type).join(',')}`)
  }
  expect(lifecycle.map(event => ({ type: event.type, data: event.data }))).toEqual([
    {
      type: 'command/run',
      data: {
        commandId: runEvent.data.commandId,
        name: 'compact',
        args,
        source: { kind: 'user' },
      },
    },
    {
      type: 'command/done',
      data: {
        commandId: runEvent.data.commandId,
        ...outcome,
      },
    },
  ])
  expect(doneEvent.data.commandId).toBe(runEvent.data.commandId)
  expect(test.agent.session.surface.nodes).toEqual([])
  expect(test.agent.session.deriveMessages()).toEqual([])
  return runEvent.data.commandId
}

describe('@deepseek-ai/dsh-command-compact registration', () => {
  it('registers one argument-free command with Loader-safe exports and disposes it', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness()
    expect(commandCompact.name).toBe('command-compact')
    expect(commandCompact.inject).toEqual(['commands', 'compaction'])
    expect('default' in commandCompact).toBe(false)
    /** 中文说明：测试局部值 loader，由紧邻初始化决定。 */
    const loader = Object.create(Loader.prototype) as Loader
    expect(loader.unwrapExports(commandCompact)).toBe(commandCompact)
    expect(test.ctx.commands.list(test.agent)).toContainEqual({
      name: 'compact',
      description: 'Compact older conversation history',
    })

    await test.plugin.dispose()
    expect(test.ctx.commands.find(test.agent, 'compact')).toBeUndefined()
  })
})

describe('/compact human command', () => {
  it('reports success with useful accounting and forwards the exact target and signal', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness()
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new AbortController()
    /** 中文说明：测试局部值 execution，由紧邻初始化决定。 */
    const execution = await run(test, '', controller)
    expect(execution.result).toEqual({
      kind: 'success',
      text: 'Compacted 3 history items (~42 tokens).',
      sourceEventSeq: RESULT.summarySeq,
    })
    expect(execution.commandId).toBe(expectLastLifecycle(test, '', execution.result))
    expect(test.compact.calls).toEqual([{ agent: test.agent, signal: controller.signal }])
  })

  it('returns direct no-history and argument-rejection results', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness()
    test.compact.result = null
    /** 中文说明：测试局部值 empty，由紧邻初始化决定。 */
    const empty = await run(test)
    expect(empty.result).toEqual({
      kind: 'success',
      text: 'No compactable history yet.',
    })
    expect(empty.commandId).toBe(expectLastLifecycle(test, '', empty.result))

    /** 中文说明：测试局部值 rejected，由紧邻初始化决定。 */
    const rejected = await run(test, ' now')
    expect(rejected.result).toEqual({
      kind: 'error',
      text: 'Usage: /compact (no arguments)',
    })
    expect(rejected.commandId).toBe(expectLastLifecycle(test, ' now', rejected.result))
    expect(test.compact.calls).toHaveLength(1)
  })

  it.each([
    ['busy', 'Compaction is unavailable because this process has an active compaction, or the agent is not idle.'],
    ['cancelled', 'Compaction cancelled.'],
    ['changed', 'The history selected for compaction changed before it could be replaced. The conversation is unchanged; the attempt is recorded in the session log.'],
    ['summary', 'Compaction could not produce a useful summary. The conversation is unchanged; the attempt is recorded in the session log.'],
    ['commit', 'Compaction did not finish cleanly; some session history may have changed. Inspect the current session state before retrying.'],
    ['persistence', 'Compaction finished, but the session could not be saved.'],
  ] as const)('maps expected %s failures to direct errors', async (code, text) => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness()
    test.compact.failure = new ManualCompactionError(code, 'backend detail')
    /** 中文说明：测试局部值 execution，由紧邻初始化决定。 */
    const execution = await run(test)
    expect(execution.result).toEqual({ kind: 'error', text })
    expect(execution.commandId).toBe(expectLastLifecycle(test, '', execution.result))
  })

  it('preserves cancellation and unexpected implementation failures', async () => {
    /** 中文说明：测试局部值 cancelled，由紧邻初始化决定。 */
    const cancelled = await harness()
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new AbortController()
    /** 中文说明：测试局部值 abort，由紧邻初始化决定。 */
    const abort = new Error('operator cancelled')
    cancelled.compact.operation = () => {
      controller.abort(abort)
      return Promise.reject(new ManualCompactionError('summary', 'late failure'))
    }
    await expect(run(cancelled, '', controller)).rejects.toBe(abort)
    expectLastLifecycle(cancelled, '', { kind: 'error', text: abort.message })

    /** 中文说明：测试局部值 unexpected，由紧邻初始化决定。 */
    const unexpected = await harness()
    /** 中文说明：测试局部值 bug，由紧邻初始化决定。 */
    const bug = new Error('unexpected backend bug')
    unexpected.compact.failure = bug
    await expect(run(unexpected)).rejects.toBe(bug)
    expectLastLifecycle(unexpected, '', { kind: 'error', text: bug.message })
  })

  it('drains an aborted handler through close and flush before plugin disposal settles', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness()
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new AbortController()
    /** 中文说明：测试局部值 abort，由紧邻初始化决定。 */
    const abort = new Error('operator cancelled')
    /** 中文说明：测试局部值 started，由紧邻初始化决定。 */
    const started = Promise.withResolvers<undefined>()
    /** 中文说明：测试局部值 allowClose，由紧邻初始化决定。 */
    const allowClose = Promise.withResolvers<undefined>()
    /** 中文说明：测试局部值 closed，由紧邻初始化决定。 */
    const closed = Promise.withResolvers<undefined>()
    /** 中文说明：测试局部值 allowFlush，由紧邻初始化决定。 */
    const allowFlush = Promise.withResolvers<undefined>()
    /** 中文说明：测试局部值 flushed，由紧邻初始化决定。 */
    const flushed = Promise.withResolvers<undefined>()
    test.compact.operation = async () => {
      started.resolve(undefined)
      await allowClose.promise
      closed.resolve(undefined)
      await allowFlush.promise
      flushed.resolve(undefined)
      throw abort
    }

    /** 中文说明：测试局部值 execution，由紧邻初始化决定。 */
    const execution = run(test, '', controller)
    await started.promise
    controller.abort(abort)
    await expect(execution).rejects.toBe(abort)

    /** 中文说明：测试局部值 disposed，由紧邻初始化决定。 */
    let disposed = false
    /** 中文说明：测试局部值 disposal，由紧邻初始化决定。 */
    const disposal = test.plugin.dispose()
    void disposal.then(() => { disposed = true })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(test.ctx.commands.find(test.agent, 'compact')).toBeUndefined()
    expect(disposed).toBe(false)

    allowClose.resolve(undefined)
    await closed.promise
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(disposed).toBe(false)

    allowFlush.resolve(undefined)
    await flushed.promise
    await disposal
    expect(disposed).toBe(true)
  })
})
