/**
 * apply wiring on a real cordis Context + SlotRegistry: QuestionComposer
 * registered as the `question` entry of the conversation-declared composer
 * slot with ZERO business face (data and verbs ride the dispatched carrier),
 * declaration-aware activation, and fiber-teardown unregistration. Component and
 * domain-face behavior is covered props-direct in question-composer.spec.tsx;
 * no renderer machinery here.
 */
/**
 * 文件职责：验证用户提问与计划复审的 browser-plugin.client.spec.ts 行为。
 * 技术维度：Vitest、React 渲染、虚拟列表和服务替身。
 * 产品维度：防止用户提问与计划复审展示与操作流程回归。
 * 逻辑维度：构造状态，触发交互并断言输出和清理。
 * 关键边界：计时器、观察器、DOM 尺寸和异步请求必须恢复。
 * 新手阅读建议：先读夹具，再按加载、交互和异常场景阅读。
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { QuestionComposer } from '../src/client/QuestionComposer.tsx'
import { apply, inject } from '../src/client/index.ts'

/** 中文说明：函数 bench 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function bench() {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  /** 中文说明：测试局部值 slots，由紧邻初始化决定。 */
  const slots = ctx.get('slots') as SlotRegistry
  // The composer slot exists only while its declaring entry is live.
  slots.register(
    { name: 'root', children: { 'conversation.composer': { kind: 'chain', scope: 'session' } } } as never,
    () => null,
  )
  ctx.provide('locale', new LocaleRuntime(ctx))
  return { ctx, slots }
}

describe('apply', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['slots', 'locale'])
  })

  it('waits until a live entry declares the composer slot', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('locale', new LocaleRuntime(ctx))
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(ctx.slots.entries('conversation.composer')).toHaveLength(0)
    ctx.slots.register(
      { name: 'root', children: { 'conversation.composer': { kind: 'chain', scope: 'session' } } } as never,
      () => null,
    )
    await Promise.resolve()
    expect(ctx.slots.entries('conversation.composer')).toHaveLength(1)
  })

  it('registers the question entry: routing selector, no inject face', async () => {
    /** 中文说明：测试局部值 { ctx, slots }，由紧邻初始化决定。 */
    const { ctx, slots } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()
    /** 中文说明：测试局部值 entry，由紧邻初始化决定。 */
    const entry = slots.entries('conversation.composer')[0]!
    expect(entry.component).toBe(QuestionComposer)
    // The whole behavior surface rides the matched carrier: no business face;
    // copy rides the standard locale seat.
    expect(entry.inject).toBeUndefined()
    expect(entry.locale).toBe('question')
    // The selector narrows the chain currency: question wait in → that wait; none → null.
    /** 中文说明：测试局部值 select，由紧邻初始化决定。 */
    const select = entry.select as (owner: { interactions: readonly { kind: string }[] }) => unknown
    /** 中文说明：测试局部值 question，由紧邻初始化决定。 */
    const question = { kind: 'question' }
    expect(select({ interactions: [{ kind: 'approval' }, question] })).toBe(question)
    expect(select({ interactions: [{ kind: 'approval' }] })).toBeNull()
    expect(select({ interactions: [] })).toBeNull()
  })

  it('teardown unregisters the slot entry', async () => {
    /** 中文说明：测试局部值 { ctx, slots }，由紧邻初始化决定。 */
    const { ctx, slots } = await bench()
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(slots.entries('conversation.composer')).toHaveLength(1)
    await fiber.dispose()
    expect(slots.entries('conversation.composer')).toHaveLength(0)
  })
})
