/**
 * Runtime plugin browser-half apply: slots + object services mounting over the
 * connection handle, stream-loop sink wiring into the object layer, and the
 * fiber-scoped loop teardown.
 */
/*
 * 文件职责：验证客户端运行时插件装载后提供会话服务、连接依赖和销毁行为。
 * 技术维度：Cordis 测试 Context、Vitest、连接 API 替身和响应式服务。
 * 产品维度：保证浏览器运行时入口能够稳定向界面暴露会话管理能力。
 * 逻辑维度：装载依赖和运行时插件，读取服务，驱动最小操作，再断言状态与清理。
 * 关键边界：测试必须使用真实插件组装关系；销毁后不得遗留订阅或网络调用。
 * 新手阅读建议：先看装载辅助函数，再按服务可用性、依赖变化和卸载场景阅读。
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import type { ConnectionSinks } from '@deepseek-ai/dsh-api-remotes/client'
import { SESSION_SEARCH_RESULT_LIMIT } from '@deepseek-ai/dsh-host-apiproxy/api'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import * as RuntimeClient from '../src/client/index.ts'
import type { ConversationNodeDefinition } from '../src/client/contract/conversation.ts'
import { Session } from '../src/client/sessions/session.ts'
import type { SessionRuntime } from '../src/client/sessions/service.ts'
import type { WorkspaceRuntime } from '../src/client/workspaces/service.ts'
import { FakeApiClient, fakeRemote, ok } from './fake-api.client.ts'

/** 中文说明：类型 `Bench` 约束本文件使用的数据字段和取值范围，避免调用方传入不完整状态。 */
interface Bench {
  ctx: Context
  api: FakeApiClient
  sinks: ConnectionSinks | undefined
  stopped: number
}

/** 中文说明：测试辅助函数 `mount`；参数含义见签名，返回值用于驱动或断言场景；例如按本文件中的调用位置使用。 */
async function mount(): Promise<Bench> {
  /** 中文说明：当前操作所属的 Cordis 上下文；变量 `ctx` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  const ctx = new Context()
  await ctx.plugin(TypertRegistry)
  /** 中文说明：当前流程调用的客户端服务或测试替身；变量 `api` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  const api = new FakeApiClient()
  /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `bench` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  const bench: Bench = { ctx, api, sinks: undefined, stopped: 0 }
  /** 中文说明：当前流程调用的客户端服务或测试替身；变量 `handle` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
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
      return { stop: () => { bench.stopped += 1 } }
    },
  }
  ctx.reflect.provide('connection', handle)
  ctx.reflect.provide('remote', {})
  ctx.reflect.provide('remote.commands', fakeRemote().commands)
  await ctx.plugin(RuntimeClient).await()
  return bench
}

/** 中文说明：测试辅助函数 `flushMicrotasks`；参数含义见签名，返回值用于驱动或断言场景；例如按本文件中的调用位置使用。 */
async function flushMicrotasks(): Promise<void> {
  /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `i` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  for (let i = 0; i < 12; i++) await Promise.resolve()
}

describe('runtime client apply', () => {
  it('mounts slots, Sessions, and Workspaces and fans host frames into both managers', async () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `bench` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const bench = await mount()
    expect(bench.ctx.get('slots') !== undefined).toBe(true)
    // The built-in 'root' declaration ships with this package's SlotRegistry
    // (the SlotMap 'root' merge lives here).
    expect(bench.ctx.slots.spec('root')).toEqual({ kind: 'single', scope: 'root' })
    /** 中文说明：当前会话或对话投影对象；变量 `sessions` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const sessions = bench.ctx.get('sessions')
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `workspaces` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const workspaces = bench.ctx.get('workspaces')
    expect(sessions !== undefined).toBe(true)
    expect(workspaces !== undefined).toBe(true)
    // The bound the wire schema enforces, not a per-connection negotiation.
    expect((sessions as SessionRuntime).searchResultLimit).toBe(SESSION_SEARCH_RESULT_LIMIT)
    if (workspaces === undefined) throw new Error('WorkspaceRuntime missing after runtime apply')
    expect(bench.sinks).toBeDefined()

    // Frame sinks reach the object layer: a host session-added lands in the list store.
    bench.sinks?.onHostEnvelope?.({
      rpcId: 'r1' as never,
      payload: { type: 'host/session-added', blank: true, sessionId: 's-new' } as never,
    })
    await Promise.resolve()
    expect((sessions as { list: { getSnapshot(): { ids: string[] } } }).list.getSnapshot().ids).toContain('s-new')
    bench.sinks?.onHostEnvelope?.({
      rpcId: 'r-workspace' as never,
      payload: {
        type: 'host/workspace-changed',
        workspace: {
          workspaceId: 'w-new', path: '/w/new', title: 'new', sessionIds: [],
          createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
        },
      } as never,
    })
    await Promise.resolve()
    expect(workspaces.list.getSnapshot().items[0]?.workspaceId).toBe('w-new')
    // Mux sink and onConnected route without throwing (manager semantics own the behavior).
    bench.sinks?.onMuxEnvelope?.({ rpcId: 'r2' as never, payload: { type: 'stream/error', message: 'x' } as never })
    bench.sinks?.onConnected?.({ version: '0', cwd: '/f', attachedSessions: 0, home: '/h', canOpenPath: true })
  })

  it('selects the recent Workspace once when the first baselines have no current session', async () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `bench` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const bench = await mount()
    bench.api.onWorkspaceList = () => Promise.resolve(ok({
      items: [{
        workspaceId: 'w-recent', path: '/w/recent', title: 'recent', sessionIds: [],
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      }] as never[],
    }))
    bench.api.onList = () => Promise.resolve(ok({ items: [] }))

    bench.sinks?.onConnected?.({ version: '0', cwd: '/f', attachedSessions: 0, home: '/h', canOpenPath: true })
    await flushMicrotasks()

    /** 中文说明：当前会话或对话投影对象；变量 `sessions` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const sessions = bench.ctx.get('sessions') as SessionRuntime
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `workspaces` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const workspaces = bench.ctx.get('workspaces') as WorkspaceRuntime
    expect(bench.api.callsOf('session.create')).toEqual([{ workspaceId: 'w-recent' }])
    expect(sessions.list.getSnapshot().current).toBe('fk-new')

    sessions.clear()
    await workspaces.refresh()
    await flushMicrotasks()
    expect(sessions.list.getSnapshot().current).toBeUndefined()
    expect(bench.api.callsOf('session.create')).toHaveLength(1)
  })

  it('wires registry changes into resident Sessions during the runtime apply pass', async () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `bench` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const bench = await mount()
    /** 中文说明：当前会话或对话投影对象；变量 `sessions` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const sessions = bench.ctx.get('sessions') as SessionRuntime
    bench.sinks?.onHostEnvelope?.({
      rpcId: 'r-registry' as never,
      payload: { type: 'host/session-added', blank: true, sessionId: 's-registry' } as never,
    })
    await flushMicrotasks()
    expect(sessions.binding('s-registry' as never)).toBeDefined()
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `rebuild` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const rebuild = vi.spyOn(Session.prototype, 'rebuildConversationRegistry')
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `definition` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const definition: ConversationNodeDefinition<null> = {
      kind: 'registry-probe',
      target: 'chat',
      match: () => null,
      start: () => null,
      update: context => context.state,
      buildViewNode: () => null,
    }

    bench.ctx.conversationEvents.register(definition)
    await flushMicrotasks()

    expect(rebuild).toHaveBeenCalledOnce()
    rebuild.mockRestore()
  })

  it('stops the stream loop when the plugin fiber unloads', async () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `bench` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const bench = await mount()
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `fiber` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
    const fiber = [...bench.ctx.registry.values()].find(f => f.name?.includes('client'))
    // Dispose the whole tree: the ctx.effect teardown must call loop.stop exactly once.
    await bench.ctx.fiber.dispose()
    expect(bench.stopped).toBe(1)
    void fiber
  })
})
