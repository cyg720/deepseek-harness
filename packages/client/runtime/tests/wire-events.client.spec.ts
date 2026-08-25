/**
 * Wire-to-typed-event bridge: a `host/remote-event` frame is handed verbatim to
 * the Remote service's `$dispatch` (its fan-out to `ctx.remote.$on` is
 * api-gateway's own coverage); each established connection generation emits
 * `connection/reset` for generation-scoped cache invalidation.
 */
/*
 * 文件职责：验证客户端会话运行时的 wire-events 行为与边界。
 * 技术维度：Vitest、TypeScript、可控测试替身和真实模块组装。
 * 产品维度：防止用户可见行为在重构或扩展后发生回归。
 * 逻辑维度：构造场景输入，调用被测入口，记录状态并断言结果。
 * 关键边界：测试替身需在用例后清理；异步任务不能泄漏到后续场景。
 * 新手阅读建议：先读辅助函数和固定数据，再按 describe 场景顺序阅读。
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { ConnectionHandle, ConnectionSinks } from '@deepseek-ai/dsh-api-remotes/client'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
// Type-only: the api-remotes facade carries both the allowlist's selection seat
// and the owner packages' `./types` declarations, which together give `$on` its
// key face and per-event listener signatures.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import * as RuntimeClient from '../src/client/index.ts'
import { FakeApiClient, fakeRemote } from './fake-api.client.ts'

/**
 * Compile-time face of `ctx.remote.$on`, asserted by type-checking this file
 * rather than by running it: the allowlist narrows the key set, and each
 * listener's parameters come from the owner package's own cordis `Events`
 * declaration (so a brand cannot be flattened on the way to a consumer).
 * @param ctx - any client Context carrying the Remote service.
 */
/* 中文说明：函数 forwardedEventContracts 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
function forwardedEventContracts(ctx: Context): void {
  ctx.remote.$on('settings/document-updated', (namespace, source) => {
    // @ts-expect-error -- the brand survives the wire: a bare string is not a SettingsNamespace；中文说明：测试场景的局部值 bare，取值由紧邻初始化决定，仅在当前作用域使用。
    const bare: typeof namespace = 'plain-string'
    void bare; void namespace; void source
  })
  ctx.remote.$on('credentials/reference-updated', () => {})
  ctx.remote.$on('commands/change', () => {})
  ctx.remote.$on('llm/adapters-updated', () => {})
  ctx.remote.$on('agent-preset/selected', (sessionId, agentPreset) => {
    void sessionId; void agentPreset
  })
  // @ts-expect-error -- client-local event outside the allowlist
  ctx.remote.$on('slots/changed', () => {})
  // @ts-expect-error -- declared host event the allowlist does not select
  ctx.remote.$on('skills/change', () => {})
}
void forwardedEventContracts

/** 中文说明：类型 Bench 约束本文件数据字段及允许取值。 */
interface Bench {
  /** 中文说明：成员 ctx 保存可编排测试状态，取值由声明类型限定。 */
  ctx: Context
  /** 中文说明：成员 sinks 保存可编排测试状态，取值由声明类型限定。 */
  sinks: ConnectionSinks | undefined
  /** Every `$dispatch` the runtime made, as `[event, ...args]`. */
  /* 中文说明：成员 dispatched 保存可编排测试状态，取值由声明类型限定。 */
  dispatched: unknown[][]
}

/** 中文说明：函数 mount 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
async function mount(): Promise<Bench> {
  /** 中文说明：当前 Cordis 上下文 ctx，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const ctx = new Context()
  await ctx.plugin(TypertRegistry)
  /** 中文说明：当前服务或测试对象 api，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const api = new FakeApiClient()
  /** 中文说明：测试场景的局部值 bench，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const bench: Bench = { ctx, sinks: undefined, dispatched: [] }
  // Stands in for api-gateway's Remote service: this spec owns the carrier's
  // handoff, not the fan-out behind it.
  ctx.reflect.provide('remote', {
    $dispatch: (event: string, args: readonly unknown[]) => { bench.dispatched.push([event, ...args]) },
  })
  /** 中文说明：测试场景的局部值 handle，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const handle: ConnectionHandle = {
    api,
    isLoopback: true,
    hostDescription: {
      getSnapshot: () => undefined,
      subscribe: () => () => {},
    },
    rpc: {
      call: () => Promise.reject(new Error('unexpected generic RPC call')),
    },
    start: (sinks) => {
      bench.sinks = sinks
      return { stop: () => {} }
    },
  }
  ctx.reflect.provide('connection', handle)
  ctx.reflect.provide('remote.commands', fakeRemote().commands)
  await ctx.plugin(RuntimeClient).await()
  return bench
}

describe('wire event bridge', () => {
  it('republishes a forwarded host event verbatim, and routes no other host frame there', async () => {
    /** 中文说明：测试场景的局部值 bench，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const bench = await mount()
    /** 中文说明：按序保存的数据集合 seen，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const seen = bench.dispatched
    bench.sinks?.onHostEnvelope?.({
      rpcId: 'r1' as never,
      payload: { type: 'host/remote-event', event: 'commands/change', args: [] },
    })
    expect(seen).toEqual([['commands/change']])

    bench.sinks?.onHostEnvelope?.({
      rpcId: 'r2' as never,
      payload: { type: 'host/session-status', sessionId: 's1' as never, running: true },
    })
    expect(seen).toEqual([['commands/change']])
  })

  it('carries each forwarded event name with its own argument list, unfiltered', async () => {
    /** 中文说明：测试场景的局部值 bench，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const bench = await mount()
    /** 中文说明：按序保存的数据集合 seen，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const seen = bench.dispatched

    bench.sinks?.onHostEnvelope?.({
      rpcId: 'r3' as never,
      payload: { type: 'host/remote-event', event: 'settings/document-updated', args: ['llm-pi-ai', 7] },
    })
    bench.sinks?.onHostEnvelope?.({
      rpcId: 'r4' as never,
      payload: { type: 'host/remote-event', event: 'credentials/reference-updated', args: ['OPENAI_API_KEY'] },
    })
    // The carrier does not second-guess the name: selecting what a consumer can
    // receive is the allowlist's job, and dropping an unsubscribed name is the
    // Remote service's. This plugin republishes whatever the frame carried.
    bench.sinks?.onHostEnvelope?.({
      rpcId: 'r5' as never,
      payload: { type: 'host/remote-event', event: 'nobody/listening', args: ['ignored'] },
    })

    expect(seen).toEqual([
      ['settings/document-updated', 'llm-pi-ai', 7],
      ['credentials/reference-updated', 'OPENAI_API_KEY'],
      ['nobody/listening', 'ignored'],
    ])
  })

  it('broadcasts connection/reset on every established generation (reconnect invalidation)', async () => {
    /** 中文说明：测试场景的局部值 bench，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const bench = await mount()
    /** 中文说明：测试场景的局部值 resets，取值由紧邻初始化决定，仅在当前作用域使用。 */
    let resets = 0
    bench.ctx.on('connection/reset', () => { resets++ })
    /** 中文说明：测试场景的局部值 description，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const description = { version: '0', cwd: '/f', attachedSessions: 0, home: '/h', canOpenPath: true }
    bench.sinks?.onConnected?.(description)
    bench.sinks?.onConnected?.(description) // second generation after a reconnect
    expect(resets).toBe(2)
  })
})
