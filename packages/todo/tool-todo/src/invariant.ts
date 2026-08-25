/** Package-owned durable todo-snapshot invariants. @module @deepseek-ai/dsh-tool-todo/invariant */
/*
 * 文件职责：实现 invariant.ts 覆盖的Todo 工具行为与测试协作。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、快照、模拟服务器或类型生成。
 * 产品维度：通过可复现的Todo 工具能力保障 Agent 功能在集成层稳定。
 * 逻辑维度：准备夹具或输入，执行装载/生成/调用流程，再规范化并核对结果。
 * 关键边界：夹具必须确定且跨平台；模型可见状态应可重放；临时资源必须释放。
 * 新手阅读建议：先看导出类型和夹具，再读主流程，最后关注规范化、失败和清理。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

/** 中文说明：常量 PACKAGE_NAME 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const PACKAGE_NAME = '@deepseek-ai/dsh-tool-todo'
/** 中文说明：常量 TODO_STATUSES 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const TODO_STATUSES = new Set(['pending', 'in_progress', 'completed'])

/** Cordis companion plugin name. */
/* 中文说明：变量 name 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
export const name = 'tool-todo-invariant'
/** Service required before the companion can reserve package ownership. */
/* 中文说明：变量 inject 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
export const inject = ['invariants']

/**
 * Validate one whole-list todo snapshot before it reaches the durable log.
 *
 * Deliberately silent on how many items are `in_progress`. That is the tool's
 * per-deployment policy (`Config.allowParallelInProgress`), not a durable-shape
 * rule: a log written while parallel work was allowed must still replay after a
 * deployment tightens the policy, so tying the invariant to the current config
 * would reject history that was valid when it was written.
 */
/* 中文说明：函数 validateTodos 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function validateTodos(value: unknown, fail: InvariantFailure): void {
  if (!Array.isArray(value)) fail('todo/write todos must be an array')
  /** 中文说明：变量 seen 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const seen = new Set<string>()
  /** 中文说明：该循环依次处理夹具或生成数据；循环变量仅在当前循环中有效。 */
  for (const item of value) {
    if (typeof item !== 'object' || item === null) fail('todo/write entries must be objects')
    const { content, status } = item as Record<string, unknown>
    if (typeof content !== 'string' || content.length === 0 || content.trim() !== content) {
      fail('todo/write content must be non-empty and already trimmed')
    }
    if (seen.has(content)) fail(`todo/write repeats content ${JSON.stringify(content)}`)
    seen.add(content)
    if (typeof status !== 'string' || !TODO_STATUSES.has(status)) {
      fail(`todo/write carries unknown status ${JSON.stringify(status)}`)
    }
  }
}

/* jscpd:ignore-start -- package companions share replay and dispatch plumbing */
/** Validate the package-owned event fields and ignore unrelated events. */
/* 中文说明：函数 validateEvent 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function validateEvent(event: SessionEvent, fail: InvariantFailure): void {
  if (event.type === 'todo/write') validateTodos(event.data.todos, fail)
}

/** Install validation for loaded and newly appended whole-list todo snapshots. */
/* 中文说明：函数值 install 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  /** 中文说明：该循环依次处理夹具或生成数据；循环变量仅在当前循环中有效。 */
  for (const session of ctx.sessions.list()) {
    /** 中文说明：该循环依次处理夹具或生成数据；循环变量仅在当前循环中有效。 */
    for (const event of session.events) validateEvent(event, fail)
  }
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    /** 中文说明：变量 event 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const event = (args as [Session, SessionEvent])[1]
    validateEvent(event, fail)
  }, { global: true })
}, { inject: ['sessions'] })
/* jscpd:ignore-end */

/**
 * Register the todo invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
/* 中文说明：函数值 apply 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
