// View-ring type-chain samples. This spec pins the conversation-owned SlotMap
// row, list-kind registration shape, composed view props, and the runtime
// ledger projection consumed by ConversationRoot.
/**
 * 文件职责：验证会话输入的 views-type-chain.client.spec.tsx 行为。
 * 技术维度：Vitest、React 渲染、事件模拟和服务替身。
 * 产品维度：防止会话输入用户流程回归。
 * 逻辑维度：构造状态，触发行为并断言结果和清理。
 * 关键边界：异步任务、全局替身和 DOM 必须在用例后恢复。
 * 新手阅读建议：先读辅助函数，再按场景顺序阅读。
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { ReactNode } from 'react'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatViewSlotProps, ConvViewProps } from '../src/client/contract/slots.ts'

describe('view-ring type negatives (compile-time; body never runs)', () => {
  it('holds the negative samples as expect-error sites', () => {
    /** 中文说明：测试局部值 negatives，由紧邻初始化决定。 */
    const negatives = (slots: SlotRegistry) => {
      // 1. List-kind registration requires the id shape field.
      // @ts-expect-error missing `id` on a list-slot registration
      slots.register({ name: 'conversation.view', order: 1 }, (_p: ConvViewProps) => null)
      // 2. A keyed-kind shape field is rejected on the list slot.
      slots.register(
        // @ts-expect-error `key` belongs to keyed slots, not the list ring
        { name: 'conversation.view', id: 'x', key: 'k' },
        (_p: ConvViewProps) => null)
      // 3. Component props must stay within the composed contract: an
      //    undeclared member cannot be required.
      // @ts-expect-error component demands a prop no share supplies
      slots.register(
        { name: 'conversation.view', id: 'y' },
        (_p: ConvViewProps & { phantom: number }) => null)
      // 4. Views receive no renderSlot — the ring's entries declare no children.
      /** 中文说明：测试局部值 renderless，由紧邻初始化决定。 */
      const renderless = (props: ConvViewProps): ReactNode => {
        // @ts-expect-error views receive no renderSlot — no sub-slot delegation
        void props.renderSlot
        return null
      }
      void renderless
      // 5. The chat entry's face is its own: openDetails does not exist on the
      //    base view props (store-less riders never see it).
      /** 中文说明：测试局部值 baseOnly，由紧邻初始化决定。 */
      const baseOnly = (props: ConvViewProps): ReactNode => {
        // @ts-expect-error openDetails lives on ChatViewSlotProps, not the base
        void props.openDetails
        return null
      }
      void baseOnly
      // 6. ChatViewSlotProps carries the full composition (standard kit +
      //    store + inject face) — a handler with a wrong signature is red.
      /** 中文说明：测试局部值 chatProps，由紧邻初始化决定。 */
      const chatProps = (props: ChatViewSlotProps): ReactNode => {
        // @ts-expect-error openDetails takes a SelectionTarget, not a string
        props.openDetails('nope')
        // @ts-expect-error openFile takes a path string, not a SelectionTarget
        void props.openFile({ turnSeq: 1, callId: 'c' })
        return null
      }
      void chatProps
      return null as ReactNode
    }
    expect(negatives).toBeTypeOf('function')
  })
})

describe('view-ring runtime dual (real ledger)', () => {
  /** 中文说明：函数 bench 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
  function bench() {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    /** 中文说明：测试局部值 slots，由紧邻初始化决定。 */
    const slots = new SlotRegistry(ctx)
    // The conversation entry's role: declare the ring (declaring is claiming).
    slots.register({
      name: 'root',
      children: { 'conversation.view': { kind: 'list', scope: 'session' } },
    }, (_p: { renderSlot?: unknown }) => null)
    return { slots }
  }

  it('registers, orders, projects tabs, and disposes through the slot ledger', () => {
    /** 中文说明：测试局部值 { slots }，由紧邻初始化决定。 */
    const { slots } = bench()
    /** 中文说明：测试局部值 offLate，由紧邻初始化决定。 */
    const offLate = slots.register(
      { name: 'conversation.view', id: 'z-late', order: 20, label: '晚' }, () => null)
    /** 中文说明：测试局部值 offEarly，由紧邻初始化决定。 */
    const offEarly = slots.register(
      { name: 'conversation.view', id: 'early', order: 0, label: '早' }, () => null)
    // Order-sorted ledger, label fallback for a labelless rider.
    /** 中文说明：测试局部值 offBare，由紧邻初始化决定。 */
    const offBare = slots.register(
      { name: 'conversation.view', id: 'bare', order: 10 }, () => null)
    /** 中文说明：测试局部值 tabs，由紧邻初始化决定。 */
    const tabs = slots.entries('conversation.view')
      .map(e => ({ id: e.options.id, label: e.options.label ?? e.options.id }))
    expect(tabs).toEqual([
      { id: 'early', label: '早' },
      { id: 'bare', label: 'bare' },
      { id: 'z-late', label: '晚' },
    ])
    // Duplicate ids fail loud at load (the ring's uniqueness contract).
    expect(() => slots.register({ name: 'conversation.view', id: 'early' }, () => null))
      .toThrow(/already has an entry with id "early"/)
    offEarly()
    expect(slots.entries('conversation.view').map(e => e.options.id)).toEqual(['bare', 'z-late'])
    offBare()
    offLate()
    expect(slots.entries('conversation.view')).toHaveLength(0)
  })
})
