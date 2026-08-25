/*
 * ================================ 文件注释 ================================
 * 【文件职责】agent 作用域分发助手：构建“把 agent 主体与其作用域载体绑定”的融合分发器（agentEvents），以及 prompt 组装上下文助手（assembleContextFor）。
 * 【技术维度】类型体操提取 agent-subject 事件（Scoped<Agent> this 检查）；融合分发器把载体作为 thisArg、把 agent 注入 payload，保证“作用域键与 payload.agent 永不背离”。
 * 【产品维度】所有 agent 事件（created/status/request 等）都经由这里分发，插件用 scope 过滤收到自己关心的 agent 事件。
 * 【逻辑维度】类型助手（Params/Return/AgentSubjectEvent/PayloadOf/Tail/PayloadRest）→ AgentEventDispatch 接口
 * → agentCarrier/agentEvents 实现 → emitAgentEvent/assembleContextFor 便捷函数。
 * 【关键边界】emit 自己遍历回调并逐个容错（Cordis 原生 emit 会被一个抛错者饿死后续监听器）；serial/waterfall 转发给 Cordis 混入；payload 展开在前保证调用者无法覆盖注入的 agent。
 * 【新手阅读建议】先读 AgentEventDispatch 的三个方法签名（emit/serial/waterfall 对应三种分发模式），再看 agentEvents 的实现与注释。
 * ==========================================================================
 */
/**
 * Agent-scoped dispatch and prompt assembly helpers. The fused dispatcher
 * {@link agentEvents} couples the agent subject to its scope carrier, so the
 * scope key and the payload's `agent` cannot diverge; repeat dispatchers (the
 * loop driver) build it once in the agent's constructor and reuse it.
 * @module @deepseek-ai/dsh-agent/dispatch
 */

import type { Context, Events } from '@deepseek-ai/cordis'
import { scopeTarget } from '@deepseek-ai/dsh-scope'
import type { Scoped } from '@deepseek-ai/dsh-scope'
import type { AssembleContext } from '@deepseek-ai/dsh-system-prompt'
import type { Agent } from './runtime-types.ts'

/** Extract the parameter tuple from an event handler type (its `this` is not part of the tuple). */
// 类型助手：取事件处理函数的参数元组（其 this 参数不计入元组）。
type Params<F> = F extends (...args: infer P) => unknown ? P : never
/** Extract the return type from an event handler type. */
// 类型助手：取事件处理函数的返回类型。
type Return<F> = F extends (...args: never[]) => infer R ? R : never

/**
 * The event names whose subject is an agent: the handler's first parameter is
 * a payload object carrying the `agent` subject AND the handler declares a
 * `Scoped<Agent>` `this` (the scope-carrier contract). The `this` check keeps
 * accidental payload-happens-to-carry-an-Agent events (or zero-arg events,
 * whose parameter tuple would satisfy a bare rest-tuple check via callability)
 * out of the fused-dispatch surface.
 */
// 提取“主体是 agent”的事件名集合：处理函数必须声明 Scoped<Agent> 的 this，
// 且首个参数负载里带 agent 字段——这样能排除“碰巧带 agent 字段”的普通事件。
export type AgentSubjectEvent = {
  [K in keyof Events]: Events[K] extends (this: Scoped<Agent>, ...args: infer P) => unknown
    ? P extends [infer Payload, ...unknown[]]
      ? Payload extends { agent: Agent } ? K : never
      : never
    : never
}[keyof Events]

/** The full payload object of one agent-subject event. */
// 某个 agent-subject 事件的完整负载类型（含 agent 字段）。
type PayloadOf<K extends AgentSubjectEvent> = Params<Events[K]> extends [infer Payload, ...unknown[]] ? Payload : never

/** The event arguments AFTER the payload: the waterfall `next` when present. */
// 负载之后的参数：瀑布事件里就是 next 回调（可能有多个）。
type Tail<K extends AgentSubjectEvent> = Params<Events[K]> extends [unknown, ...infer R] ? R : never

/**
 * The payload as emit-side callers pass it: the full payload minus the agent
 * field, which the fused dispatcher injects so subject and scope key cannot
 * diverge.
 */
// 调用方视角的负载：去掉 agent 字段（agent 由融合分发器注入，保证主体与作用域键永不背离）。
type PayloadRest<K extends AgentSubjectEvent> = Omit<PayloadOf<K> & object, 'agent'>

/**
 * The fused dispatcher {@link agentEvents} returns: each method dispatches the
 * named agent-subject event with the agent's scope carrier as `thisArg` and
 * the agent itself injected into the payload.
 */
// 融合分发器接口：三种分发模式——emit（通知）/serial（串行）/waterfall（瀑布）。
export interface AgentEventDispatch {
  /**
   * Fire-and-forget notification in the agent's scope. Every listener is
   * invoked; synchronous throws and returned-promise rejections are logged and
   * contained per listener, so a notification cannot veto lifecycle progress
   * or starve a later observer.
   * @param name - the agent-subject event to emit.
   * @param payload - the event's payload fields; `agent` is injected.
   */
  // emit：即发即忘的通知，逐个监听器容错（一个失败不影响后面的）。
  emit<K extends AgentSubjectEvent>(name: K, payload: PayloadRest<K>): void
  /**
   * Awaited in-order dispatch (Cordis `serial`) in the agent's scope.
   * @param name - the agent-subject event to dispatch.
   * @param payload - the event's payload fields; `agent` is injected.
   * @returns the serial chain's result (the first bail value, if any).
   */
  // serial：按注册顺序逐个 await；任一监听器返回值即短路（bail）。
  serial<K extends AgentSubjectEvent>(name: K, payload: PayloadRest<K>): Promise<Awaited<Return<Events[K]>>>
  /**
   * Around-middleware dispatch (Cordis `waterfall`) in the agent's scope. The
   * declared event parameters already end with the `next` callback, so `rest`
   * is exactly the event's arguments after the payload — the final element
   * being the innermost `next` (the default the listener chain wraps).
   * @param name - the agent-subject event to dispatch.
   * @param payload - the event's payload fields; `agent` is injected.
   * @param rest - the event's arguments after the payload (the `next` callback).
   * @returns the waterfall's composed result.
   */
  // waterfall：洋葱式中间件；监听器调用 next() 委托给下一个，返回自己的值则覆盖结果。
  waterfall<K extends AgentSubjectEvent>(name: K, payload: PayloadRest<K>, ...rest: Tail<K>): Return<Events[K]>
}

/**
 * Build the fused scope carrier for one agent subject.
 *
 * The carrier is a stateless routing object. {@link agentEvents} accepts an
 * existing carrier, so callers that dispatch repeatedly for the same agent
 * (the loop driver) build it once in the agent's constructor and reuse it,
 * keeping hot-path dispatches allocation-free.
 * @param agent - the subject agent and scope key.
 * @returns the carrier passed as the event dispatcher `this` value.
 */
// 为某 agent 构建作用域载体：主体即作用域键；反复分发的调用方可复用同一个载体。
export function agentCarrier(agent: Agent): Scoped<Agent> {
  return scopeTarget(agent, agent)
}

/**
 * Build a dispatcher that couples the agent subject to its scope carrier.
 * @param ctx - the context to dispatch through (any context of the app).
 * @param agent - the subject agent; also the scope-carrier key.
 * @param carrier - the scope carrier to dispatch through; defaults to
 * {@link agentCarrier} for the agent. Pass a constructor-built carrier to
 * avoid rebuilding it for every dispatch.
 * @returns the fused dispatcher.
 */
// 构建融合分发器：把“载体 + 主体注入”封装进 emit/serial/waterfall 三个方法里。
export function agentEvents(ctx: Context, agent: Agent, carrier: Scoped<Agent> = agentCarrier(agent)): AgentEventDispatch {
  // The ordinary dispatch methods forward through Cordis' variadic mixins. The
  // fused (carrier, name, payload, ...rest) tuple is provably a valid argument
  // list for the matching thisArg overload, but TypeScript cannot relate the
  // generic Tail<K> spread back to that overload's conditional parameter
  // tuple — hence one contained, shape-preserving cast per method.
  // 融合函数：把负载与 agent 合并（展开在前，调用方携带的 agent 字段永远无法覆盖注入的主体）。
  const fused = <K extends AgentSubjectEvent>(payload: PayloadRest<K>): PayloadOf<K> =>
    // The dispatcher owns the subject injection; callers pass PayloadRest, so
    // the fused record is exactly the declared payload. The spread comes
    // first, so a structurally acceptable payload that happens to carry an
    // `agent` field can never override the injected subject.
    ({ ...payload, agent } as PayloadOf<K>)
  return {
    emit(name, payload) {
      // Cordis emit invokes callbacks through Array.map: one synchronous throw
      // starves later listeners, and returned promises are discarded. Agent
      // notifications are non-vetoing, so resolve the same filtered callback
      // set ourselves and contain both failure modes independently.
      // 原生 Cordis emit 用 Array.map 调回调：一个同步抛错会饿死后面的监听器，返回的 Promise 也被丢弃。
      // 这里自行取出过滤后的回调集，逐个容错：同步抛错与异步拒绝都只记日志，绝不影响生命周期推进。
      const args: unknown[] = [carrier, name, fused(payload)]
      const callbacks = ctx.events.dispatch('emit', args)
      for (const callback of callbacks) {
        try {
          const returned: unknown = callback(...args)
          void Promise.resolve(returned).catch((error: unknown) => {
            ctx.logger.warn(`agent event "${name}" listener rejected: ${String(error)}`)
          })
        } catch (error: unknown) {
          ctx.logger.warn(`agent event "${name}" listener threw: ${String(error)}`)
        }
      }
    },
    async serial(name, payload) {
      // 转发给 Cordis 的 serial 混入（带作用域载体作为 thisArg）。
      // oxlint-disable-next-line typescript/unbound-method -- the events mixin accessor returns a pre-bound function
      const serial = ctx.serial as (thisArg: Scoped<Agent>, name: string, ...args: unknown[]) => Promise<never>
      return await serial(carrier, name, fused(payload))
    },
    waterfall(name, payload, ...rest) {
      // 转发给 Cordis 的 waterfall 混入（rest 即 next 等尾参）。
      // oxlint-disable-next-line typescript/unbound-method -- the events mixin accessor returns a pre-bound function
      const waterfall = ctx.waterfall as (thisArg: Scoped<Agent>, name: string, ...args: unknown[]) => never
      return waterfall(carrier, name, fused(payload), ...rest)
    },
  }
}

/**
 * Emit one contained agent notification without allocating a retained dispatcher.
 * @param ctx - the context to dispatch through.
 * @param agent - the subject agent and scope key.
 * @param name - the agent-subject event to emit.
 * @param payload - the event's payload fields; `agent` is injected.
 */
// 单次通知便捷函数：不保留分发器，发完即弃（适合低频一次性通知）。
export function emitAgentEvent<K extends AgentSubjectEvent>(
  ctx: Context,
  agent: Agent,
  name: K,
  payload: PayloadRest<K>,
): void {
  agentEvents(ctx, agent).emit(name, payload)
}

/**
 * Build the prompt assembly context with agent and scope set together, so
 * agent-scoped prompt and tool contributions cannot be silently omitted.
 * @param agent - the agent the assembly is for.
 * @param signal - the current turn's explicit control signal, when assembly belongs to a turn.
 * @returns the context to pass to `assemble()`.
 */
// 组装上下文：把 agent 与 scope 同时设好，确保作用域化的提示词/工具贡献不会被静默漏掉。
export function assembleContextFor(agent: Agent, signal?: AbortSignal): AssembleContext {
  return { agent, scope: agent, ...signal === undefined ? {} : { signal } }
}
