/**
 * Renderer invariant companion: the 'slots/changed' emission-order audit —
 * a fired key must already carry a bumped version (emission follows the
 * applied mutation), bogus payloads fail loud, foreign events pass.
 */
/*
 * 文件职责：验证插槽变更事件只能在对应插槽版本完成递增后发出。
 * 技术维度：使用 Vitest、Cordis 插件上下文和真实 SlotRegistry 检查事件顺序。
 * 产品维度：避免界面监听方收到尚未应用的插槽状态，从而减少渲染不同步问题。
 * 逻辑维度：安装不变量检查器，模拟普通事件、真实注册、非法键和手工提前发射事件。
 * 关键边界：未挂载插槽服务时没有权威状态可审计，因此变更事件保持静默通过。
 * 新手阅读建议：先理解 setup 与 emit 的测试封装，再对比真实 register 和手工 emit 的差别。
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as RendererInvariant from '../src/invariant.ts'
import { SlotRegistry } from '../src/client/registry.ts'

/**
 * 创建只安装不变量服务和运行时检查器的测试上下文。
 * @returns 已等待插件激活的 Cordis 上下文。
 * @example `const ctx = await setup()`
 */
async function setup(): Promise<Context> {
  /** 当前测试独占的 Cordis 上下文。 */
  const ctx = new Context()
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(RendererInvariant).await()
  return ctx
}

/**
 * 绕过测试编译期事件映射并发出任意事件，用于构造边界输入。
 * @param ctx 接收事件的 Cordis 上下文。
 * @param event 事件名称。
 * @param args 事件参数列表。
 * @returns 无返回值。
 * @example `emit(ctx, 'slots/changed', 'root')`
 */
const emit = (ctx: Context, event: string, ...args: unknown[]): void => {
  Reflect.apply(ctx.emit.bind(ctx), undefined, [event, ...args])
}

describe('renderer slots/changed invariant', () => {
  it('passes foreign events and a legitimate mutation-then-emission sequence', async () => {
    /** 用于验证合法事件顺序的测试上下文。 */
    const ctx = await setup()
    expect(() => { emit(ctx, 'unrelated/event', 'x') }).not.toThrow()
    await ctx.plugin(SlotRegistry).await() // fiber must reach ACTIVE — the audit reads strict ctx.get
    // 插槽插件必须进入 ACTIVE，检查器随后会通过严格 ctx.get 读取服务。
    // A real registration bumps the version first and re-emits through
    // onMutate — the audit sees version > 0 and stays quiet. (Erased call:
    // the typed register face rides the wave-1 ui-slots types.)
    // 真实注册会先递增版本再由 onMutate 发射事件；类型擦除用于跨越第一阶段的 ui-slots 类型接口。
    /** 已激活的插槽服务，以最小结构类型暴露 register 供本测试调用。 */
    const slots = ctx.slots as unknown as { register(options: object, component: unknown): () => void }
    expect(() => slots.register({ name: 'root' }, () => null)).not.toThrow()
  })

  it('fails loud on a missing key and on an emission with no applied mutation', async () => {
    /** 用于验证非法键和提前发射事件的测试上下文。 */
    const ctx = await setup()
    expect(() => { emit(ctx, 'slots/changed', '') }).toThrow(/without a slot key/)
    expect(() => { emit(ctx, 'slots/changed', 42) }).toThrow(/without a slot key/)
    await ctx.plugin(SlotRegistry).await()
    // Hand-emitted key that never saw a mutation: version 0 → violation.
    // 手工发射的键从未发生变更，版本仍为零，必须报告违规。
    expect(() => { emit(ctx, 'slots/changed', 'never-mutated') })
      .toThrow(/before any mutation bumped its version/)
  })

  it('stays quiet when no slots service is mounted (nothing to audit against)', async () => {
    /** 未安装插槽服务、因此没有权威状态可比较的测试上下文。 */
    const ctx = await setup()
    expect(() => { emit(ctx, 'slots/changed', 'any-key') }).not.toThrow()
  })
})
