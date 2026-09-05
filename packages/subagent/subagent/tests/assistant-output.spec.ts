/**
 * 文件职责：验证 assistant-output.spec.ts 覆盖的子代理启动、协议、继承与生命周期行为。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、进程协议或同进程代理驱动。
 * 产品维度：保障 Agent 能可靠委派任务、继承上下文并收集子代理结果。
 * 逻辑维度：准备代理配置，启动或连接子代理，转发事件，再处理结果、取消与清理。
 * 关键边界：异步状态不等于单次任务结果；外部输出不可信；清理必须等待子代理完全停止。
 * 新手阅读建议：先看公开配置和测试夹具，再读启动/事件流程，最后关注继承、取消与失败路径。
 */
import { describe, expect, it } from 'vitest'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { AssistantOutputFold, finalAssistantOutput } from '../src/assistant-output.ts'

/** 中文说明：函数 message 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function message(content: ContentBlock[]): SessionEvent {
  return { type: 'assistant/message', data: { stream: [], message: { content } } } as SessionEvent
}

/** 中文说明：函数 textDelta 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function textDelta(text: string): SessionEvent {
  return {
    type: 'assistant/attempt',
    data: { stream: [{ type: 'text-chunks', time0: 0, index: 0, dt: [], texts: [text] }] },
  } as SessionEvent
}

/** 中文说明：函数 reasoningDelta 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function reasoningDelta(text: string): SessionEvent {
  return {
    type: 'assistant/attempt',
    data: { stream: [{ type: 'reasoning-chunks', time0: 0, index: 0, dt: [], texts: [text] }] },
  } as SessionEvent
}

/** 中文说明：函数 toolResult 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function toolResult(text: string): SessionEvent {
  return {
    type: 'tool/result',
    data: {
      message: {
        content: [{
          type: 'tool-result',
          toolCallId: 'call-1',
          content: [{ type: 'text', text }],
          isError: false,
        }],
      },
    },
  } as SessionEvent
}

describe('finalAssistantOutput', () => {
  it('selects the last non-empty message past a later empty usage-only message', () => {
    /** 中文说明：变量 events 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const events = [
      message([{ type: 'text', text: 'step one' }]),
      message([{ type: 'text', text: 'step two' }]),
      message([]),
    ]
    expect(finalAssistantOutput(events)).toEqual([{ type: 'text', text: 'step two' }])
  })

  it('prefers a non-empty message over text streamed before and after it', () => {
    /** 中文说明：变量 events 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const events = [
      textDelta('earlier partial'),
      message([{ type: 'text', text: 'complete answer' }]),
      textDelta('later partial'),
      message([]),
    ]
    expect(finalAssistantOutput(events)).toEqual([{ type: 'text', text: 'complete answer' }])
  })

  it('treats textless assistant content as a non-empty message', () => {
    /** 中文说明：变量 content 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const content: ContentBlock[] = [{ type: 'reasoning', text: 'complete reasoning' }]
    expect(finalAssistantOutput([
      textDelta('streamed text'),
      message(content),
      textDelta('later partial'),
    ])).toEqual(content)
  })

  it('falls back to text deltas without including reasoning or tool-result content', () => {
    /** 中文说明：变量 events 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const events = [
      reasoningDelta('thinking'),
      textDelta('partial '),
      toolResult('tool output'),
      textDelta('answer'),
      message([]),
    ]
    expect(finalAssistantOutput(events)).toEqual([{ type: 'text', text: 'partial answer' }])
  })

  it('returns undefined when the child produced neither messages nor text', () => {
    expect(finalAssistantOutput([])).toBeUndefined()
    expect(finalAssistantOutput([reasoningDelta('thinking'), message([])])).toBeUndefined()
  })
})

describe('AssistantOutputFold', () => {
  it('folds raw text pieces into the same streamed fallback (ACP chunk transport)', () => {
    /** 中文说明：变量 fold 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fold = new AssistantOutputFold()
    fold.pushText('partial ')
    fold.pushText('')
    fold.pushText('answer')
    expect(fold.collect()).toEqual([{ type: 'text', text: 'partial answer' }])
  })

  it('collects undefined until any output is folded', () => {
    expect(new AssistantOutputFold().collect()).toBeUndefined()
  })
})
