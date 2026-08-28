// @vitest-environment jsdom
/**
 * 文件职责：验证目标进度的 goal-command-input.client.spec.tsx 行为。
 * 技术维度：Vitest、React 渲染、事件模拟和服务替身。
 * 产品维度：防止目标进度用户流程回归。
 * 逻辑维度：构造状态，触发行为并断言结果和清理。
 * 关键边界：异步任务、全局替身和 DOM 必须在用例后恢复。
 * 新手阅读建议：先读辅助函数，再按场景顺序阅读。
 */
import { cleanup, render, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { SessionLiveEventEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import type {
  ConversationNodeDefinition, ConversationViewDefinition,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ConversationNodeAssembler } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  ChatConversationViewNode, ChatSnapshot,
} from '@deepseek-ai/dsh-client-ui-chat/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { commandDefinition } from '@deepseek-ai/dsh-client-ui-chat/src/client/conversation-nodes/command.ts'
import { chatViewDefinition } from '@deepseek-ai/dsh-client-ui-chat/src/client/conversation-nodes/chat-snapshot-builder.ts'
import { GoalCommandInputView } from '../src/client/GoalCommandInputView.tsx'
import {
  goalCommandInputDefinition, goalCommandText,
} from '../src/client/goal-command-input.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

/** 中文说明：类型或类 TestEventDefinitions 约束本文件数据或组件职责。 */
class TestEventDefinitions {
  entries(): readonly ConversationNodeDefinition[] {
    return [commandDefinition, goalCommandInputDefinition]
  }

  fallbackEntry(): undefined {
    return undefined
  }
}

/** 中文说明：类型或类 TestViewDefinitions 约束本文件数据或组件职责。 */
class TestViewDefinitions {
  entries(): readonly ConversationViewDefinition[] {
    return [chatViewDefinition]
  }
}

function entry(seq: number, type: string, data: unknown): SessionLiveEventEntry {
  return {
    type: 'event',
    event: { seq, time: 1_700_000_000_000 + seq, type, data } as SessionEvent,
  }
}

function snapshot(entries: readonly SessionLiveEventEntry[], hasMore = false): ChatSnapshot {
  const assembler = new ConversationNodeAssembler(new TestEventDefinitions(), new TestViewDefinitions())
  assembler.replaceWindow(entries, hasMore)
  assembler.flush()
  /** 中文说明：测试局部值 value，由紧邻初始化决定。 */
  const value = assembler.snapshot('chat') as ChatSnapshot | undefined
  if (value === undefined) throw new Error('chat view was not registered')
  return value
}

/** 中文说明：函数 node 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function node(value: ChatSnapshot, kind: string): ChatConversationViewNode | undefined {
  return value.nodes.values().find(candidate => candidate.kind === kind)
}

describe('goal command input projection', () => {
  it('builds a separate input Node before the generic command result and restores it on replay', () => {
    /** 中文说明：测试局部值 run，由紧邻初始化决定。 */
    const run = entry(1, 'command/run', {
      commandId: 'command-goal', name: 'goal', args: ' ', source: { kind: 'user' },
    })
    /** 中文说明：测试局部值 done，由紧邻初始化决定。 */
    const done = entry(2, 'command/done', {
      commandId: 'command-goal', kind: 'success', text: 'No goal is currently set.',
    })
    /** 中文说明：测试局部值 value，由紧邻初始化决定。 */
    const value = snapshot([run, done])

    expect(value.order.map(key => value.nodes.get(key)?.kind)).toEqual(['command-input', 'command'])
    expect(node(value, 'command-input')).toMatchObject({
      anchorSeq: 0.9,
      data: { commandId: 'command-goal', text: '/goal' },
    })
    expect(node(value, 'command')?.data).toMatchObject({
      name: 'goal', args: ' ', outcome: { kind: 'success', text: 'No goal is currently set.' },
    })

    /** 中文说明：测试局部值 doneOnly，由紧邻初始化决定。 */
    const doneOnly = snapshot([done], true)
    expect(node(doneOnly, 'command-input')).toBeUndefined()
    expect(node(doneOnly, 'command')?.data).toMatchObject({ name: null, args: null })
  })

  it('ignores other commands and preserves internal multiline arguments', () => {
    /** 中文说明：测试局部值 plan，由紧邻初始化决定。 */
    const plan = entry(1, 'command/run', {
      commandId: 'command-plan', name: 'plan', args: '', source: { kind: 'user' },
    })
    /** 中文说明：测试局部值 goal，由紧邻初始化决定。 */
    const goal = entry(2, 'command/run', {
      commandId: 'command-goal', name: 'goal', args: '\nfirst line\nsecond line \n', source: { kind: 'user' },
    })

    expect(goalCommandInputDefinition.match(plan.event)).toBeNull()
    expect(goalCommandText(goal.event as SessionEvent<'command/run'>))
      .toBe('/goal\nfirst line\nsecond line')
  })

  it('keeps the Definition total across required interface and window fallback paths', () => {
    /** 中文说明：测试局部值 run，由紧邻初始化决定。 */
    const run = entry(3, 'command/run', {
      commandId: 'command-goal', name: 'goal', source: { kind: 'user' },
    })
    /** 中文说明：测试局部值 match，由紧邻初始化决定。 */
    const match = {
      ...run,
      role: 'start' as const,
      location: { kind: 'session' as const },
    }
    /** 中文说明：测试局部值 state，由紧邻初始化决定。 */
    const state = goalCommandInputDefinition.start({} as never, match, {} as never)

    expect(state.text).toBe('/goal')
    expect(goalCommandInputDefinition.update({ state } as never, match)).toBe(state)
    expect(goalCommandInputDefinition.buildViewNode!({ state: undefined } as never)).toBeNull()
    expect(goalCommandInputDefinition.buildViewNode!({
      key: 'goal-command-input', id: 'command-goal', state, start: undefined,
    } as never)).toMatchObject({ location: { kind: 'unresolved' } })

    /** 中文说明：测试局部值 done，由紧邻初始化决定。 */
    const done = entry(4, 'command/done', { commandId: 'command-goal', kind: 'success' })
    expect(() => goalCommandInputDefinition.start({} as never, {
      ...done, role: 'start', location: { kind: 'session' },
    } as never, {} as never)).toThrow('goal-command-input start requires command/run')
  })

  it('renders the user-style command bubble without ordinary message actions', () => {
    /** 中文说明：测试局部值 t，由紧邻初始化决定。 */
    const t = makeTranslate(zh, commonZh)
    /** 中文说明：测试局部值 props，由紧邻初始化决定。 */
    const props = {
      node: {
        key: 'goal-command-input:one',
        data: { commandId: 'command-goal', text: '/goal ship it', time: 1_700_000_000_000 },
      },
      t,
    } as unknown as Parameters<typeof GoalCommandInputView>[0]
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<GoalCommandInputView {...props} />)
    const bubble = view.getByRole('group', { name: '指令输入' })

    expect(bubble.textContent).toBe('/goal ship it')
    expect(within(bubble).queryByRole('button')).toBeNull()
  })
})
