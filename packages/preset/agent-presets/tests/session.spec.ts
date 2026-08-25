/**
 * Which preset a session ran is a question about its LOG, not its header: the
 * header records the creation-time choice, and a switch made during the blank
 * window is an event. Every reconstruction — the list row, the header label,
 * resume, fork — goes through this resolver, so a resolver that read the header
 * alone would rebuild a switched session under a composition its own history
 * contradicts.
 */
/*
 * 文件职责：验证 session.spec.ts 覆盖的 Agent 预设发现、装载与会话行为。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件上下文和临时配置目录。
 * 产品维度：保障用户选择的 Agent 预设能稳定生效并保持会话一致。
 * 逻辑维度：准备预设配置，装载插件，触发会话流程，再核对状态与错误。
 * 关键边界：配置来源和优先级必须明确；临时资源必须在用例结束时释放。
 * 新手阅读建议：先看夹具与辅助函数，再按发现、装载、会话顺序阅读用例。
 */

import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { resolveSessionPreset } from '../src/session.ts'

/** A header carrying the creation-time preset, if any. */
/* 中文说明：函数 header 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function header(agentPreset?: string): SessionHeader {
  return {
    version: 0,
    id: SessionId('s'),
    createdAt: 1,
    delegationDepth: 0,
    ...agentPreset === undefined ? {} : { agentPreset },
  }
}

/** One logged selection, as `agentPreset.select` appends it. */
/* 中文说明：函数 selected 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function selected(agentPreset: string, seq: number): SessionEvent {
  return { type: 'agent-preset/selected', seq, time: seq, data: { agentPreset } }
}

describe('resolving which preset a session ran', () => {
  it('reads the creation-time value when nothing was switched', () => {
    expect(resolveSessionPreset({ header: header('standard'), events: [] })).toBe('standard')
  })

  it('prefers a logged switch over the header', () => {
    // The switch's effect outlives the blank window it was made in: the turns
    // that follow run under the newer composition.
    expect(resolveSessionPreset({ header: header('standard'), events: [selected('minimal', 0)] }))
      .toBe('minimal')
  })

  it('takes the last switch when a session was moved twice', () => {
    expect(resolveSessionPreset({
      header: header('standard'),
      events: [selected('minimal', 0), selected('cordis', 1)],
    })).toBe('cordis')
  })

  it('finds a switch behind later events', () => {
    /** 中文说明：变量 later 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const later = { type: 'turn/end', seq: 2, time: 2, data: { turn: 1 } } as SessionEvent

    expect(resolveSessionPreset({ header: header(), events: [selected('minimal', 0), later] }))
      .toBe('minimal')
  })

  it('reports none when the deployment composes no presets', () => {
    // A valid deployment: every session shares the host composition, and no
    // surface should invent a preset name for it.
    expect(resolveSessionPreset({ header: header(), events: [] })).toBeUndefined()
  })
})
