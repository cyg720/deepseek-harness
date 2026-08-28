/** Runtime validation for Connection RPC envelopes.
 * @remarks 文件说明：文件职责：实现 client/connection 中 rpc schema 模块的职责，并向相邻模块提供可复用能力。
 * ；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的 client/connection 能力，
 * 使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import { z } from 'zod'
import type { ClientRequest, RpcId, RpcMessage, ServerResponse } from './rpc.ts'

/** Correlation id after wire validation.
 * @remarks 中文说明：常量说明：rpcIdSchema 用于处理 rpcIdSchema 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const rpcIdSchema = z.string() as unknown as z.ZodType<RpcId>

/** Generic endpoint failure carried in a response envelope.
 * @remarks 中文说明：常量说明：rpcErrorSchema 用于处理 rpcErrorSchema 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const rpcErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.string(), z.unknown()),
})

/**
 * Build the result parser for one endpoint value parser.
 * @param value - endpoint-owned success-value parser.
 * @returns parser for either a success value or generic failure.
 * @remarks 中文说明：功能说明：处理 rpcResultSchema 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（z.ZodType<T>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：z.ZodType<{
 * readonly ok: true readonly value: T } | { readonly ok: fa…；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 rpcResultSchema(value)，并按返回类型处理结果。
 */
export function rpcResultSchema<T>(value: z.ZodType<T>): z.ZodType<{
  readonly ok: true
  readonly value: T
} | {
  readonly ok: false
  readonly error: z.infer<typeof rpcErrorSchema>
}> {
  return z.union([
    z.object({ ok: z.literal(true), value }),
    z.object({ ok: z.literal(false), error: rpcErrorSchema }),
  ])
}

/** Client request envelope; endpoint payload validation belongs to its owner.
 * @remarks 中文说明：常量说明：clientRequestSchema 用于处理 clientRequestSchema 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const clientRequestSchema = z.object({
  type: z.literal('client-request'),
  rpcId: rpcIdSchema,
  method: z.string(),
  payload: z.unknown(),
}) as z.ZodType<ClientRequest>

/** Server response envelope; endpoint value validation belongs to its caller.
 * @remarks 中文说明：常量说明：serverResponseSchema 用于处理 serverResponseSchema 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const serverResponseSchema = z.object({
  type: z.literal('server-response'),
  rpcId: rpcIdSchema,
  result: rpcResultSchema(z.unknown().optional()),
}) as z.ZodType<ServerResponse>

/** Either Connection RPC envelope direction.
 * @remarks 中文说明：常量说明：rpcMessageSchema 用于处理 rpcMessageSchema 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const rpcMessageSchema = z.discriminatedUnion('type', [
  clientRequestSchema as unknown as z.ZodObject<z.ZodRawShape>,
  serverResponseSchema as unknown as z.ZodObject<z.ZodRawShape>,
]) as unknown as z.ZodType<RpcMessage>
