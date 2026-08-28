/**
 * 文件职责：验证 api/session-controller 中 client contract client spec 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { describe, expect, it, vi } from 'vitest'
import {
  MutableSessionEventSource, type SessionLiveEventEntry,
} from '../src/client/contract/events.ts'
import { transportResult } from '../src/client/contract/result.ts'

/**
 * 功能说明：处理 entry 相关流程；使用场景由所在模块及调用位置决定。
 * @param seq （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns SessionLiveEventEntry；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 entry(seq)，并按返回类型处理结果。
 */
function entry(seq: number): SessionLiveEventEntry {
  return {
    type: 'event',
    event: {
      type: 'turn/start',
      seq,
      time: seq,
      data: { turn: seq },
    },
  }
}

describe('Client Session contracts', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
    it('publishes exact replace, prepend, and append event-window changes', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
        /**
     * 常量说明：feed 用于处理 feed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const feed = new MutableSessionEventSource()
        /**
     * 常量说明：listener 用于处理 listener 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const listener = vi.fn()
        /**
     * 常量说明：dispose 用于处理 dispose 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const dispose = feed.subscribe(listener)
        /**
     * 常量说明：first 用于处理 first 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const first = entry(1)
        /**
     * 常量说明：older 用于处理 older 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const older = entry(0)
        /**
     * 常量说明：live 用于处理 live 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const live = entry(2)

        feed.replace([first], true)
        expect(feed.getSnapshot()).toEqual({
          entries: [first],
          hasMore: true,
          revision: 1,
          change: { kind: 'replace', entries: [first] },
        })

        feed.prepend([older], false)
        expect(feed.getSnapshot()).toEqual({
          entries: [older, first],
          hasMore: false,
          revision: 2,
          change: { kind: 'prepend', entries: [older] },
        })

        feed.append(live)
        expect(feed.getSnapshot()).toEqual({
          entries: [older, first, live],
          hasMore: false,
          revision: 3,
          change: { kind: 'append', entries: [live] },
        })
        expect(listener).toHaveBeenCalledTimes(3)

        dispose()
        feed.append(entry(3))
        expect(listener).toHaveBeenCalledTimes(3)
      })

    it('does not traverse the complete event window while appending', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
        /**
     * 常量说明：feed 用于处理 feed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const feed = new MutableSessionEventSource()
        /**
     * 常量说明：first 用于处理 first 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const first = entry(1)
        /**
     * 常量说明：base 用于处理 base 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const base = [first]
        /**
     * 常量说明：iterate 用于处理 iterate 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const iterate = vi.fn(Array.prototype[Symbol.iterator].bind(base))
        Object.defineProperty(base, Symbol.iterator, { value: iterate })
        feed.replace(base, false)
        iterate.mockClear()

        /**
     * 常量说明：before 用于处理 before 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const before = feed.getSnapshot()
        /**
     * 常量说明：live 用于处理 live 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const live = entry(2)
        feed.append(live)
        /**
     * 常量说明：after 用于处理 after 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const after = feed.getSnapshot()

        expect(iterate).not.toHaveBeenCalled()
        expect(before.entries).toEqual([first])
        expect(after.entries).toEqual([first, live])
        expect(after.entries).toBe(after.entries)
        expect(iterate).toHaveBeenCalledOnce()
      })

    it('folds Error and non-Error carrier rejections into Client failures', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
        expect(transportResult(new Error('transport unavailable'))).toEqual({
          ok: false,
          error: { code: 'internal', message: 'transport unavailable', details: {} },
        })
        expect(transportResult(404)).toEqual({
          ok: false,
          error: { code: 'internal', message: '404', details: {} },
        })
      })
  })
