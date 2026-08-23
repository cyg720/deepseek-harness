/**
 * ================================ 文件注释 ================================
 * 【文件职责】提供“从事件负载中解析作用域路由键”的生成代码表，供 dsh-scope 的运行时不变量（invariant）检查使用。
 * 【技术维度】生成文件（勿手改）：根据各事件的 payload 结构生成解析器；null 表示“只能查载体存在性”，undefined 表示该事件不参与作用域过滤。
 * 【产品维度】运行时自检：确保作用域事件的分发载体键与负载里的主体一致，防止把事件发给错误的 agent。
 * 【逻辑维度】ScopedSubjectResolver 类型 → 冻结的解析器表 → scopedSubjectResolverFor 查表函数。
 * 【关键边界】文件由 pnpm run gen-scoped-events 生成，手改会被覆盖；本文件只读数据，不含运行时订阅逻辑。
 * 【新手阅读建议】直接读解析器表即可；结合 scope/invariant.ts 看它如何被消费。
 * ==========================================================================
 */
/**
 * Generated scoped-event routing-subject resolvers for dsh-scope invariants.
 * Do not edit by hand; run `pnpm run gen-scoped-events`.
 *
 * @module @deepseek-ai/dsh-scope/scoped-events.generated
 */

// 每个作用域事件的“路由主体解析器”：输入分发参数列表，返回该事件对应的作用域主体对象。
// 值为 null 表示该事件虽参与作用域过滤，但负载里无法取得外部路由键（只能检查载体存在性）。
type ScopedSubjectResolver = (args: readonly unknown[]) => unknown

// 事件名 → 解析器 的静态表。多数 agent 事件的主体是负载中的 agent 字段；
// system-prompt/assemble 的主体在第二个参数（assemble context）的 scope 字段；
// null 项（session/created 等）只做“必须携带载体”的存在性检查。
const scopedSubjectResolvers: Readonly<Record<string, ScopedSubjectResolver | null>> = Object.freeze({
  'agent/created': args => (args[0] as Record<string, unknown>)['agent'],
  'agent/disposed': args => (args[0] as Record<string, unknown>)['agent'],
  'agent/error': args => (args[0] as Record<string, unknown>)['agent'],
  'agent/inbox/claimed': args => (args[0] as Record<string, unknown>)['agent'],
  'agent/inbox/discarded': args => (args[0] as Record<string, unknown>)['agent'],
  'agent/inbox/inserted': args => (args[0] as Record<string, unknown>)['agent'],
  'agent/pre-step': args => (args[0] as Record<string, unknown>)['agent'],
  'agent/request': args => (args[0] as Record<string, unknown>)['agent'],
  'agent/request-error': args => (args[0] as Record<string, unknown>)['agent'],
  'agent/session-start': args => (args[0] as Record<string, unknown>)['agent'],
  'agent/status': args => (args[0] as Record<string, unknown>)['agent'],
  'agent/turn-stopping': args => (args[0] as Record<string, unknown>)['agent'],
  'approval/request': args => (args[0] as Record<string, unknown>)['agent'],
  'goal/changed': args => (args[0] as Record<string, unknown>)['agent'],
  'session/created': null,
  'session/disposed': null,
  'session/event': null,
  'session/flush': null,
  'subagent/end': null,
  'subagent/start': null,
  'system-prompt/assemble': args => (args[1] as Record<string, unknown>)['scope'],
  'tools/code-dispatch-log': args => (args[0] as Record<string, unknown>)['agent'],
  'tools/execute': args => (args[0] as Record<string, unknown>)['agent'],
  'tools/post-execute': args => (args[0] as Record<string, unknown>)['agent'],
  'tools/pre-execute': args => (args[0] as Record<string, unknown>)['agent'],
  'tools/result': args => (args[0] as Record<string, unknown>)['agent'],
})

/**
 * Resolve the routing key named by one scoped event payload. A null
 * resolver means the payload cannot expose its external routing key, so the
 * invariant checks carrier presence only.
 * @param event - runtime Cordis event name.
 * @returns the generated subject resolver, null for presence-only,
 *   or undefined when the event is not scope-filtered.
 */
// 查表入口：invariant.ts 用它在每次分发时判断该事件是否作用域事件、以及如何解析主体。
export function scopedSubjectResolverFor(event: string): ScopedSubjectResolver | null | undefined {
  return scopedSubjectResolvers[event]
}
