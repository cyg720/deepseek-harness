// @vitest-environment jsdom
/** 估算来自官方投影，缺值与零值分离，模型切换不保留旧展开内容。 */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import type { UseProjection } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ContextPressureProjection, ContextBreakdownProjection } from '@deepseek-ai/dsh-token-meter/client'
import { ContextPressure } from '../src/client/ContextPressure.tsx'
import type { QsComposerProps } from '../src/client/contract.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
const t: QsComposerProps['t'] = (key, params): string => {
  if (!(key in zh)) throw new Error(`Unexpected locale key: ${key}`)
  let value: string = zh[key as keyof typeof zh]
  for (const [name, item] of Object.entries(params ?? {})) value = value.replace(`{${name}}`, String(item))
  return value
}
function projection(pressure?: ContextPressureProjection, breakdown?: ContextBreakdownProjection): UseProjection {
  // 测试座席仅提供组件订阅的两个已知投影，其余键不参与此场景。
  return (key: string) => key === 'contextPressure' ? pressure : breakdown
}
it('缺少容量或采样时明示未知，真实零采样显示零估算', () => {
  for (const value of [undefined, { contextWindow: 100 }, { pressureTokens: 20 }]) {
    const view = render(<ContextPressure useProjection={projection(value)} t={t} />)
    expect(view.getByText('暂无上下文估算')).toBeDefined()
    expect(view.queryByRole('button')).toBeNull()
    view.unmount()
  }
  const view = render(<ContextPressure useProjection={projection({ projectedTokens: 0, pressureTokens: 20, contextWindow: 100 })} t={t} />)
  expect(view.getByRole('button', { name: '上下文估算：0%' })).toBeDefined()
})
it('优先 projectedTokens，按需展示组成，容量丢失后关闭面板', () => {
  const view = render(<ContextPressure useProjection={projection({ projectedTokens: 60, pressureTokens: 10, contextWindow: 100 },
    { systemTokens: 5, toolsTokens: 8, messageTokens: 9 })} t={t} />)
  expect(view.queryByText('系统提示估算：5 tokens')).toBeNull()
  fireEvent.click(view.getByRole('button', { name: '上下文估算：60%' }))
  expect(view.getByText('系统提示估算：5 tokens')).toBeDefined()
  expect(view.getByText('工具定义估算：8 tokens')).toBeDefined()
  expect(view.getByText('消息估算：9 tokens')).toBeDefined()
  expect(view.getByText('组成采用启发式估算，合计不一定等于上下文占用；不代表计费或本轮实际用量。')).toBeDefined()
  view.rerender(<ContextPressure useProjection={projection()} t={t} />)
  expect(view.queryByText('系统提示估算：5 tokens')).toBeNull()
  view.rerender(<ContextPressure useProjection={projection({ pressureTokens: 200, contextWindow: 100 })} t={t} />)
  const button = view.getByRole('button', { name: '上下文估算：100%' })
  expect(button.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(button)
  expect(view.getByText('估算占用 200 / 100 tokens')).toBeDefined()
  expect(view.getByText('暂无组成估算')).toBeDefined()
  fireEvent.click(button)
  expect(view.queryByText('暂无组成估算')).toBeNull()
})
