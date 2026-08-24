// Per-turn latency/throughput fold and the footer figure formatters.
/**
 * 文件职责：验证会话输入的 turn-metrics.client.spec.ts 行为。
 * 技术维度：Vitest、React 渲染、事件模拟和服务替身。
 * 产品维度：防止会话输入用户流程回归。
 * 逻辑维度：构造状态，触发行为并断言结果和清理。
 * 关键边界：异步任务、全局替身和 DOM 必须在用例后恢复。
 * 新手阅读建议：先读辅助函数，再按场景顺序阅读。
 */

import { describe, expect, it } from 'vitest'
import type { AssistantMessageNode, ConversationNode, UserMessageNode } from '@deepseek-ai/dsh-client-runtime/client'
import { assistantStepReading, deriveTurnMetrics } from '../src/client/chat/turn-metrics.ts'
import { formatLatencySeconds, formatTokensPerSecond } from '../src/client/chat/message-chrome.ts'

/** 中文说明：类型或类 StepSpec 约束本文件数据或组件职责。 */
interface StepSpec {
  seq: number
  turn: number
  step: number
  timing?: AssistantMessageNode['timing']
  usage?: unknown
}

/** 中文说明：测试局部值 assistant，由紧邻初始化决定。 */
const assistant = ({ seq, turn, step, timing, usage }: StepSpec): AssistantMessageNode => ({
  kind: 'assistant', seq, time: seq * 1_000, turn, step, blocks: [{ kind: 'text', text: `t${seq}` }],
  ...(timing === undefined ? {} : { timing }),
  ...(usage === undefined ? {} : { usage }),
})

/** 中文说明：测试局部值 user，由紧邻初始化决定。 */
const user = (seq: number): UserMessageNode => ({
  kind: 'user', seq, time: seq * 1_000, content: [{ type: 'text', text: 'hi' }] as never, source: null,
})

describe('assistantStepReading', () => {
  it('derives ttft, decode time, and output tokens from a fully recorded step', () => {
    /** 中文说明：测试局部值 reading，由紧邻初始化决定。 */
    const reading = assistantStepReading(assistant({
      seq: 2, turn: 1, step: 1,
      timing: { stepStartTime: 1_000, firstTokenTime: 1_800, completedTime: 6_800 },
      usage: { outputTokens: 200 },
    }))
    expect(reading).toEqual({ ttftMs: 800, decodeMs: 5_000, outputTokens: 200 })
  })

  it('returns nulls when timing is absent', () => {
    /** 中文说明：测试局部值 reading，由紧邻初始化决定。 */
    const reading = assistantStepReading(assistant({ seq: 2, turn: 1, step: 1, usage: { outputTokens: 5 } }))
    expect(reading).toEqual({ ttftMs: null, decodeMs: null, outputTokens: 5 })
  })

  it('needs both boundaries for ttft and clamps negative spans to zero', () => {
    expect(assistantStepReading(assistant({
      seq: 2, turn: 1, step: 1,
      timing: { stepStartTime: null, firstTokenTime: 1_800, completedTime: 6_800 },
    }))).toEqual({ ttftMs: null, decodeMs: 5_000, outputTokens: null })
    expect(assistantStepReading(assistant({
      seq: 2, turn: 1, step: 1,
      timing: { stepStartTime: 1_000, firstTokenTime: null, completedTime: 6_800 },
    }))).toEqual({ ttftMs: null, decodeMs: null, outputTokens: null })
    expect(assistantStepReading(assistant({
      seq: 2, turn: 1, step: 1,
      timing: { stepStartTime: 2_000, firstTokenTime: 1_500, completedTime: 1_200 },
    }))).toEqual({ ttftMs: 0, decodeMs: 0, outputTokens: null })
  })

  it('rejects non-object, missing, and non-finite usage token counts', () => {
    /** 中文说明：测试局部值 timing，由紧邻初始化决定。 */
    const timing = { stepStartTime: 1_000, firstTokenTime: 1_500, completedTime: 2_000 }
    expect(assistantStepReading(assistant({ seq: 2, turn: 1, step: 1, timing, usage: 'weird' })).outputTokens).toBeNull()
    expect(assistantStepReading(assistant({ seq: 2, turn: 1, step: 1, timing, usage: {} })).outputTokens).toBeNull()
    /** 中文说明：测试局部值 nan，由紧邻初始化决定。 */
    const nan = assistant({ seq: 2, turn: 1, step: 1, timing, usage: { outputTokens: Number.NaN } })
    expect(assistantStepReading(nan).outputTokens).toBeNull()
    expect(assistantStepReading(assistant({ seq: 2, turn: 1, step: 1, timing, usage: { outputTokens: -3 } })).outputTokens).toBeNull()
  })
})

describe('deriveTurnMetrics', () => {
  it('takes ttft from the lowest step and throughput over all sampled steps', () => {
    /** 中文说明：测试局部值 nodes，由紧邻初始化决定。 */
    const nodes: ConversationNode[] = [
      user(1),
      // Out of step order on purpose: the lowest step owns the ttft slot.
      assistant({
        seq: 4, turn: 1, step: 2,
        timing: { stepStartTime: 10_000, firstTokenTime: 10_200, completedTime: 12_200 },
        usage: { outputTokens: 60 },
      }),
      assistant({
        seq: 2, turn: 1, step: 1,
        timing: { stepStartTime: 1_000, firstTokenTime: 2_200, completedTime: 5_200 },
        usage: { outputTokens: 40 },
      }),
    ]
    // 100 tokens over 5s of decode.
    expect(deriveTurnMetrics(nodes).get(1)).toEqual({ ttftMs: 1_200, tokensPerSecond: 20 })
  })

  it('emits ttft without throughput when no step carries usage', () => {
    /** 中文说明：测试局部值 nodes，由紧邻初始化决定。 */
    const nodes = [assistant({
      seq: 2, turn: 1, step: 1,
      timing: { stepStartTime: 1_000, firstTokenTime: 1_900, completedTime: 3_000 },
    })]
    expect(deriveTurnMetrics(nodes).get(1)).toEqual({ ttftMs: 900 })
  })

  it('emits throughput without ttft when only a later step is recorded', () => {
    /** 中文说明：测试局部值 nodes，由紧邻初始化决定。 */
    const nodes = [
      assistant({ seq: 2, turn: 1, step: 1 }),
      assistant({
        seq: 4, turn: 1, step: 2,
        timing: { stepStartTime: 10_000, firstTokenTime: 10_500, completedTime: 12_500 },
        usage: { outputTokens: 30 },
      }),
    ]
    expect(deriveTurnMetrics(nodes).get(1)).toEqual({ tokensPerSecond: 15 })
  })

  it('omits turns with no readings and zero-decode throughput', () => {
    /** 中文说明：测试局部值 nodes，由紧邻初始化决定。 */
    const nodes = [
      assistant({ seq: 2, turn: 1, step: 1 }),
      assistant({
        seq: 4, turn: 2, step: 1,
        timing: { stepStartTime: null, firstTokenTime: 5_000, completedTime: 5_000 },
        usage: { outputTokens: 10 },
      }),
    ]
    expect(deriveTurnMetrics(nodes).size).toBe(0)
  })

  it('keeps turns independent and ignores non-assistant nodes', () => {
    /** 中文说明：测试局部值 nodes，由紧邻初始化决定。 */
    const nodes: ConversationNode[] = [
      user(1),
      assistant({
        seq: 2, turn: 1, step: 1,
        timing: { stepStartTime: 1_000, firstTokenTime: 1_400, completedTime: 2_400 },
        usage: { outputTokens: 10 },
      }),
      user(3),
      assistant({
        seq: 4, turn: 2, step: 1,
        timing: { stepStartTime: 4_000, firstTokenTime: 4_100, completedTime: 6_100 },
        usage: { outputTokens: 100 },
      }),
    ]
    /** 中文说明：测试局部值 metrics，由紧邻初始化决定。 */
    const metrics = deriveTurnMetrics(nodes)
    expect(metrics.get(1)).toEqual({ ttftMs: 400, tokensPerSecond: 10 })
    expect(metrics.get(2)).toEqual({ ttftMs: 100, tokensPerSecond: 50 })
  })
})

describe('footer figure formatters', () => {
  it('formats latency with one decimal under ten seconds and whole seconds beyond', () => {
    expect(formatLatencySeconds(840)).toBe('0.8')
    expect(formatLatencySeconds(1_000)).toBe('1')
    expect(formatLatencySeconds(9_949)).toBe('9.9')
    expect(formatLatencySeconds(12_400)).toBe('12')
    expect(formatLatencySeconds(-5)).toBe('0')
  })

  it('formats throughput with whole tokens from ten up and one decimal below', () => {
    expect(formatTokensPerSecond(34.4)).toBe('34')
    expect(formatTokensPerSecond(9.96)).toBe('10')
    expect(formatTokensPerSecond(3.14)).toBe('3.1')
    expect(formatTokensPerSecond(-1)).toBe('0')
  })
})
