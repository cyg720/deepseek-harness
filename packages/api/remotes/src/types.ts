/*
 * ================================ 文件注释 ================================
 * 【文件职责】提供"转发 Host 事件白名单"的类型面孔：把白名单的取值
 * （API_REMOTE_FORWARDED_EVENTS，定义在 remote-events.ts）投影成联合类型
 * ApiRemoteForwardedEvent，并把它填进 typert-protocol 的
 * TypertRemoteEventSelection 座位，从而约束客户端 ctx.remote.$on 可订阅
 * 的事件集合。
 * 【技术维度】纯类型文件（type-only）：用 typeof 数组元素推导联合类型；
 * 用 declare module 声明合并扩充 TypertRemoteEventSelection 接口；为了让
 * 两个编译面（Host 面与消费者面）共享同一份声明，本文件不包含任何运行时代码。
 * 【产品维度】白名单是"Host 事件 → 消费者可见事件"的唯一控制点：消费者
 * 只能 $on 到这里列出的 Host 事件，防止意外暴露内部事件；本文件让该控制
 * 点的类型约束在编译期就生效。
 * 【逻辑维度】按出现顺序：类型投影 ApiRemoteForwardedEvent（由白名单数组
 * 推导）→ 声明合并块（把每个允许事件标记进 TypertRemoteEventSelection）。
 * 【关键边界】本文件只含类型，白名单的值必须维护在 remote-events.ts 中；
 * 两个编译面都必须把这两个文件都列入编译范围，声明才不会漂移。
 * 【新手阅读建议】先看 remote-events.ts 理解白名单是什么，再看
 * TypertRemoteEventSelection 的扩充如何让 $on 的键集合"恰好等于"白名单。
 * ==========================================================================
 */
/**
 * Type face of the forwarded-Host-event allowlist: the consumer key projection
 * and the selection seat it fills. The allowlist VALUE lives in
 * `./remote-events.ts`, keeping this module type-only per the package
 * convention; both compiler faces list both files, so the Host forwarding loop
 * and the consumer `ctx.remote.$on` key face read one declaration instead of
 * two copies that could drift.
 *
 * @module @deepseek-ai/dsh-api-remotes/types
 */
// 英文模块注释的中文解释：本文件是"转发 Host 事件白名单"的类型面孔：既是
// 消费者端可订阅事件的键投影，也填进类型选择座位。白名单的"值"住在
// remote-events.ts 里，使本模块保持纯类型；Host 转发循环与消费者 $on 的
// 键面都读同一份声明，避免两份拷贝漂移。

import type { API_REMOTE_FORWARDED_EVENTS } from './remote-events.ts'

/** Type projection of the allowlist; the consumer and the Host read this one. */
// 中文：白名单的类型投影——由数组常量推导出的联合类型（每个事件名是一个
// 字面量），消费者与 Host 两侧都读这一份。
export type ApiRemoteForwardedEvent = typeof API_REMOTE_FORWARDED_EVENTS[number]

// 中文：声明合并：把每个允许转发的事件名标记进 TypertRemoteEventSelection，
// 使 typert 协议层知道"这些事件对消费者可见"，$on 的键集合与白名单绑定。
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteEventSelection extends Record<ApiRemoteForwardedEvent, true> {}
}
