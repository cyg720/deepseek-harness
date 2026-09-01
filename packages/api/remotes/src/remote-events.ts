/**
 * The one home of this application's forwarded-Host-event allowlist. Both
 * compiler faces list this file, so the Host forwarding loop and the consumer
 * `ctx.remote.$on` key face read one declaration instead of two copies that
 * could drift; `./types.ts` derives the type projection from it and stays
 * type-only.
 */

/*
 * ================================ 文件注释 ================================
 * 【文件职责】定义本应用"转发 Host 事件白名单"的唯一事实来源：
 * API_REMOTE_FORWARDED_EVENTS 数组列出所有允许从 Host 转发给远程消费者的
 * Cordis 事件名。
 * 【技术维度】一个 as const 数组常量：既作为运行时的转发控制列表（Host
 * 转发循环遍历它），又作为编译期的类型来源（types.ts 从中推导联合类型）。
 * 【产品维度】白名单是"消费者能看到哪些 Host 事件"的唯一开关：加一个新
 * 事件只需在此数组加一项，无需改动转发循环或类型代码，保证转发行为与
 * 类型约束同源不漂移。
 * 【逻辑维度】模块注释 → 白名单数组（11 个事件名，涵盖 agent 预设、命令、
 * 凭据、cordis 运行态、llm 适配器、设置等主题）。
 * 【关键边界】事件按"原名转发"：不做投影、不打码、不改名；线上事件名即
 * Host cordis 事件名，载荷即其参数列表。该数组同时是 ctx.remote.$on 的
 * 合法键集合，因此也是消费者的全部可订阅范围。
 * 【新手阅读建议】先读数组里的每个事件名，对照对应插件了解事件含义；再读
 * index.ts 顶部的 shape 门检查（satisfies）理解"白名单如何被静态校验"。
 * ==========================================================================
 */

import type {} from '@deepseek-ai/dsh-api-session-controller/remote-events'
import type { TypertForwardableEventEntry } from '@deepseek-ai/dsh-typert-protocol'

/**
 * Host events this application forwards without renaming. The explicit mode is
 * both the Host dispatch strategy and the legal key set of `ctx.remote.$on`.
 */
export const API_REMOTE_FORWARDED_EVENTS = [
  { event: 'agent-preset/selected', mode: 'emit' },
  { event: 'approval/request', mode: 'waterfall' },
  { event: 'api-session/activity', mode: 'emit' },
  { event: 'api-session/added', mode: 'emit' },
  { event: 'api-session/error', mode: 'emit' },
  { event: 'api-session/removed', mode: 'emit' },
  { event: 'api-session/status', mode: 'emit' },
  { event: 'commands/change', mode: 'emit' },
  { event: 'credentials/reference-updated', mode: 'emit' },
  { event: 'cordis/request-run', mode: 'emit' },
  { event: 'cordis/request-run-resolved', mode: 'emit' },
  { event: 'cordis/dynamic-package', mode: 'emit' },
  { event: 'cordis/dynamic-retract', mode: 'emit' },
  { event: 'cordis/inspect-query', mode: 'emit' },
  { event: 'cordis/inspect-query-resolved', mode: 'emit' },
  { event: 'llm/adapters-updated', mode: 'emit' },
  { event: 'settings/document-updated', mode: 'emit' },
  { event: 'user-questions/request', mode: 'waterfall' },
] as const satisfies readonly TypertForwardableEventEntry[]
