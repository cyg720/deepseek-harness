/**
 * flattenLineage: root ordering, DFS child expansion, orphan degradation, and
 * cycle fail-soft (every entry always emitted, no infinite walk).
 */
/*
 * 文件职责：验证会话分叉和父子关系在客户端状态中的投影与更新。
 * 技术维度：Vitest、品牌会话标识、事件脚本和会话管理状态。
 * 产品维度：让用户能辨认当前会话来源并在分叉后保持正确导航关系。
 * 逻辑维度：构造包含谱系信息的会话或事件，装载状态，再断言父子引用和变化。
 * 关键边界：谱系标识必须属于对应会话；缺失关系与空关系不能被混为同一状态。
 * 新手阅读建议：先看测试数据中的父子标识，再比较初始加载和事件更新后的断言。
 */

import { describe, expect, it, vi } from 'vitest'
import type { SessionId, SessionSummary } from '@deepseek-ai/dsh-api-remotes/client'
import { flattenLineage } from '../src/client/sessions/lineage.ts'

/** 中文说明：当前测试场景使用的局部状态或中间值；变量 `s` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
const s = (id: string, updatedAt: number, parent?: string): SessionSummary => ({
  sessionId: id as SessionId, updatedAt, running: false, blank: false,
  ...(parent !== undefined ? { parentSessionId: parent as SessionId } : {}),
})

describe('Session lineage flattening', () => {
  it('keeps established root and sibling order while expanding children DFS with depth', () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `out` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const out = flattenLineage([
      s('old-root', 10),
      s('new-root', 30),
      s('kid-old', 11, 'new-root'),
      s('kid-new', 12, 'new-root'),
      s('grandkid', 5, 'kid-new'),
    ])
    expect(out.map(e => [e.sessionId, e.depth])).toEqual([
      ['old-root', 0], ['new-root', 0], ['kid-old', 1], ['kid-new', 1], ['grandkid', 2],
    ])
  })

  it('degrades an orphan (absent parent) to root level without dropping it', () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `out` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const out = flattenLineage([s('orphan', 20, 'ghost-parent'), s('root', 10)])
    expect(out.map(e => [e.sessionId, e.depth])).toEqual([['orphan', 0], ['root', 0]])
  })

  it('fails soft on a two-node cycle: all entries emitted, warn fired, no hang', () => {
    /** 中文说明：记录或模拟当前失败路径的信息；变量 `warnSpy` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `out` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      const out = flattenLineage([s('a', 20, 'b'), s('b', 10, 'a'), s('root', 30)])
      expect(out.map(e => e.sessionId).sort()).toEqual(['a', 'b', 'root'])
      expect(warnSpy).toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('handles a self-referencing entry as a cycle member', () => {
    /** 中文说明：记录或模拟当前失败路径的信息；变量 `warnSpy` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `out` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      const out = flattenLineage([s('self', 10, 'self')])
      expect(out.map(e => e.sessionId)).toEqual(['self'])
      expect(out[0]?.depth).toBe(0)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('projects the completion-reminder set into rows (absent = false)', () => {
    const out = flattenLineage([s('a', 10), s('b', 20)], new Set(['b' as SessionId]))
    expect(out.find(e => e.sessionId === 'a')?.completed).toBe(false)
    expect(out.find(e => e.sessionId === 'b')?.completed).toBe(true)
    expect(flattenLineage([s('a', 10)])[0]?.completed).toBe(false)
  })
})
