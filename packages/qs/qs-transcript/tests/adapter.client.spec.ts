import { describe, expect, it } from 'vitest'
import {
  assistantLines, assistantStatusKey, contentText, messageContent, rowKeyOf, visibleNode,
} from '../src/client/adapter.ts'

describe('行 kind 分派', () => {
  it('自绘 kind 命中本体，其余走兜底', () => {
    expect(rowKeyOf('user')).toBe('user')
    expect(rowKeyOf('assistant-step')).toBe('assistant-step')
    expect(rowKeyOf('steering')).toBe('steering')
    expect(rowKeyOf('tool-call')).toBe('unknown')
    expect(rowKeyOf('未注册的 kind')).toBe('unknown')
  })
})

describe('节点与负载映射', () => {
  it('hidden 行不渲染', () => {
    expect(visibleNode(undefined)).toBeUndefined()
    expect(visibleNode({ visibility: 'hidden' } as never)).toBeUndefined()
    expect(visibleNode({ visibility: 'visible' } as never)).toBeDefined()
  })

  it('用户节点的内容块在负载的 content 字段里（真实消息结构）', () => {
    // 官方负载是消息对象：{ kind, seq, time, content, source }。断言成数组会在
    // 运行期让它去遍历一个对象并抛 "blocks is not iterable"。
    const node = {
      kind: 'user',
      data: { kind: 'user', seq: 1, time: 0, content: [{ type: 'text', text: '你好' }], source: {} },
    } as never
    expect(messageContent(node)).toEqual([{ type: 'text', text: '你好' }])
    expect(contentText(messageContent(node) ?? [])).toBe('你好')
  })

  it('负载缺少 content 时返回 undefined 而不是抛错', () => {
    expect(messageContent({ kind: 'user', data: {} } as never)).toBeUndefined()
    expect(messageContent({ kind: 'assistant-step', data: {} } as never)).toBeUndefined()
  })

  it('只取字符串 text 成员，其它内容块忽略', () => {
    expect(contentText([{ type: 'text', text: '甲' }, { type: 'image' }, { text: '乙' }])).toBe('甲\n\n乙')
    expect(contentText([{ text: 42 }])).toBe('')
  })

  it('助手块拆成文本与推理两类', () => {
    const lines = assistantLines({
      status: 'running',
      blocks: [{ kind: 'reasoning', text: '先看' }, { kind: 'text', text: '结论' }, { kind: 'tool-call' }],
    } as never)
    expect(lines).toEqual([{ kind: 'reasoning', text: '先看' }, { kind: 'text', text: '结论' }])
  })

  it('生成中 / 完成 / 中断三态可辨', () => {
    expect(assistantStatusKey({ status: 'running' } as never)).toBe('row.running')
    expect(assistantStatusKey({ status: 'settled' } as never)).toBe('row.settled')
    expect(assistantStatusKey({ status: 'interrupted' } as never)).toBe('row.interrupted')
  })
})
