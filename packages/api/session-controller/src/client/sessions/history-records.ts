/*
 * 【文件职责】提供历史记录的范围读取和类型收窄；
 * 已验证的传输数组保持原引用，避免逐条复制。
 */

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
 * @param record - validated Session event.
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
 * @param record - validated Session event.
 * @returns inclusive final Session sequence.
 * @remarks 中文说明：功能说明：处理 historyRecordLastSeq 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：record（SessionHistoryRecord）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：number；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * historyRecordLastSeq(record)，并按返回类型处理结果。
 */
export function historyRecordLastSeq(record: SessionHistoryRecord): number {
  return record.event.seq
}
