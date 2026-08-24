import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  ScheduleId,
  createEveryScheduleRecord,
  foldScheduleEvents,
  resolveEveryOccurrence,
} from '../src/domain.ts'

/** 随机测试使用的固定 UTC 创建时间戳，避免受当前时间和时区影响。 */
const BASE = Date.parse('2000-01-01T00:00:00.000Z')

/** 中文：构造最小 schedule/change 事件；data 是事件数据，seq 是顺序号，返回会话事件。 */
function event(data: unknown, seq: number): SessionEvent {
  return { type: 'schedule/change', seq, time: BASE, data } as SessionEvent
}

/** 中文：固定频率重复日程的属性测试组。 */
describe('fixed-rate recurrence properties', () => {
  /** 中文：对 300 组随机输入比较即时计算与持久折叠；无参数和返回值。 */
  it('keeps latest-only runtime calculation and durable folding on the creation anchor', () => {
    fc.assert(fc.property(
      fc.integer({ min: 300, max: 86_400 }),
      fc.integer({ min: 0, max: 10_000 }),
      fc.nat({ max: 86_399_999 }),
      (everySeconds, skipped, rawOffset) => {
        /** 以 BASE 为锚点创建的随机周期日程记录。 */
        const record = createEveryScheduleRecord(
          ScheduleId('schedule-property'),
          'property reminder',
          everySeconds,
          BASE,
        )
        /** 周期的毫秒数。 */
        const interval = everySeconds * 1_000
        /** 记录中的首次计划时间戳。 */
        const target = Date.parse(record.scheduledAt)
        /** 模拟调度器实际接受任务的时间，位于随机跳过后的某个周期内。 */
        const accepted = target + skipped * interval + rawOffset % interval
        /** 运行时根据接受时间算出的本次和下次计划。 */
        const calculated = resolveEveryOccurrence(record, accepted)
        /** 仍锚定创建时间的当前周期 ISO 时间。 */
        const expectedOccurrence = new Date(target + skipped * interval).toISOString()
        /** 下一周期的预期 ISO 时间。 */
        const expectedNext = new Date(target + (skipped + 1) * interval).toISOString()
        expect(calculated).toEqual({
          occurrenceAt: expectedOccurrence,
          nextScheduledAt: expectedNext,
        })

        /** 创建和派发事件折叠后的日程状态。 */
        const folded = foldScheduleEvents([
          event({ version: 1, operation: 'create', schedule: record }, 0),
          event({
            version: 1,
            operation: 'dispatch',
            id: record.id,
            acceptedAt: new Date(accepted).toISOString(),
          }, 1),
        ])
        expect(folded.active).toEqual([{ ...record, scheduledAt: expectedNext }])
      },
    ), { numRuns: 300 })
  })
})
/**
 * 中文说明：
 * - 文件职责：用属性测试验证固定频率日程的运行时计算与持久事件折叠始终共用创建锚点。
 * - 技术维度：使用 Vitest、fast-check 随机输入、ISO 时间和会话事件折叠。
 * - 产品维度：防止周期提醒因延迟执行而逐次漂移，确保错过多次后仍回到原始节拍。
 * - 逻辑维度：随机生成周期、跳过次数和周期内偏移，计算本次与下次时间，再用事件回放交叉验证。
 * - 关键边界：周期范围为 300 至 86400 秒；固定执行 300 组随机样本，不覆盖日历型重复规则。
 * - 新手阅读建议：先看 target/interval/accepted 三者关系，再对照 calculated 与 folded 的期望时间。
 */
