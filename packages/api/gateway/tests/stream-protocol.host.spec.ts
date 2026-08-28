/**
 * 文件职责：验证 api/gateway 中 stream protocol host spec 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { describe, expect, it } from 'vitest'
import {
  parseRemoteStreamClientMessage,
  parseRemoteStreamServerMessage,
} from '../src/stream-protocol.ts'

describe('Remote stream wire protocol', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
    it('accepts every client message variant', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
        expect(parseRemoteStreamClientMessage(JSON.stringify({
          type: 'open', streamId: 'stream-1', endpoint: 'feed/follow', payload: { cursor: 1 },
        }))).toEqual({
          type: 'open', streamId: 'stream-1', endpoint: 'feed/follow', payload: { cursor: 1 },
        })
        expect(parseRemoteStreamClientMessage(JSON.stringify({
          type: 'cancel', streamId: 'stream-1',
        }))).toEqual({ type: 'cancel', streamId: 'stream-1' })
      })

    it.each([
      { type: 'open', streamId: '', endpoint: 'feed/follow', payload: {} },
      { type: 'open', streamId: 'stream-1', endpoint: '', payload: {} },
      { type: 'open', streamId: 'stream-1', endpoint: 'feed/follow' },
      { type: 'cancel', streamId: 'stream-1', extra: true },
      { type: 'unknown', streamId: 'stream-1' },
    ])('rejects an invalid client message: %j', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：message（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(message)，并按返回类型处理结果。
 */ (message) => {
        expect(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => parseRemoteStreamClientMessage(JSON.stringify(message)))
          .toThrow('api gateway: invalid Remote stream client message')
      })

    it('accepts every server message variant', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
        expect(parseRemoteStreamServerMessage(JSON.stringify({
          type: 'item', streamId: 'stream-1', value: null,
        }))).toEqual({ type: 'item', streamId: 'stream-1', value: null })
        expect(parseRemoteStreamServerMessage(JSON.stringify({
          type: 'item', streamId: 'stream-1',
        }))).toEqual({ type: 'item', streamId: 'stream-1' })
        expect(parseRemoteStreamServerMessage(JSON.stringify({
          type: 'error',
          streamId: 'stream-1',
          error: { code: 'offline', message: 'connection lost', details: {} },
        }))).toEqual({
          type: 'error',
          streamId: 'stream-1',
          error: { code: 'offline', message: 'connection lost', details: {} },
        })
        expect(parseRemoteStreamServerMessage(JSON.stringify({
          type: 'end', streamId: 'stream-1',
        }))).toEqual({ type: 'end', streamId: 'stream-1' })
      })

    it.each([
      { type: 'item', streamId: '', value: 'item' },
      { type: 'item', streamId: 'stream-1', extra: true },
      { type: 'end', streamId: 'stream-1', extra: true },
      { type: 'error', streamId: 'stream-1', error: [] },
      { type: 'error', streamId: 'stream-1', error: { code: 1, message: 'failure', details: {} } },
      { type: 'error', streamId: 'stream-1', error: { code: 'failed', message: 1, details: {} } },
      { type: 'error', streamId: 'stream-1', error: { code: 'failed', message: 'failure', details: [] } },
      { type: 'unknown', streamId: 'stream-1' },
    ])('rejects an invalid server message: %j', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：message（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(message)，并按返回类型处理结果。
 */ (message) => {
        expect(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => parseRemoteStreamServerMessage(JSON.stringify(message)))
          .toThrow('api gateway: invalid Remote stream server message')
      })

    it.each(['not json', 'null', '[]', '1'])('rejects a non-message payload: %s', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：text（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(text)，并按返回类型处理结果。
 */ (text) => {
        expect(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => parseRemoteStreamServerMessage(text)).toThrow('api gateway: Remote stream message')
      })
  })
