/**
 * 文件职责：验证 session-fixture-layout.spec.ts 覆盖的发布、门禁、翻译配对或仓库维护职责。
 * 技术维度：使用 TypeScript、Vitest、Node.js 文件系统、Git、包管理器或构建产物校验。
 * 产品维度：保障项目发布物、文档配对和 CI 门禁保持一致且可追踪。
 * 逻辑维度：解析参数与仓库状态，执行检查或发布步骤，再输出诊断和退出状态。
 * 关键边界：发布与 Git 操作会改变外部状态；失败必须显式停止；路径和命令输出不可信。
 * 新手阅读建议：先看入口参数和只读检查，再读状态变更步骤，最后关注回滚、错误码和平台差异。
 */
import { describe, expect, it } from 'vitest'
import { type SessionEvent } from '@deepseek-ai/dsh-session'
import { parseSessionLog } from '@deepseek-ai/dsh-llm-replay'
import { canonicalSessionFixture } from './session-fixture-layout.ts'

/** 中文说明：常量 HEADER 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const HEADER = '  {"type":"session","version":0,"id":"fixture","createdAt":1,"delegationDepth":0}  '

/** 中文说明：函数 chunkRun 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function chunkRun(): SessionEvent[] {
  return Array.from({ length: 4 }, (_, index) => ({
    type: 'assistant/chunk',
    seq: index,
    time: 10 + index,
    data: {
      turn: 1,
      step: 1,
      chunk: { type: 'text-delta', index: 0, text: `part-${index}` },
    },
  }))
}

/** 中文说明：函数 unpackedFixture 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function unpackedFixture(): string {
  return [HEADER, ...chunkRun().map(event => JSON.stringify(event)), ''].join('\n')
}

/** 中文说明：函数 decodedBody 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function decodedBody(content: string): SessionEvent[] {
  return parseSessionLog(content)
}

describe('canonicalSessionFixture', () => {
  it('preserves the header line and packs an unpacked event run losslessly', () => {
    /** 中文说明：变量 canonical 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const canonical = canonicalSessionFixture(unpackedFixture(), 'fixture.jsonl')
    expect(canonical).toBeDefined()
    expect(canonical?.split('\n')[0]).toBe(HEADER)
    /** 中文说明：变量 packed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const packed = JSON.parse(canonical?.split('\n')[1] ?? '{}') as Record<string, unknown>
    expect(packed).toMatchObject({ type: 'text-chunks' })
    expect(packed).not.toHaveProperty('seq0')
    expect(packed).not.toHaveProperty('time0')
    expect(decodedBody(canonical ?? '').map(({ seq: _seq, time: _time, ...event }) => event))
      .toStrictEqual(chunkRun().map(({ seq: _seq, time: _time, ...event }) => event))
  })

  it('ignores JSONL whose first record is not a session header', () => {
    expect(canonicalSessionFixture('{"type":"session_event"}\n{"value":1}\n')).toBeUndefined()
  })

  it('is idempotent for an already packed fixture', () => {
    /** 中文说明：变量 packed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const packed = canonicalSessionFixture(unpackedFixture())
    expect(packed).toBeDefined()
    expect(canonicalSessionFixture(packed ?? '')).toBe(packed)
  })

  it('is idempotent for an already projected fixture', () => {
    /** 中文说明：变量 projected 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const projected = [
      HEADER,
      '{"type":"turn/start","data":{"turn":1,"seq":99,"time":100}}',
      '',
    ].join('\n')
    expect(canonicalSessionFixture(projected)).toBe(projected)
  })

  it('fails loud on malformed records after a session header', () => {
    expect(() => canonicalSessionFixture(`${HEADER}\n{not-json}\n`, 'broken.jsonl'))
      .toThrow(/broken\.jsonl: session snapshot line 2 contains invalid JSON/)
  })

  it('labels malformed packed rows with the fixture path and line', () => {
    expect(() => canonicalSessionFixture(`${HEADER}\n{"type":"text-chunks"}\n`, 'broken.jsonl'))
      .toThrow(/broken\.jsonl: session snapshot line 2: malformed text-chunks storage row/)
  })
})
