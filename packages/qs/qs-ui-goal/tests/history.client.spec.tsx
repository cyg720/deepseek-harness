// @vitest-environment jsdom
/** 目标指令沿用官方文本分词，正文中的命令提及不重复装饰。 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { GoalCommandRow } from '../src/client/GoalCommandRow.tsx'
import { en } from '../src/client/locales.ts'
import { apply } from '../src/index.ts'

afterEach(cleanup)
function props(text?: string, kind = 'command-input'): Parameters<typeof GoalCommandRow>[0] {
  // 该行只读取 kind 与官方已解析 data；其他座席不在这里使用。
  return { t: makeTranslate(en), nodeKey: 'goal-row', useNode: (_key: string, select: (value: unknown) => unknown) => select(text === undefined ? undefined : { kind, data: { text } }) } as unknown as Parameters<typeof GoalCommandRow>[0]
}
it('renders only the official command-input kind and treats later tokens as plain text', () => {
  apply()
  const view = render(<GoalCommandRow {...props()} />)
  expect(view.container.innerHTML).toBe('')
  view.rerender(<GoalCommandRow {...props('/goal', 'command')} />)
  expect(view.container.innerHTML).toBe('')
  view.rerender(<GoalCommandRow {...props('/goal')} />)
  expect(screen.getByRole('group').textContent).toContain('/goal')
  view.rerender(<GoalCommandRow {...props('/goal explain /goal and <script>')} />)
  expect(screen.getByRole('group').textContent).toContain('/goal explain /goal and <script>')
  expect(view.container.querySelector('script')).toBeNull()
})
