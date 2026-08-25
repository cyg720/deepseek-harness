/**
 * ui-commands browser half on a real cordis Context with fake slash/slots
 * faces and real session scopes: the plugin body mounts CommandUiRuntime as
 * `command`, the popupSelect shell registers into conversation.input.overlay
 * through slot declaration injection with a per-session inject (sessionId →
 * scope → popupFor; unknown id fails loud), both fold up on fiber disposal
 * (HMR safety), and the service satisfies the frozen CommandUiContract.
 */
/*
 * 文件职责：验证命令弹层的 browser-plugin.client.spec.ts 行为。
 * 技术维度：Vitest、React 测试渲染和可控替身。
 * 产品维度：防止命令弹层用户流程发生回归。
 * 逻辑维度：构造输入、触发交互并断言输出与清理。
 * 关键边界：全局替身和异步任务必须在用例后清理。
 * 新手阅读建议：先读辅助函数，再按测试场景顺序阅读。
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { createScope, scopeOf, SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { CommandUiContract } from '../src/client/contract.ts'
import type { PopupSelectInjected } from '../src/client/PopupSelectView.tsx'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, CommandUiRuntime, inject } from '../src/client/index.ts'

/** 中文说明：测试场景的局部值 sid，由紧邻初始化决定。 */
const sid = (k: string): SessionId => k as SessionId

/** 中文说明：函数 bench 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
async function bench() {
  /** 中文说明：测试场景的局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  /** 中文说明：测试场景的局部值 sources，由紧邻初始化决定。 */
  const sources = new Map<string, InputTriggerSource>()
  ctx.provide('inputTriggers', {
    registerSource(src: InputTriggerSource) {
      sources.set(`${src.trigger} ${src.name}`, src)
      return () => { sources.delete(`${src.trigger} ${src.name}`) }
    },
  })
  /** 中文说明：测试场景的局部值 scopes，由紧邻初始化决定。 */
  const scopes = new Map<SessionId, Context>()
  ctx.provide('sessions', {
    scope: (id: SessionId) => scopes.get(id),
    scopeOf: (c: Context) => scopeOf(c),
  })
  /** 中文说明：测试场景的局部值 commandsRemote，由紧邻初始化决定。 */
  const commandsRemote = { list: () => Promise.resolve([]) }
  // The service subscribes its cache-invalidation events on construction, so
  // the Remote face needs `$on` even where this spec dispatches none.
  ctx.provide('remote', { commands: commandsRemote, $on: () => () => {} })
  ctx.provide('remote.commands', commandsRemote)
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root', children: { 'conversation.input.overlay': { kind: 'list', scope: 'session' } },
  } as never, (() => null) as never)
  ctx.provide('locale', new LocaleRuntime(ctx))
  /** 中文说明：测试场景的局部值 fiber，由紧邻初始化决定。 */
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  /** 中文说明：测试场景的局部值 mint，由紧邻初始化决定。 */
  const mint = (key: string) => {
    /** 中文说明：测试场景的局部值 handle，由紧邻初始化决定。 */
    const handle = createScope(ctx, sid(key))
    scopes.set(sid(key), handle.ctx)
    return handle
  }
  return { ctx, fiber, sources, slots: ctx.slots, mint }
}

describe('apply', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['inputTriggers', 'sessions', 'remote', 'remote.commands', 'locale'])
  })

  it('mounts ctx.commandUi, registers the source and the overlay entry, and folds up on disposal', async () => {
    /** 中文说明：测试场景的局部值 解构结果，由紧邻初始化决定。 */
    const { ctx, fiber, sources, slots } = await bench()
    /** 中文说明：测试场景的局部值 command，由紧邻初始化决定。 */
    const command = ctx.get('commandUi')
    expect(command).toBeInstanceOf(CommandUiRuntime)
    // Frozen-contract conformance (compile-time check rides the assignment).
    /** 中文说明：测试场景的局部值 contract，由紧邻初始化决定。 */
    const contract: CommandUiContract = command as CommandUiRuntime
    expect(typeof contract.register).toBe('function')
    expect(typeof contract.popupFor).toBe('function')
    expect([...sources.keys()]).toEqual(['/ command'])
    expect(slots.entries('conversation.input.overlay').map(entry => entry.options.id)).toEqual(['command-popup'])
    await fiber.dispose()
    expect(sources.size).toBe(0)
    expect(slots.entries('conversation.input.overlay')).toHaveLength(0)
  })

  it('the overlay inject resolves the per-session popup controller by sessionId and fails loud on an unknown id', async () => {
    /** 中文说明：测试场景的局部值 { ctx, slots, mint }，由紧邻初始化决定。 */
    const { ctx, slots, mint } = await bench()
    /** 中文说明：测试场景的局部值 command，由紧邻初始化决定。 */
    const command = ctx.get('commandUi') as CommandUiRuntime
    /** 中文说明：测试场景的局部值 scope，由紧邻初始化决定。 */
    const scope = mint('s1')
    /** 中文说明：测试场景的局部值 entry，由紧邻初始化决定。 */
    const entry = slots.entries('conversation.input.overlay')[0]!
    /** 中文说明：测试场景的局部值 injectEntry，由紧邻初始化决定。 */
    const injectEntry = entry.inject as unknown as (sessionId: SessionId) => PopupSelectInjected
    expect(injectEntry(sid('s1')).popup).toBe(command.popupFor(scope.ctx))
    expect(() => injectEntry(sid('ghost'))).toThrow(/resolved no scope/)
  })
})
