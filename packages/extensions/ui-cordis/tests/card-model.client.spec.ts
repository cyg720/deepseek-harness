// Card view model: what a definition card can and cannot derive from the frozen
// call/result slice.
/**
 * 文件职责：验证Cordis 扩展界面的 card-model.client.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis Context、插件生命周期、React 和 Vitest。
 * 产品维度：保证Cordis 扩展界面在配置、运行、失败和清理场景中可理解且可靠。
 * 逻辑维度：构造插件或沙箱，驱动操作并断言日志与清理。
 * 关键边界：沙箱与宿主 Context 不可混用；反馈追加新记录，不改写既有会话历史。
 * 新手阅读建议：先读类型和夹具，再按注册、执行、错误与卸载流程阅读。
 */

import { describe, expect, it } from 'vitest'
import type { RunningToolCall, ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { cordisActionCard, cordisDefineCard } from '../src/client/card-model.ts'

/** 中文说明：测试局部值 ARGS，由紧邻初始化决定。 */
const ARGS = '{"name":"clock","purpose":"顶栏时钟","code":{"client":"return {}","host":"harness.handle(\'now\', () => Date.now())"}}'

/** 中文说明：函数 running 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function running(over: Partial<RunningToolCall> = {}): RunningToolCall {
  return {
    callId: 'call-1', name: 'cordis_define', argsRaw: ARGS, turn: 1, step: 1, time: 1_000,
    subCalls: [], ...over,
  }
}

/** 中文说明：函数 settled 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function settled(over: Partial<ToolResultNode> = {}): ToolResultNode {
  return {
    kind: 'tool-result', seq: 2, time: 2_000, callId: 'call-1',
    call: { name: 'cordis_define', argsRaw: ARGS }, callTime: 1_000,
    content: [{ type: 'text', text: 'defined dyn-1' }], isError: false,
    meta: { pluginId: 'dyn-1', packageId: 'pkg-1' }, subCalls: [], ...over,
  }
}

describe('cordisDefineCard', () => {
  it('reads name, purpose and both code halves off the call arguments', () => {
    /** 中文说明：测试局部值 card，由紧邻初始化决定。 */
    const card = cordisDefineCard(running())
    expect(card).toMatchObject({
      name: 'clock', purpose: '顶栏时钟', clientCode: 'return {}', state: 'running', output: null,
    })
    expect(card.hostCode).toContain('harness.handle')
    // The host mints the id during define, so an unsettled call has none and the
    // card renders read-only.
    expect(card.pluginId).toBeNull()
    expect(card.packageId).toBeNull()
  })

  it('takes the minted id from the result presentation meta', () => {
    expect(cordisDefineCard(settled()).pluginId).toBe('dyn-1')
    expect(cordisDefineCard(settled()).packageId).toBe('pkg-1')
    expect(cordisDefineCard(settled()).output).toBe('defined dyn-1')
    expect(cordisDefineCard(settled()).state).toBe('ok')
  })

  it('renders read-only when the meta carries no usable id', () => {
    expect(cordisDefineCard(settled({ meta: undefined })).pluginId).toBeNull()
    expect(cordisDefineCard(settled({ meta: 'dyn-1' })).pluginId).toBeNull()
    expect(cordisDefineCard(settled({ meta: { pluginId: '' } })).pluginId).toBeNull()
    expect(cordisDefineCard(settled({ meta: { pluginId: 7 } })).pluginId).toBeNull()
  })

  it('classifies the define call’s own lifecycle and never operates a failed one', () => {
    /** 中文说明：测试局部值 failed，由紧邻初始化决定。 */
    const failed = cordisDefineCard(settled({
      isError: true, content: [{ type: 'text', text: 'SyntaxError: unexpected token\n  at line 3' }],
    }))
    expect(failed.state).toBe('error')
    expect(failed.errorSummary).toBe('SyntaxError: unexpected token')
    // A definition that failed to register has nothing to run.
    expect(failed.pluginId).toBeNull()

    expect(cordisDefineCard(settled({ isError: true, error: { name: 'E', code: 'interrupted' } })).state).toBe('stopped')
    expect(cordisDefineCard(settled({ content: [] })).output).toBeNull()
    expect(cordisDefineCard(settled({ content: [], error: { name: 'E', code: 'boom' } })).output).toBe('E: boom')
    // A non-text block has no display text of its own, so the row shows its JSON.
    expect(cordisDefineCard(settled({ content: [{ type: 'reasoning', text: 'weighing it' }] })).output)
      .toContain('"type": "reasoning"')
  })

  it('degrades on a truncated argument stream instead of dropping the row', () => {
    expect(cordisDefineCard(running({ argsRaw: '{"name":"clo' })).name).toBe('{"name":"clo')
    expect(cordisDefineCard(running({ argsRaw: '{"name":"clo' })).purpose).toBeNull()
    expect(cordisDefineCard(running({ argsRaw: '"just a string"' })).name).toBe('"just a string"')
  })

  it('keeps the raw first line as the name when the arguments carry none', () => {
    expect(cordisDefineCard(running({ argsRaw: '{"purpose":"顶栏时钟"}' })).name).toBe('{"purpose":"顶栏时钟"}')
    expect(cordisDefineCard(running({ argsRaw: '{"name":"","purpose":"顶栏时钟"}' })).name).toBe('{"name":"","purpose":"顶栏时钟"}')
  })

  it('reports an unknown name when the event window cut the call head', () => {
    // The host definition list answers identity and run state only, so the card
    // has no label left to fall back on and names its own call instead.
    /** 中文说明：测试局部值 card，由紧邻初始化决定。 */
    const card = cordisDefineCard(settled({ call: null }))
    expect(card.name).toBeNull()
    expect(card.purpose).toBeNull()
  })
})

describe('cordisActionCard', () => {
  it('keeps the Plugin identity and lifecycle result for Stop and Remove cards', () => {
    /** 中文说明：测试局部值 card，由紧邻初始化决定。 */
    const card = cordisActionCard(settled({
      call: { name: 'cordis_stop', argsRaw: '{"pluginId":"clock-1"}' },
      content: [{ type: 'text', text: 'Stopped clock-1.' }],
      meta: undefined,
    }))

    expect(card).toEqual({
      pluginId: 'clock-1',
      output: 'Stopped clock-1.',
      errorSummary: null,
      state: 'ok',
    })
  })
})
