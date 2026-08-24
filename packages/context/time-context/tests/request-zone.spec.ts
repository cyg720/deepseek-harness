/**
 * 文件职责：验证从浏览器用户请求中提取、校验和渲染时区上下文的规则。
 * 技术维度：使用 Vitest、LLM 用户消息结构和 IANA 时区规范构造输入输出测试。
 * 产品维度：让模型正确解释用户未注明时区的日期时间，并在多人时区混合时明确提示。
 * 逻辑维度：构造带浏览器时区的消息，覆盖缺失、唯一、混合、非法以及模型提示渲染。
 * 关键边界：只读取 user RPC 来源的时区；时区必须是受支持且规范化的 UTC 或 IANA 名称。
 * 新手阅读建议：先看 browserMessage 如何构造来源字段，再按派生、校验、渲染三组测试阅读。
 */
import { describe, expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import {
  deriveBrowserTimeZoneContext,
  renderBrowserTimeZoneContext,
} from '../src/request-zone.ts'

/**
 * 创建携带浏览器时区和唯一 RPC 编号的用户消息。
 * @param timeZone 浏览器上报的时区字符串。
 * @returns 可供时区上下文派生器读取的用户消息。
 * @example `browserMessage('Asia/Shanghai')`
 */
function browserMessage(timeZone: string): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text: timeZone }],
    source: { kind: 'user', rpcId: `rpc-${timeZone}`, clientTimeZone: timeZone } as never,
  })
}

describe('browser request-zone context', () => {
  it('derives missing, unique, and sorted mixed zones from user-rpc messages only', () => {
    /** 不应参与浏览器时区推导的插件来源消息。 */
    const plugin = createUserMessage({
      content: [{ type: 'text', text: 'plugin' }],
      source: { kind: 'plugin', plugin: 'test' },
    })
    expect(deriveBrowserTimeZoneContext([plugin])).toEqual({ kind: 'missing' })
    expect(deriveBrowserTimeZoneContext([
      browserMessage('Asia/Shanghai'),
      browserMessage('Asia/Shanghai'),
    ])).toEqual({ kind: 'resolved', timeZone: 'Asia/Shanghai' })
    expect(deriveBrowserTimeZoneContext([
      browserMessage('Asia/Shanghai'),
      browserMessage('America/New_York'),
    ])).toEqual({
      kind: 'mixed',
      timeZones: ['America/New_York', 'Asia/Shanghai'],
    })
  })

  it('validates every browser zone before classifying a mixed turn', () => {
    expect(() => deriveBrowserTimeZoneContext([
      browserMessage('+08:00'),
    ])).toThrow(/canonical UTC or IANA Area\/Location/)
    expect(() => deriveBrowserTimeZoneContext([
      browserMessage('Asia/Shanghai'),
      browserMessage('Not/A_Real_Zone'),
    ])).toThrow(/browser time zone is unsupported/)
    expect(() => deriveBrowserTimeZoneContext([
      browserMessage('Etc/UTC'),
    ])).toThrow(/browser time zone must be canonical/)
  })

  it('renders one explicit model policy for every context', () => {
    expect(renderBrowserTimeZoneContext({ kind: 'resolved', timeZone: 'Asia/Shanghai' }))
      .toContain('Interpret otherwise-unqualified dates and times in this zone.')
    expect(renderBrowserTimeZoneContext({
      kind: 'mixed', timeZones: ['America/New_York', 'Asia/Shanghai'],
    })).toContain('mixed ["America/New_York","Asia/Shanghai"]')
    expect(renderBrowserTimeZoneContext({ kind: 'missing' })).toContain('unavailable')
  })
})
