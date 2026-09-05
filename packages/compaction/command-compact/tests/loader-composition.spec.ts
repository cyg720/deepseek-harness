/**
 * 文件职责：验证上下文压缩的 loader-composition.spec.ts 行为。
 * 技术维度：Vitest、协议夹具、Worker/子进程或组件替身。
 * 产品维度：防止上下文压缩协议与生命周期回归。
 * 逻辑维度：构造输入，运行被测入口并断言输出与清理。
 * 关键边界：跨进程数据必须校验；Worker 和异步任务必须结束。
 * 新手阅读建议：先读协议夹具，再按成功、失败和清理场景阅读。
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import {
  CompactionId,
  CompactionEngine,
  /** 中文说明：类型或类 CompactionAgentContext 约束协议数据或模块职责。 */
  type CompactionAgentContext,
  /** 中文说明：类型或类 CompactionResult 约束协议数据或模块职责。 */
  type CompactionResult,
  /** 中文说明：类型或类 CompactionTrigger 约束协议数据或模块职责。 */
  type CompactionTrigger,
  /** 中文说明：类型或类 ManualCompactAgentContext 约束协议数据或模块职责。 */
  type ManualCompactAgentContext,
} from '@deepseek-ai/dsh-compaction'
import * as commandCompact from '@deepseek-ai/dsh-command-compact'
import { Session, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'

/** 中文说明：测试局部值 COMPACTION_ID，由紧邻初始化决定。 */
const COMPACTION_ID = CompactionId('loader-command-compact-test')

/** 中文说明：测试局部值 RESULT，由紧邻初始化决定。 */
const RESULT: CompactionResult = {
  compactionId: COMPACTION_ID,
  startSeq: SessionSeq(1),
  summarySeq: SessionSeq(2),
  endSeq: SessionSeq(3),
  summary: [{ type: 'text', text: 'loader summary' }],
  shadowedRange: { start: SessionSeq(3), end: SessionSeq(8) },
  shadowedSeqs: [SessionSeq(3), SessionSeq(5), SessionSeq(8)],
  shadowedTokenCount: 99,
}

/** 中文说明：类型或类 LoaderCompactionEngine 约束协议数据或模块职责。 */
class LoaderCompactionEngine extends CompactionEngine {
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
    _signal: AbortSignal,
    sourceCommandId?: Parameters<CompactionEngine['compactNow']>[2],
  ): Promise<CompactionResult | null> {
    /** 中文说明：测试局部值 provenance，由紧邻初始化决定。 */
    const provenance = {
      compactionId: RESULT.compactionId,
      ...sourceCommandId === undefined ? {} : { sourceCommandId },
    }
    agent.session.append('compaction/start', { ...provenance, turn: null })
    agent.session.append('compaction/summary', {
      ...provenance,
      summary: RESULT.summary,
      shadowedRange: RESULT.shadowedRange,
      shadowedSeqs: RESULT.shadowedSeqs,
      shadowedTokenCount: RESULT.shadowedTokenCount,
      provider: 'loader-test',
      model: 'loader-test',
    })
    agent.session.append('compaction/end', { ...provenance, turn: null })
    return Promise.resolve({ ...RESULT, ...provenance })
  }
}

/** 中文说明：测试局部值 root: string | undefined，由紧邻初始化决定。 */
let root: string | undefined
/** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('command-compact real Loader composition', () => {
  it('discovers and executes /compact through the assembled command plane', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-command-compact-loader-'))
    /** 中文说明：测试局部值 configPath，由紧邻初始化决定。 */
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-commands'",
      "- name: '@test/compact-backend'",
      "- name: '@deepseek-ai/dsh-command-compact'",
      '',
    ].join('\n'))

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    /** 中文说明：测试局部值 modules，由紧邻初始化决定。 */
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-commands', CommandRuntime],
      ['@test/compact-backend', LoaderCompactionEngine],
      ['@deepseek-ai/dsh-command-compact', commandCompact],
    ])
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(configPath).href },
    })
    await context.loader.await()

    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = Session.create(SessionId('loader-command-compact'))
    /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
    const agent = {
      session,
      status: 'idle',
      options: {},
      reserveTurnAdmission: () => () => undefined,
    } as unknown as Agent
    expect(context.commands.list(agent)).toContainEqual({
      name: 'compact',
      description: 'Compact older conversation history',
    })
    /** 中文说明：测试局部值 execution，由紧邻初始化决定。 */
    const execution = await context.commands.execute(agent, '/compact', [], new AbortController().signal)
    if (execution === undefined) throw new Error('Loader composition did not resolve /compact')
    expect(execution.result).toEqual({
      kind: 'success',
      text: 'Compacted 3 history items (~99 tokens).',
      sourceEventSeq: RESULT.summarySeq,
    })
    expect(session.snapshotEvents().map(event => ({ type: event.type, data: event.data }))).toEqual([
      {
        type: 'command/run',
        data: {
          commandId: execution.commandId,
          name: 'compact',
          args: '',
          source: { kind: 'user' },
        },
      },
      {
        type: 'compaction/start',
        data: {
          compactionId: COMPACTION_ID,
          sourceCommandId: execution.commandId,
          turn: null,
        },
      },
      {
        type: 'compaction/summary',
        data: {
          compactionId: COMPACTION_ID,
          sourceCommandId: execution.commandId,
          summary: RESULT.summary,
          shadowedRange: RESULT.shadowedRange,
          shadowedSeqs: RESULT.shadowedSeqs,
          shadowedTokenCount: RESULT.shadowedTokenCount,
          provider: 'loader-test',
          model: 'loader-test',
        },
      },
      {
        type: 'compaction/end',
        data: {
          compactionId: COMPACTION_ID,
          sourceCommandId: execution.commandId,
          turn: null,
        },
      },
      {
        type: 'command/done',
        data: {
          commandId: execution.commandId,
          kind: 'success',
          text: 'Compacted 3 history items (~99 tokens).',
          sourceEventSeq: RESULT.summarySeq,
        },
      },
    ])
    expect(session.surface.nodes).toEqual([])
    expect(session.deriveMessages()).toEqual([])
  })
})
