/**
 * 文件职责：验证 client/ui-session 中 ui session client spec 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { Context } from '@deepseek-ai/cordis'
import type {
  AgentContext,
  ISessions,
  SessionBinding,
  SessionListState,
  SessionSnapshot,
} from '@deepseek-ai/dsh-api-session-controller/client'
import { MutableSessionEventSource } from '@deepseek-ai/dsh-api-session-controller/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { Fragment } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  apply,
  type SessionPendingInteractionBase,
  UiSession,
} from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'

interface SessionsBench {
  readonly sessions: ISessions
  readonly list: ReturnType<typeof createSnapshotStore<SessionListState>>
  readonly resolveBinding: ReturnType<typeof vi.fn<(id: SessionId) => SessionBinding | undefined>>
  readonly createSession: ReturnType<typeof vi.fn<ISessions['create']>>
  readonly openSession: ReturnType<typeof vi.fn<(id: SessionId) => void>>
  readonly clearSession: ReturnType<typeof vi.fn<() => void>>
  /**
   * 功能说明：处理 binding 相关流程；使用场景由所在模块及调用位置决定。
   * @param id （SessionId）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。
   * @returns SessionBinding；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 binding(id)，并按返回类型处理结果。
   */
  binding(id: SessionId): SessionBinding
  /**
   * 功能说明：处理 select 相关流程；使用场景由所在模块及调用位置决定。
   * @param id （SessionId | undefined）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 select(id)，并按返回类型处理结果。
   */
  select(id: SessionId | undefined): void
  /**
   * 功能说明：处理 release 相关流程；使用场景由所在模块及调用位置决定。
   * @param id （SessionId）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。
   * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 release(id)，并按返回类型处理结果。
   */
  release(id: SessionId): Promise<void>
}

/**
 * 常量说明：sessionId 用于处理 sessionId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 sessionId 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns SessionId；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 sessionId(value)，并按返回类型处理结果。
 */
const sessionId = (value: string): SessionId => value as SessionId

/**
 * 功能说明：创建 Sessions Bench 相关流程；使用场景由所在模块及调用位置决定。
 * @param _ctx （Context）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns SessionsBench；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 createSessionsBench(_ctx)，并按返回类型处理结果。
 */
function createSessionsBench(_ctx: Context): SessionsBench {
  /**
   * 常量说明：list 用于列出 list 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const list = createSnapshotStore<SessionListState>({
    ids: [],
    byId: {},
    current: undefined,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  })
  /**
   * 常量说明：bindings 用于处理 bindings 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const bindings = new Map<SessionId, SessionBinding>()
  /**
   * 常量说明：scopes 用于处理 scopes 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const scopes = new Map<SessionId, Context>()
  /**
   * 常量说明：resolveBinding 用于解析 Binding 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：id（SessionId）：标识本次操作关联的唯一对象；
   * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调(id)，并按返回类型处理结果。
   */
  const resolveBinding = vi.fn((id: SessionId) => bindings.get(id))
  /**
   * 常量说明：createSession 用于创建 Session 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：options（由 TypeScript
   * 根据调用位置推断的类型）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(options)，并按返回类型处理结果。
   */
  const createSession = vi.fn<ISessions['create']>(async options =>
    options?.sessionId ?? sessionId(`created-${String(options?.workspaceId ?? 'none')}`))
  /**
   * 常量说明：openSession 用于打开 Session 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：id（SessionId）：标识本次操作关联的唯一对象；
   * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调(id)，并按返回类型处理结果。
   */
  const openSession = vi.fn((id: SessionId) => {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：draft（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(draft)，并按返回类型处理结果。
     */
    list.update((draft) => { draft.current = id })
  })
  /**
   * 常量说明：clearSession 用于处理 clearSession 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  const clearSession = vi.fn(() => {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：draft（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(draft)，并按返回类型处理结果。
     */
    list.update((draft) => { draft.current = undefined })
  })
  /**
   * 常量说明：sessions 用于处理 sessions 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const sessions = {
    list,
    create: createSession,
    open: openSession,
    clear: clearSession,
    binding: resolveBinding,
  } as unknown as ISessions

  return {
    sessions,
    list,
    resolveBinding,
    createSession,
    openSession,
    clearSession,
    /**
     * 功能说明：处理 binding 相关流程；使用场景由所在模块及调用位置决定。
     * @param id （由 TypeScript 根据调用位置推断的类型）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。
     * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 binding(id)，并按返回类型处理结果。
     */
    binding(id) {
      /**
       * 常量说明：scopeCtx 用于处理 scopeCtx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const scopeCtx = new Context()
      /**
       * 常量说明：snapshot 用于处理 snapshot 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const snapshot = createSnapshotStore<SessionSnapshot>({
        sessionId: id,
        queue: [],
        pendingSubmissions: [],
        running: false,
        subagent: null,
        removed: false,
        openState: 'open',
        openError: null,
        hasMore: false,
        loadingOlder: false,
        promptError: null,
        blank: false,
        lastAgentError: null,
        promptAttempted: false,
        awaitingFirstTurn: false,
      })
      /**
       * 常量说明：projections 用于处理 projections 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const projections = new Map<string, HostObservable<unknown>>()
      /**
       * 常量说明：session 用于处理 session 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：listener（() =>
       * void）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(listener)，并按返回类型处理结果。
       */
      const session = {
        sessionId: id,
        projections: {
          /**
           * 功能说明：处理 faceOf 相关流程；使用场景由所在模块及调用位置决定。
           * @param key （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
           * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
           * @example 在完成前置校验后调用 faceOf(key)，并按返回类型处理结果。
           */
          faceOf(key: string) {
            /**
             * 变量说明：source 用于处理 source 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
             */
            let source = projections.get(key)
            if (source === undefined) {
              source = createSnapshotStore<unknown>(undefined)
              projections.set(key, source)
            }
            return source
          },
        },
        getSnapshot: () => snapshot.getSnapshot(),
        subscribe: (listener: () => void) => snapshot.subscribe(listener),
      } as unknown as SessionBinding['session']
      /**
       * 常量说明：binding 用于处理 binding 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const binding: SessionBinding = {
        sessionId: id,
        session,
        eventSource: new MutableSessionEventSource(),
        ctx: scopeCtx as AgentContext,
      }
      bindings.set(id, binding)
      scopes.set(id, scopeCtx)
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：draft（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(draft)，并按返回类型处理结果。
       */
      list.update((draft) => {
        if (!draft.ids.includes(id)) draft.ids.push(id)
        draft.byId[id] = {
          id,
          displayTitle: id,
          running: false,
          blank: false,
          updatedAt: 1,
        }
      })
      return binding
    },
    /**
     * 功能说明：处理 select 相关流程；使用场景由所在模块及调用位置决定。
     * @param id （由 TypeScript 根据调用位置推断的类型）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。
     * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 select(id)，并按返回类型处理结果。
     */
    select(id) {
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：draft（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(draft)，并按返回类型处理结果。
       */
      list.update((draft) => { draft.current = id })
    },
    /**
     * 功能说明：处理 release 相关流程；使用场景由所在模块及调用位置决定。
     * @param id （由 TypeScript 根据调用位置推断的类型）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。
     * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 release(id)，并按返回类型处理结果。
     */
    async release(id) {
      bindings.delete(id)
      /**
       * 常量说明：scopeCtx 用于处理 scopeCtx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const scopeCtx = scopes.get(id)
      scopes.delete(id)
      await scopeCtx?.fiber.dispose()
    },
  }
}

/**
 * 功能说明：创建 Ui Session 相关流程；使用场景由所在模块及调用位置决定。
 * @param ctx （Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。
 * @param bench （SessionsBench）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns UiSession；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 createUiSession(ctx, bench)，并按返回类型处理结果。
 */
function createUiSession(ctx: Context, bench: SessionsBench): UiSession {
  ctx.provide('slots', { bindStoreScope: vi.fn() } as never)
  return new UiSession(ctx, bench.sessions)
}

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
afterEach(() => {
  vi.restoreAllMocks()
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('UiSession bindings', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('binds each materialized Session to renderer-owned Store cleanup', () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = new Context()
    /**
     * 常量说明：bench 用于处理 bench 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const bench = createSessionsBench(ctx)
    /**
     * 常量说明：bindStoreScope 用于处理 bindStoreScope 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const bindStoreScope = vi.fn()
    ctx.provide('slots', { bindStoreScope } as never)
    /**
     * 常量说明：service 用于处理 service 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const service = new UiSession(ctx, bench.sessions)
    /**
     * 常量说明：binding 用于处理 binding 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const binding = bench.binding(sessionId('s1'))

    /**
     * 常量说明：materialized 用于处理 materialized 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const materialized = service.adapter.resolve(binding.sessionId)

    expect(bindStoreScope).toHaveBeenCalledOnce()
    expect(bindStoreScope).toHaveBeenCalledWith(materialized)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('materializes built-in sources, caches a binding, and publishes selection and release', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = new Context()
    /**
     * 常量说明：bench 用于处理 bench 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const bench = createSessionsBench(ctx)
    /**
     * 常量说明：service 用于处理 service 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const service = createUiSession(ctx, bench)
    /**
     * 常量说明：id 用于处理 id 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const id = sessionId('s1')
    /**
     * 常量说明：binding 用于处理 binding 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const binding = bench.binding(id)
    /**
     * 常量说明：current 用于处理 current 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const current = vi.fn()
    /**
     * 常量说明：offCurrent 用于处理 offCurrent 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const offCurrent = service.adapter.current.subscribe(current)

    expect(service.adapter.current.getSnapshot()).toEqual({
      key: undefined,
      hooks: { session: undefined },
      keyedHooks: { projection: undefined },
      props: { sessionId: undefined },
    })
    expect(service.adapter.resolve('missing')).toBeUndefined()

    /**
     * 常量说明：first 用于处理 first 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const first = service.adapter.resolve(id)!
    expect(service.adapter.resolve(id)).toBe(first)
    expect(first.key).toBe(id)
    expect(first.hooks.session).toBe(binding.session)
    expect(first.props.sessionId).toBe(id)
    expect(first.keyedHooks.projection?.('status'))
      .toBe(binding.session.projections.faceOf('status'))

    bench.select(id)
    expect(current).toHaveBeenCalledTimes(1)
    expect(service.adapter.current.getSnapshot()).toBe(first)
    bench.select(id)
    expect(current).toHaveBeenCalledTimes(1)

    bench.resolveBinding.mockClear()
    await bench.release(id)
    expect(bench.resolveBinding).not.toHaveBeenCalled()
    expect(current).toHaveBeenCalledTimes(2)
    expect(service.adapter.current.getSnapshot().key).toBeUndefined()

    /**
     * 常量说明：other 用于处理 other 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const other = sessionId('s2')
    bench.binding(other)
    service.adapter.resolve(other)
    bench.resolveBinding.mockClear()
    await bench.release(other)
    expect(bench.resolveBinding).not.toHaveBeenCalled()
    expect(current).toHaveBeenCalledTimes(2)

    offCurrent()
    await ctx.fiber.dispose()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('renders the empty area and a Session-keyed selected area', () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = new Context()
    /**
     * 常量说明：bench 用于处理 bench 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const bench = createSessionsBench(ctx)
    /**
     * 常量说明：service 用于处理 service 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const service = createUiSession(ctx, bench)
    /**
     * 常量说明：empty 用于处理 empty 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const empty = vi.fn(() => 'empty')
    /**
     * 常量说明：children 用于处理 children 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const children = 'session body'
    if (service.adapter.renderArea === undefined) throw new Error('Session area renderer was not installed')

    /**
     * 常量说明：emptyArea 用于处理 emptyArea 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const emptyArea = service.adapter.renderArea(
      service.adapter.current.getSnapshot(),
      { empty, children },
    )
    expect(emptyArea).toMatchObject({
      type: Fragment,
      key: null,
      props: { children: 'empty' },
    })
    expect(empty).toHaveBeenCalledOnce()

    /**
     * 常量说明：defaultEmptyArea 用于处理 defaultEmptyArea 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const defaultEmptyArea = service.adapter.renderArea(
      service.adapter.current.getSnapshot(),
      { children },
    )
    expect(defaultEmptyArea).toMatchObject({
      type: Fragment,
      key: null,
      props: { children: null },
    })

    /**
     * 常量说明：id 用于处理 id 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const id = sessionId('s1')
    bench.binding(id)
    bench.select(id)
    /**
     * 常量说明：selectedArea 用于处理 selectedArea 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const selectedArea = service.adapter.renderArea(
      service.adapter.current.getSnapshot(),
      { empty, children },
    )
    expect(selectedArea).toMatchObject({
      type: Fragment,
      key: id,
      props: { children },
    })
    expect(empty).toHaveBeenCalledOnce()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('contains a failing current-binding subscriber and continues dispatch', () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = new Context()
    /**
     * 常量说明：bench 用于处理 bench 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const bench = createSessionsBench(ctx)
    /**
     * 常量说明：service 用于处理 service 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const service = createUiSession(ctx, bench)
    /**
     * 常量说明：id 用于处理 id 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const id = sessionId('s1')
    bench.binding(id)
    /**
     * 常量说明：failure 用于处理 failure 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const failure = new Error('subscriber failed')
    /**
     * 常量说明：report 用于处理 report 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    service.adapter.current.subscribe(() => { throw failure })
    /**
     * 常量说明：after 用于处理 after 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const after = vi.fn()
    service.adapter.current.subscribe(after)

    bench.select(id)

    expect(after).toHaveBeenCalledOnce()
    expect(report).toHaveBeenCalledWith(
      '[ui-session] current binding subscriber failed:',
      failure,
    )
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('releases cached bindings when the owning Client context stops', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = new Context()
    /**
     * 常量说明：bench 用于处理 bench 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const bench = createSessionsBench(ctx)
    /**
     * 常量说明：service 用于处理 service 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const service = createUiSession(ctx, bench)
    /**
     * 常量说明：id 用于处理 id 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const id = sessionId('s1')
    bench.binding(id)
    bench.select(id)
    service.adapter.current.getSnapshot()

    await expect(ctx.fiber.dispose()).resolves.toBeUndefined()
    await bench.release(id)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('rebuilds live bindings and removes only the disposed source contribution', () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = new Context()
    /**
     * 常量说明：bench 用于处理 bench 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const bench = createSessionsBench(ctx)
    /**
     * 常量说明：service 用于处理 service 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const service = createUiSession(ctx, bench)
    /**
     * 常量说明：id 用于处理 id 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const id = sessionId('s1')
    bench.binding(id)
    bench.select(id)
    /**
     * 常量说明：custom 用于处理 custom 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const custom = createSnapshotStore({ value: 1 })
    /**
     * 常量说明：keyed 用于处理 keyed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：处理 keyed 相关流程；使用场景由所在模块及调用位置决定。
     * @param key （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @returns HostObservable<unknown>；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 keyed(key)，并按返回类型处理结果。
     */
    const keyed = (key: string): HostObservable<unknown> => createSnapshotStore(key)

    /**
     * 常量说明：dispose 用于处理 dispose 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const dispose = service.provide({
      hooks: ['custom'],
      keyedHooks: ['customKeyed'],
      props: ['customProp'],
      resolve: () => ({
        hooks: { custom },
        keyedHooks: { customKeyed: keyed },
        props: { customProp: 'value' },
      }),
    })
    /**
     * 常量说明：disposeNeighbor 用于处理 disposeNeighbor 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const disposeNeighbor = service.provide({
      props: ['neighborProp'],
      resolve: () => ({ props: { neighborProp: 'neighbor' } }),
    })

    /**
     * 常量说明：contributed 用于处理 contributed 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const contributed = service.adapter.current.getSnapshot()
    expect(contributed.hooks.custom).toBe(custom)
    expect(contributed.keyedHooks.customKeyed).toBe(keyed)
    expect(contributed.props.customProp).toBe('value')
    expect(contributed.props.neighborProp).toBe('neighbor')

    dispose()
    /**
     * 常量说明：restored 用于处理 restored 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const restored = service.adapter.current.getSnapshot()
    expect(restored.hooks.session).toBeDefined()
    expect(typeof restored.keyedHooks.projection).toBe('function')
    expect(restored.props.sessionId).toBe(id)
    expect(restored.hooks).not.toHaveProperty('custom')
    expect(restored.props.neighborProp).toBe('neighbor')
    dispose()
    expect(service.adapter.current.getSnapshot().props.neighborProp).toBe('neighbor')

    disposeNeighbor()
    expect(service.adapter.current.getSnapshot().props).not.toHaveProperty('neighborProp')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：kind（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：descriptor（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(kind, descriptor)，
   * 并按返回类型处理结果。
   */
  it.each([
    ['hook', { resolve: () => ({ hooks: { surprise: createSnapshotStore(1) } }) }],
    ['keyed hook', { resolve: () => ({ keyedHooks: { surprise: () => createSnapshotStore(1) } }) }],
    ['prop', { resolve: () => ({ props: { surprise: 1 } }) }],
  ] as const)('rejects an undeclared %s returned by a contribution', (kind, descriptor) => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = new Context()
    /**
     * 常量说明：bench 用于处理 bench 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const bench = createSessionsBench(ctx)
    /**
     * 常量说明：service 用于处理 service 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const service = createUiSession(ctx, bench)
    service.adapter.resolve(bench.binding(sessionId('s1')).sessionId)

    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => { service.provide(descriptor as never) })
      .toThrow(`uiSession.provide: undeclared ${kind} 'surprise'`)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：kind（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：descriptor（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(kind, descriptor)，
   * 并按返回类型处理结果。
   */
  it.each([
    ['hook', { hooks: ['missing'], resolve: () => ({}) }],
    ['keyed hook', { keyedHooks: ['missing'], resolve: () => ({}) }],
    ['prop', { props: ['missing'], resolve: () => ({}) }],
  ] as const)('rejects a missing declared %s', (kind, descriptor) => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = new Context()
    /**
     * 常量说明：bench 用于处理 bench 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const bench = createSessionsBench(ctx)
    /**
     * 常量说明：service 用于处理 service 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const service = createUiSession(ctx, bench)
    service.adapter.resolve(bench.binding(sessionId('s1')).sessionId)

    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => { service.provide(descriptor) })
      .toThrow(`uiSession.provide: missing ${kind} 'missing'`)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：kind（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：descriptor（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(kind, descriptor)，
   * 并按返回类型处理结果。
   */
  it.each([
    ['hook', { hooks: ['session'], resolve: () => ({ hooks: { session: createSnapshotStore(1) } }) }],
    ['keyed hook', {
      keyedHooks: ['projection'],
      resolve: () => ({ keyedHooks: { projection: () => createSnapshotStore(1) } }),
    }],
    ['prop', { props: ['sessionId'], resolve: () => ({ props: { sessionId: 'other' } }) }],
  ] as const)('rejects a duplicate declared %s', (kind, descriptor) => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = new Context()
    /**
     * 常量说明：bench 用于处理 bench 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const bench = createSessionsBench(ctx)
    /**
     * 常量说明：service 用于处理 service 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const service = createUiSession(ctx, bench)

    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => { service.provide(descriptor) })
      .toThrow(`uiSession.provide: duplicate ${kind}`)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('rejects cross-compartment collisions at the final standard prop name', () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = new Context()
    /**
     * 常量说明：bench 用于处理 bench 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const bench = createSessionsBench(ctx)
    /**
     * 常量说明：service 用于处理 service 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const service = createUiSession(ctx, bench)
    /**
     * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const source = createSnapshotStore(1)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    service.provide({
      hooks: ['feature'],
      resolve: () => ({ hooks: { feature: source } }),
    })
    /**
     * 常量说明：before 用于处理 before 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const before = service.adapter.current.getSnapshot()

    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => service.provide({
      keyedHooks: ['feature'],
      resolve: () => ({ keyedHooks: { feature: () => source } }),
    })).toThrow("uiSession.provide: duplicate keyed hook 'feature' at prop 'useFeature'")
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => service.provide({
      props: ['useFeature'],
      resolve: () => ({ props: { useFeature: true } }),
    })).toThrow("uiSession.provide: duplicate prop 'useFeature' at prop 'useFeature'")
    expect(service.adapter.current.getSnapshot()).toBe(before)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('releases partially rebuilt bindings when a later Session contribution fails', () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = new Context()
    /**
     * 常量说明：bench 用于处理 bench 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const bench = createSessionsBench(ctx)
    /**
     * 常量说明：service 用于处理 service 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const service = createUiSession(ctx, bench)
    service.adapter.resolve(bench.binding(sessionId('s1')).sessionId)
    service.adapter.resolve(bench.binding(sessionId('s2')).sessionId)
    /**
     * 变量说明：calls 用于处理 calls 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let calls = 0

    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => service.provide({
      props: ['partial'],
      resolve: () => {
        calls += 1
        if (calls === 2) throw new Error('second binding failed')
        return { props: { partial: true } }
      },
    })).toThrow('second binding failed')
    expect(calls).toBe(2)
    expect(service.adapter.resolve(sessionId('s1'))?.props).not.toHaveProperty('partial')
  })
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('UiSession pending interactions', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('publishes the highest-precedence exact object and removes each source independently', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = new Context()
    /**
     * 常量说明：bench 用于处理 bench 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const bench = createSessionsBench(ctx)
    /**
     * 常量说明：service 用于处理 service 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const service = createUiSession(ctx, bench)
    /**
     * 常量说明：id 用于处理 id 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const id = sessionId('s1')
    /**
     * 常量说明：listener 用于处理 listener 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const listener = vi.fn()
    /**
     * 常量说明：off 用于处理 off 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const off = service.pendingInteractions.subscribe(listener)
    /**
     * 常量说明：registerApproval 用于注册 Approval 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const registerApproval = service.registerPendingInteraction<SessionPendingInteractionBase>(
      () => 0,
    )
    /**
     * 常量说明：registerQuestion 用于注册 Question 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：interaction（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(interaction)，并按返回类型处理结果。
     */
    const registerQuestion = service.registerPendingInteraction<SessionPendingInteractionBase>(
      interaction => interaction.kind === 'plan-review' ? 2 : 1,
    )
    /**
     * 常量说明：registerBackground 用于注册 Background 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const registerBackground = service.registerPendingInteraction<SessionPendingInteractionBase>(
      () => -1,
    )
    listener.mockClear()

    /**
     * 常量说明：approval 用于处理 approval 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const approval = { key: 'approval:1', kind: 'approval', sessionId: id }
    /**
     * 常量说明：duplicate 用于处理 duplicate 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const duplicate = { key: 'approval:2', kind: 'approval', sessionId: id }
    /**
     * 常量说明：question 用于处理 question 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const question = { key: 'question:1', kind: 'question', sessionId: id }
    /**
     * 常量说明：plan 用于处理 plan 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const plan = { key: 'question:2', kind: 'plan-review', sessionId: id }
    /**
     * 常量说明：background 用于处理 background 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const background = { key: 'background:1', kind: 'background', sessionId: id }
    /**
     * 常量说明：delegate 用于处理 delegate 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：处理 delegate 相关流程；使用场景由所在模块及调用位置决定。
     * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 delegate()，并按返回类型处理结果。
     */
    const delegate = (): Promise<void> => Promise.resolve()
    /**
     * 常量说明：removeApproval 用于移除 Approval 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const removeApproval = registerApproval(approval, delegate)
    expect(service.pendingInteractions.getSnapshot().get(id)).toBe(approval)
    /**
     * 常量说明：removeDuplicate 用于移除 Duplicate 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const removeDuplicate = registerApproval(duplicate, delegate)
    expect(service.pendingInteractions.getSnapshot().get(id)).toBe(duplicate)
    /**
     * 常量说明：removeQuestion 用于移除 Question 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const removeQuestion = registerQuestion(question, delegate)
    expect(service.pendingInteractions.getSnapshot().get(id)).toBe(question)
    /**
     * 常量说明：removePlan 用于移除 Plan 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const removePlan = registerQuestion(plan, delegate)
    expect(service.pendingInteractions.getSnapshot().get(id)).toBe(plan)
    /**
     * 常量说明：removeBackground 用于移除 Background 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const removeBackground = registerBackground(background, delegate)
    expect(service.pendingInteractions.getSnapshot().get(id)).toBe(plan)

    removeBackground()
    removeQuestion()
    expect(service.pendingInteractions.getSnapshot().get(id)).toBe(plan)
    removePlan()
    expect(service.pendingInteractions.getSnapshot().get(id)).toBe(duplicate)
    removeDuplicate()
    expect(service.pendingInteractions.getSnapshot().get(id)).toBe(approval)
    removeApproval()
    removeApproval()
    expect(service.pendingInteractions.getSnapshot().has(id)).toBe(false)
    off()
    await ctx.fiber.dispose()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('rejects duplicate keys and contains a failing aggregate subscriber', () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = new Context()
    /**
     * 常量说明：bench 用于处理 bench 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const bench = createSessionsBench(ctx)
    /**
     * 常量说明：service 用于处理 service 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const service = createUiSession(ctx, bench)
    /**
     * 常量说明：registerPendingInteraction 用于注册 Pending Interaction 相关数据，作用于当前作用域；
     * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const registerPendingInteraction = service.registerPendingInteraction<SessionPendingInteractionBase>(
      () => 1,
    )
    /**
     * 常量说明：interaction 用于处理 interaction 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const interaction = { key: 'question:1', kind: 'question', sessionId: sessionId('s1') }
    /**
     * 常量说明：delegate 用于处理 delegate 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：处理 delegate 相关流程；使用场景由所在模块及调用位置决定。
     * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 delegate()，并按返回类型处理结果。
     */
    const delegate = () => Promise.resolve()
    /**
     * 常量说明：remove 用于移除 remove 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const remove = registerPendingInteraction(interaction, delegate)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => { registerPendingInteraction(interaction, delegate) })
      .toThrow("ui-session: duplicate pending interaction key 'question:1'")

    /**
     * 常量说明：failure 用于处理 failure 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const failure = new Error('pending subscriber failed')
    /**
     * 常量说明：report 用于处理 report 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    service.pendingInteractions.subscribe(() => { throw failure })
    /**
     * 常量说明：after 用于处理 after 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const after = vi.fn()
    service.pendingInteractions.subscribe(after)

    remove()

    expect(after).toHaveBeenCalledOnce()
    expect(report).toHaveBeenCalledWith(
      '[ui-session] pending interactions subscriber failed:',
      failure,
    )
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('removes active values before awaiting their teardown delegation', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = new Context()
    /**
     * 常量说明：bench 用于处理 bench 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const bench = createSessionsBench(ctx)
    /**
     * 常量说明：service 用于处理 service 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const service = createUiSession(ctx, bench)
    /**
     * 常量说明：gate 用于处理 gate 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const gate = Promise.withResolvers<undefined>()
    /**
     * 常量说明：delegate 用于处理 delegate 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const delegate = vi.fn(() => gate.promise)
    /**
     * 常量说明：publish 用于处理 publish 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const publish = service.registerPendingInteraction<SessionPendingInteractionBase>(() => 1)
    /**
     * 常量说明：remove 用于移除 remove 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const remove = publish(
      { key: 'question:1', kind: 'question', sessionId: sessionId('s1') },
      delegate,
    )

    /**
     * 变量说明：disposed 用于处理 disposed 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let disposed = false
    /**
     * 常量说明：disposal 用于处理 disposal 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const disposal = ctx.fiber.dispose().then(() => { disposed = true })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => { expect(delegate).toHaveBeenCalledOnce() })
    expect(service.pendingInteractions.getSnapshot()).toEqual(new Map())
    expect(disposed).toBe(false)
    remove()
    remove()

    gate.resolve(undefined)
    await disposal
    expect(disposed).toBe(true)
  })
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('ui-session apply', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('provides the root sources and installs the Session scope adapter', () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = new Context()
    /**
     * 常量说明：bench 用于处理 bench 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const bench = createSessionsBench(ctx)
    /**
     * 常量说明：slots 用于处理 slots 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const slots = {
      provideRoot: vi.fn(),
      installScope: vi.fn(),
    }
    ctx.provide('sessions', bench.sessions)
    ctx.provide('slots', slots as never)

    apply(ctx)

    expect(ctx.uiSession).toBeInstanceOf(UiSession)
    expect(slots.provideRoot).toHaveBeenCalledWith({
      hooks: {
        sessions: bench.sessions.list,
        sessionPendingInteraction: ctx.uiSession.pendingInteractions,
      },
    })
    expect(slots.installScope).toHaveBeenCalledWith('session', ctx.uiSession.adapter)
  })

  it('keeps the Host loader half inert', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })
})
