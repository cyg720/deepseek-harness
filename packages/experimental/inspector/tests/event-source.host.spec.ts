/** Consumer-neutral Server-Sent Event parsing behavior.
 * @remarks 文件说明：文件职责：验证 experimental/inspector 中 event source host spec
 * 相关行为与失败场景。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import { describe, expect, it } from 'vitest'
import { InspectorEventSourceParser } from '../src/shared/network/event-source.ts'

/**
 * 常量说明：encoder 用于处理 encoder 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const encoder = new TextEncoder()

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('InspectorEventSourceParser', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('preserves parser state across chunks, CRLF boundaries, and UTF-8 boundaries', () => {
    /**
     * 常量说明：parser 用于处理 parser 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const parser = new InspectorEventSourceParser()
    expect(parser.push(encoder.encode(': ignored\rid:first\revent: update\rdata: one\r'))).toEqual([])

    /**
     * 常量说明：unicode 用于处理 unicode 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const unicode = encoder.encode('\ndata: two 你\r\n\r\n')
    /**
     * 常量说明：split 用于处理 split 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const split = unicode.indexOf(0xe4) + 1
    expect(parser.push(unicode.subarray(0, split))).toEqual([])
    expect(parser.push(unicode.subarray(split))).toEqual([{
      eventName: 'update',
      eventId: 'first',
      data: 'one\ntwo 你',
    }])
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('retains valid ids, ignores comments and unknown fields, and emits empty data', () => {
    /**
     * 常量说明：parser 用于处理 parser 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const parser = new InspectorEventSourceParser()
    expect(parser.push(encoder.encode('retry: 1000\nunknown\n\n'))).toEqual([])
    expect(parser.push(encoder.encode('id: stable\ndata: value\n\nid: bad\0id\ndata:\n\n'))).toEqual([
      { eventName: 'message', eventId: 'stable', data: 'value' },
      { eventName: 'message', eventId: 'stable', data: '' },
    ])
  })
})
