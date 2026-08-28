/** Packed history records become one event-shaped Client value per wire record.
 * @remarks 文件说明：文件职责：验证 api/session-controller 中 history records client
 * spec 相关行为与失败场景。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import { describe, expect, it } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import type { SessionHistoryRecord } from '../src/types.ts'
import {
  historyEntries,
  historyRecordFirstSeq,
  historyRecordLastSeq,
} from '../src/client/sessions/history-records.ts'

describe('Session history record projection', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
    it('retains an ordinary event and its point cursor', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
        /**
     * 常量说明：ordinary 用于处理 ordinary 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const ordinary: SessionHistoryRecord = {
          type: 'event',
          event: { type: 'turn/start', seq: 7, time: 1, data: { turn: 1 } },
        }

        /**
     * 常量说明：records 用于处理 records 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const records = [ordinary]
        /**
     * 常量说明：entry 用于处理 entry 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const [entry] = historyEntries(records)

        expect(historyEntries(records)).toBe(records)
        expect(entry).toBe(ordinary)
        expect(historyRecordFirstSeq(ordinary)).toBe(7)
        expect(entry?.event.time).toBe(1)
        expect(historyRecordLastSeq(ordinary)).toBe(7)
      })

    it('retains one packed text row without copying or reshaping it', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
        /**
     * 常量说明：packed 用于处理 packed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const packed: SessionHistoryRecord = {
          type: 'chunks',
          event: {
            type: 'chunkrow/text-chunks',
            seq: 11,
            time: 20,
            data: { turn: 1, step: 2, index: 0, dt: [1, 2, 3], texts: ['a', 'b', 'c', 'd'] },
          },
        }

        /**
     * 常量说明：entry 用于处理 entry 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const [entry] = historyEntries([packed])
        if (entry?.type !== 'chunks') throw new Error('expected packed history entry')
        /**
     * 常量说明：event 用于处理 event 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const { event } = entry

        expect(entry).toBe(packed)
        expect(event).toBe(packed.event)
        expect(historyRecordFirstSeq(packed)).toBe(11)
        expect(event.time).toBe(20)
        expect(historyRecordLastSeq(packed)).toBe(14)
      })

    it('preserves a packed tool-call row and optional-name absence', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
        /**
     * 常量说明：packed 用于处理 packed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const packed: SessionHistoryRecord = {
          type: 'chunks',
          event: {
            type: 'chunkrow/tool-call-chunks',
            seq: 20,
            time: 200,
            data: {
              turn: 2,
              step: 4,
              index: 1,
              id: ToolCallId('call-1'),
              dt: [2, 3],
              args: ['', '{"x":', '1}'],
            },
          },
        }

        /**
     * 常量说明：entry 用于处理 entry 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const [entry] = historyEntries([packed])
        if (entry?.type !== 'chunks') throw new Error('expected packed history entry')
        /**
     * 常量说明：event 用于处理 event 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const { event } = entry

        if (event.type !== 'chunkrow/tool-call-chunks') throw new Error('expected packed history event')
        expect(event).toBe(packed.event)
        expect(Object.hasOwn(event.data, 'name')).toBe(false)
        expect(historyRecordLastSeq(packed)).toBe(22)
      })
  })
