/**
 * ================================ 文件注释 ================================
 * 【文件职责】安装 agent-loop 包的运行时不变量检查：拦截 llm/stream 事件，校验本循环构建的模型请求能否从会话日志完整重建。
 * 【技术维度】作为 Cordis 伴生插件挂到 invariants 服务；用 prepend 模式抢在回放监听器之前执行；请求、消息、header 逐一与日志推导结果比对。
 * 【产品维度】开发期/测试期的“自检哨兵”：一旦循环写日志与发请求脱节，立即在运行时暴露，防止静默地给模型喂了与日志不一致的上下文。
 * 【逻辑维度】PACKAGE_NAME/name/inject → install 安装器（isAgentLoopRequest 过滤 → 冻结与 sessionId 校验
 * → 与 step/start、request/header、deriveMessages 逐项比对 → header 比对）→ apply 注册。
 * 【关键边界】只对带 agent-loop 标记（markAgentLoopRequest）的请求生效；比对失败仅 fail 不拦截请求；监听器必须调用 next() 委托链路。
 * 【新手阅读建议】先看 install 里的检查清单，理解“日志可重建”的含义；再对照 agent.ts 的 buildRequest 看请求如何被组装与持久化。
 * ==========================================================================
 */
/**
 * Package-owned request-reconstruction invariant for loop-built LLM calls.
 * @module @deepseek-ai/dsh-agent-loop/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import { isAgentLoopRequest, type GenerateOptions } from '@deepseek-ai/dsh-llm'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { foldRequestHeader } from '@deepseek-ai/dsh-session'

// 本包在 invariants 注册表中的包名，作为该贡献的唯一标识。
const PACKAGE_NAME = '@deepseek-ai/dsh-agent-loop'

/** Cordis companion plugin name. */
// 伴生插件名：与其他不变量插件一样，通过 invariants 服务统一装载与卸载。
export const name = 'agent-loop-invariant'
/** Service required before the companion can reserve package ownership. */
// 依赖声明：必须先有 invariants 服务，本插件才能向其中注册自己的检查器。
export const inject = ['invariants']

/** Install the request-reconstruction contribution into its child registration fiber. */
// 安装器本体：向 ctx 注册一个全局、置顶的 llm/stream 监听器，逐项核对循环构建的请求与会话日志的一致性。
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  // Prepend prevents a short-circuiting replay listener from silencing the check.
  ctx.on('llm/stream', (options: GenerateOptions, next) => {
    if (!isAgentLoopRequest(options)) return next()
    if (!Object.isFrozen(options)) fail('a loop-built request must be frozen')
    if (options.sessionId === undefined) fail('a loop-built request must carry a session id')
    const session = ctx.sessions.get(options.sessionId)
    if (!session) fail(`a loop-built request must carry a live session id, got "${String(options.sessionId)}"`)
    if (!Object.isFrozen(options.messages)) {
      fail('a loop-built request must carry a frozen messages array')
    }

    const events = session.events
    if (!events.some(event => event.type === 'step/start')) {
      return fail('a loop-built request with no step/start in its session log')
    }
    const header = foldRequestHeader(events)
    if (header === undefined) {
      return fail('a loop-built request with no request/header event in its session log')
    }
    const expected = session.deriveMessages()
    if (JSON.stringify(options.messages) !== JSON.stringify(expected)) {
      fail(`llm request for session "${String(session.id)}" diverges from the dispatch-time durable derivation (log-reconstruction desync)`)
    }

    const headerMatches = options.model === header.config.model
      && options.system === header.system
      && options.temperature === header.config.temperature
      && options.maxTokens === header.config.maxTokens
      && JSON.stringify(options.stop) === JSON.stringify(header.config.stop)
      && JSON.stringify(options.tools ?? []) === JSON.stringify(header.tools ?? [])
    if (!headerMatches) {
      fail(`llm request for session "${String(session.id)}" diverges from the folded request header`)
    }
    return next()
  }, { global: true, prepend: true })
}, { inject: ['sessions'] })

/**
 * Register the agent-loop invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
// 注册入口：把 install 安装到 invariants 服务中，返回的 disposer 用于卸载该检查贡献。
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
