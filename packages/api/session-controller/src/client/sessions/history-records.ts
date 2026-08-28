/** Client range access and type narrowing for aligned Session history records.
 * @remarks 文件说明：文件职责：实现 api/session-controller 中 history records 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * api/session-controller 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type {
  SessionHistoryRecord,
} from '../../types.ts'
import type { SessionEventLikeEntry } from '../contract/events.ts'

/**
 * Narrow aligned wire records to their Client event types without allocation.
 * @param records - validated history transport records.
 * @returns the same record array with typed inner events.
 * @remarks 中文说明：功能说明：处理 historyEntries 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：records（readonly SessionHistoryRecord[]）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：readonly SessionEventLikeEntry[]；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 historyEntries(records)，并按返回类型处理结果。
 */
export function historyEntries(
  records: readonly SessionHistoryRecord[],
): readonly SessionEventLikeEntry[] {
  return records as unknown as readonly SessionEventLikeEntry[]
}

/**
 * Read the first logical sequence represented by one wire record.
 * @param record - validated scalar event or packed Assistant delta run.
 * @returns inclusive first Session sequence.
 * @remarks 中文说明：功能说明：处理 historyRecordFirstSeq 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：record（SessionHistoryRecord）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：number；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * historyRecordFirstSeq(record)，并按返回类型处理结果。
 */
export function historyRecordFirstSeq(record: SessionHistoryRecord): number {
  return record.event.seq
}

/**
 * Read the final logical sequence represented by one wire record.
 * @param record - validated scalar event or packed Assistant delta run.
 * @returns inclusive final Session sequence.
 * @remarks 中文说明：功能说明：处理 historyRecordLastSeq 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：record（SessionHistoryRecord）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：number；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * historyRecordLastSeq(record)，并按返回类型处理结果。
 */
export function historyRecordLastSeq(record: SessionHistoryRecord): number {
  if (record.type === 'event') return record.event.seq
  /**
   * 常量说明：length 用于处理 length 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const length = record.event.type === 'chunkrow/tool-call-chunks'
    ? record.event.data.args.length
    : record.event.data.texts.length
  return record.event.seq + length - 1
}
