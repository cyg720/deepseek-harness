import { describe, expect, it } from 'vitest'
import type { SessionId, SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'
import { indexSubagentDescendants } from '@deepseek-ai/dsh-client-runtime/client'

/** 中文：把普通字符串标记为 SessionId；参数 id 原样返回，仅用于测试构造。 */
const sid = (id: string) => id as SessionId

/** 中文：创建最小会话摘要；可指定父会话、子代理来源和运行状态，返回 SessionSummary。 */
function summary(
  id: string,
  parentId?: SessionId,
  origin?: 'subagent',
  running = false,
): SessionSummary {
  return {
    id: sid(id), displayTitle: id, running, blank: false, updatedAt: 0,
    ...(parentId === undefined ? {} : { parentId }),
    ...(origin === undefined ? {} : { origin }),
  }
}

/** 中文：把摘要列表转为 id 索引并计算子代理后代统计；返回 Map。 */
function index(...summaries: SessionSummary[]) {
  return indexSubagentDescendants(Object.fromEntries(
    summaries.map(item => [item.id, item]),
  ))
}

/** 中文：indexSubagentDescendants 会话谱系统计测试组。 */
describe('indexSubagentDescendants', () => {
  /** 中文：多级子代理应向每个祖先累计总数与精确运行数；无参数和返回值。 */
  it('counts every nested descendant and its exact running state', () => {
    /** 顶层拥有者会话。 */
    const owner = summary('owner')
    /** owner 的直接子代理。 */
    const child = summary('child', owner.id, 'subagent')
    /** child 下正在运行的子代理。 */
    const grandchild = summary('grandchild', child.id, 'subagent', true)

    /** 正常三层谱系的统计结果。 */
    const result = index(owner, child, grandchild)
    expect(result.get(owner.id)).toEqual({ count: 2, runningCount: 1 })
    expect(result.get(child.id)).toEqual({ count: 1, runningCount: 1 })
  })

  /** 中文：普通 fork 截断归属，缺父和循环仍返回有限统计；无参数和返回值。 */
  it('stops at ordinary forks and fails soft on cycles and missing parents', () => {
    /** 顶层拥有者会话。 */
    const owner = summary('owner')
    /** owner 下运行中的子代理。 */
    const child = summary('child', owner.id, 'subagent', true)
    /** 非子代理来源的普通 fork，会截断向 owner 的传播。 */
    const fork = summary('fork', child.id)
    /** fork 下运行中的子代理。 */
    const forkChild = summary('fork-child', fork.id, 'subagent', true)
    /** 父会话缺失的孤儿子代理。 */
    const orphan = summary('orphan', sid('missing'), 'subagent', true)
    /** 循环关系的第一个会话。 */
    const cycleA = summary('cycle-a', sid('cycle-b'), 'subagent')
    /** 循环关系的第二个会话。 */
    const cycleB = summary('cycle-b', sid('cycle-a'), 'subagent')

    /** 包含截断、孤儿和循环输入的统计结果。 */
    const result = index(owner, child, fork, forkChild, orphan, cycleA, cycleB)
    expect(result.get(owner.id)).toEqual({ count: 1, runningCount: 1 })
    expect(result.get(fork.id)).toEqual({ count: 1, runningCount: 1 })
    expect(result.get(sid('missing'))).toEqual({ count: 1, runningCount: 1 })
    expect(result.get(cycleA.id)).toEqual({ count: 2, runningCount: 0 })
    expect(result.get(cycleB.id)).toEqual({ count: 2, runningCount: 0 })
  })
})
/**
 * 中文说明：
 * - 文件职责：验证客户端对子代理后代数量和运行中数量的索引计算。
 * - 技术维度：使用 Vitest、品牌 SessionId、扁平 SessionSummary 表和祖先遍历。
 * - 产品维度：为会话树准确显示嵌套子代理数量与活跃状态，同时容忍不完整日志关系。
 * - 逻辑维度：辅助函数构造摘要和索引，测试正常多级后代以及普通 fork、孤儿和环。
 * - 关键边界：只有 origin=subagent 的边继续向上归属；缺失父级和循环应软失败而不抛错。
 * - 新手阅读建议：先看 summary 如何编码 parentId/origin，再画出两个用例中的会话关系图。
 */
