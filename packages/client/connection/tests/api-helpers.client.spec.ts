/**
 * Contract-layer helpers: transport-error folding and response unwrapping.
 * (The assistant block classifier half of the legacy spec lives in
 * runtime/tests — the classifier moved there.)
 */
/**
 * 文件职责：验证客户端 API 层把传输异常折叠为统一错误，并从 RPC 包装中解出结果。
 * 技术维度：使用 Vitest 对 Error、非 Error 值和品牌化 RPC 标识执行纯函数测试。
 * 产品维度：让界面收到稳定的成功或失败结果，不直接依赖底层传输抛出的任意值。
 * 逻辑维度：transportError 组覆盖异常标准化；resultOf 组覆盖结果槽的透明解包。
 * 关键边界：助手块分类器已迁移到 runtime 测试；本文件不发起真实网络请求。
 * 新手阅读建议：先比较两个 transportError 输入的输出差异，再看 resultOf 为何忽略 rpcId。
 */

import { describe, expect, it } from 'vitest'
import { RpcId, resultOf, transportError } from '../src/client/api.ts'

// 测试组：覆盖任意传输失败值到内部错误结果的转换。
describe('transportError', () => {
  /**
   * 功能描述：确认 Error 保留 message，其他抛出值通过字符串化进入统一错误结构。
   * 参数说明：测试回调不接收参数。
   * 返回值解释：无返回值；错误结构不匹配时由 Vitest 报错。
   * 使用示例：new Error('线断了') 应变为 code 为 internal 的失败结果。
   */
  it('folds an Error to internal keeping the message, and stringifies non-Errors', () => {
    expect(transportError(new Error('线断了'))).toEqual({ ok: false, error: { code: 'internal', message: '线断了', details: {} } })
    expect(transportError('raw string')).toMatchObject({ ok: false, error: { message: 'raw string' } })
  })
})

// 测试组：覆盖 RPC 关联包装中的结果槽解包。
describe('resultOf', () => {
  /**
   * 功能描述：确认 resultOf 返回包装对象中的 result，而不改变成功值。
   * 参数说明：测试回调不接收参数。
   * 返回值解释：无返回值；解包结果不相等时由 Vitest 报错。
   * 使用示例：值为 7 的成功结果应原样返回 { ok: true, value: 7 }。
   */
  it('unwraps the result slot', () => {
    expect(resultOf({ rpcId: RpcId('r'), result: { ok: true, value: 7 } })).toEqual({ ok: true, value: 7 })
  })
})
