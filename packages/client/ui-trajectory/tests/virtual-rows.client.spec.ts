/** Measurable virtual-row grouping and durable identity contracts. */
/*
 * 文件职责：验证运行轨迹的 virtual-rows.client.spec.ts 行为。
 * 技术维度：Vitest、React 渲染、虚拟列表和服务替身。
 * 产品维度：防止运行轨迹展示与操作流程回归。
 * 逻辑维度：构造状态，触发交互并断言输出和清理。
 * 关键边界：计时器、观察器、DOM 尺寸和异步请求必须恢复。
 * 新手阅读建议：先读夹具，再按加载、交互和异常场景阅读。
 */

import { describe, expect, it } from 'vitest'
import type { TrajectoryCellProps } from '../src/client/trajectory-record.ts'
import {
  groupTrajectoryVirtualRows, trajectoryVirtualRecordKey,
  /** 中文说明：类型或类 VirtualizableTrajectoryRecord 约束模块数据或组件职责。 */
  type VirtualizableTrajectoryRecord,
} from '../src/client/trajectory-virtual-rows.ts'

/** 中文说明：函数 record 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function record(
  index: number,
  cell: Partial<TrajectoryCellProps> = {},
  collapsedSummaryKind?: 'turn' | 'assistant',
): VirtualizableTrajectoryRecord {
  return {
    cell: {
      index,
      kind: 'message',
      text: `record ${index}`,
      timeSeconds: 0,
      ...cell,
    },
    ...(collapsedSummaryKind === undefined ? {} : { collapsedSummaryKind }),
  }
}

describe('trajectory virtual rows', () => {
  it('groups zero-height request boundaries with the following content row', () => {
    /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
    const first = record(1, { requestOnly: true, sourceSeq: 10 })
    /** 中文说明：测试局部值 second，由紧邻初始化决定。 */
    const second = record(2, { requestOnly: true, sourceSeq: 11 })
    /** 中文说明：测试局部值 content，由紧邻初始化决定。 */
    const content = record(3, { sourceSeq: 12 })

    expect(groupTrajectoryVirtualRows([first, second, content])).toEqual([{
      entries: [
        { logicalIndex: 0, record: first },
        { logicalIndex: 1, record: second },
        { logicalIndex: 2, record: content },
      ],
      height: 30,
      key: trajectoryVirtualRecordKey(content),
    }])
  })

  it('retains terminal request-boundary clearance as a measurable row', () => {
    /** 中文说明：测试局部值 content，由紧邻初始化决定。 */
    const content = record(1, { sourceSeq: 10 })
    /** 中文说明：测试局部值 boundary，由紧邻初始化决定。 */
    const boundary = record(2, { requestOnly: true, sourceSeq: 11 })
    /** 中文说明：测试局部值 rows，由紧邻初始化决定。 */
    const rows = groupTrajectoryVirtualRows([content, boundary])

    expect(rows).toHaveLength(2)
    expect(rows[1]).toEqual({
      entries: [{ logicalIndex: 1, record: boundary }],
      height: 9,
      key: trajectoryVirtualRecordKey(boundary),
    })
  })

  it('uses the rendered collapsed-summary height', () => {
    /** 中文说明：测试局部值 summary，由紧邻初始化决定。 */
    const summary = record(1, { sourceSeq: 10 }, 'turn')

    expect(groupTrajectoryVirtualRows([summary])[0]?.height).toBe(20)
  })

  it('keeps an existing row key stable when older history is prepended', () => {
    /** 中文说明：测试局部值 existing，由紧邻初始化决定。 */
    const existing = record(2, { sourceSeq: 100 })
    /** 中文说明：测试局部值 prepended，由紧邻初始化决定。 */
    const prepended = record(1, { sourceSeq: 10 })

    /** 中文说明：测试局部值 before，由紧邻初始化决定。 */
    const before = groupTrajectoryVirtualRows([existing])[0]?.key
    /** 中文说明：测试局部值 after，由紧邻初始化决定。 */
    const after = groupTrajectoryVirtualRows([prepended, existing])[1]?.key

    expect(after).toBe(before)
  })

  it('keeps the content key when a request boundary joins its row', () => {
    /** 中文说明：测试局部值 content，由紧邻初始化决定。 */
    const content = record(2, { sourceSeq: 100 })
    /** 中文说明：测试局部值 boundary，由紧邻初始化决定。 */
    const boundary = record(1, { requestOnly: true, sourceSeq: 99 })

    expect(groupTrajectoryVirtualRows([boundary, content])[0]?.key)
      .toBe(groupTrajectoryVirtualRows([content])[0]?.key)
  })

  it('distinguishes a folded summary from its source record', () => {
    /** 中文说明：测试局部值 source，由紧邻初始化决定。 */
    const source = record(1, { sourceSeq: 10 })
    /** 中文说明：测试局部值 summary，由紧邻初始化决定。 */
    const summary = record(1, { sourceSeq: 10 }, 'assistant')

    expect(trajectoryVirtualRecordKey(summary)).not.toBe(trajectoryVirtualRecordKey(source))
  })

  it('exposes a DOM-safe semantic key', () => {
    /** 中文说明：测试局部值 source，由紧邻初始化决定。 */
    const source = record(1, { callId: 'call with spaces/and?punctuation' })

    expect(trajectoryVirtualRecordKey(source)).toBe(
      'message%00call%00call%20with%20spaces%2Fand%3Fpunctuation',
    )
  })
})
