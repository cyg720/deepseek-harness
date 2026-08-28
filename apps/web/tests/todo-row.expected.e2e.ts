// @vitest-environment jsdom
// Assembled todo snapshot: boots the real built `packages/client/*/lib/
// client.js` bundles through AppWebEntry's ModuleLoader path against the
// keyless fixture Connection RPC, opens the fixture session, and pins the
// two surfaces the fixture's parallel plan (turn 74, two items `in_progress`)
// reaches — the `todo_write` tool row and the dock's plan strip.
//
// The row is pinned as three separate fields on purpose. `summary=` is the
// ellipsized text and `suffix=` is ToolRow's non-shrinking `summarySuffix`
// slot, so a regression that folds the `+N` count back into the summary string
// changes this file even though the concatenated text would read the same; the
// jsdom package suites bench over src and cannot see the bundled registration.
// 中文说明：分别固定摘要和不可收缩的 +N 后缀，确保已构建插件注册与计划条在组装应用中保持正确。
/**
 * 文件职责：验证已构建客户端同时展示 todo_write 工具行摘要和编辑器上方的常驻计划条。
 * 技术维度：使用 Vitest、jsdom、Testing Library、真实客户端 bundle 和文本文件快照。
 * 产品维度：让用户快速理解计划项总数、进行中数量和每项状态，而不会因摘要省略丢失计数。
 * 逻辑维度：启动组装应用，打开 turn 74 历史，定位工具行与计划面板，展开后归一化字段并比较快照。
 * 关键边界：依赖已构建客户端和固定 fixture；摘要与后缀必须分开；刷新模式会写入预期文件。
 * 新手阅读建议：先读 todoShape 的输出顺序，再看测试如何等待工具行、展开面板并收集状态项。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { hasClass, installAssembledBootEnv, mountAssembledApp, REFRESHING_GOLDEN } from './assembled-boot.ts'

const EXPECTED = join(process.cwd(), 'apps/web/tests/expected/todo-row/parallel-plan.expected.txt')

installAssembledBootEnv()

/** Normalize the todo row and the plan strip to stable text fields: the row's
 *  title, its truncatable summary, its non-shrinking suffix, then the panel's
 *  per-status header and every list item with its status. */
/* 中文说明：row 是工具行，panel 是计划条，返回标题、摘要、后缀、进度和每项状态的稳定文本。 */
function todoShape(row: Element, panel: Element): string {
  /** 从 from 中筛选带指定 CSS 模块类名的全部后代。 */
  const pick = (from: Element, name: string): Element[] =>
    [...from.querySelectorAll('*')].filter(el => hasClass(el, name))
  /** 读取指定类名的首个文本，缺失时返回稳定占位符。 */
  const first = (from: Element, name: string): string =>
    pick(from, name)[0]?.textContent?.trim() ?? '<absent>'
  /** 按 DOM 顺序归一化的计划项状态与文本。 */
  const items = [...panel.querySelectorAll('[data-status]')]
    .map(item => `item=${item.getAttribute('data-status')} ${item.textContent?.trim() ?? ''}`)
  return [
    `row=${row.getAttribute('data-tool')}`,
    `title=${first(row, 'title')}`,
    `summary=${first(row, 'summary')}`,
    `suffix=${first(row, 'summarySuffix')}`,
    `panel=${first(panel, 'progress')}`,
    ...items,
  ].join('\n')
}

describe('assembled todo surfaces', () => {
  it('renders the parallel plan as a row summary, a separate active count, and the dock plan strip', async () => {
    mountAssembledApp()

    const tree = await screen.findByRole('tree', { name: 'Sessions' }, { timeout: 10_000 })
    fireEvent.click(await within(tree).findByText('Fixture 历史会话'))
    // The todo turn is the fixture's last, so wait for its keyed row rather
    // than for chat content in general.
    const row = await waitFor(() => {
      const found = document.querySelector('[data-tool="todo_write"]')
      expect(found).not.toBeNull()
      return found!
    }, { timeout: 10_000 })
    // The panel is the standing plan the turn's `todo/write` event feeds; it
    // mounts above the composer, outside the row, and starts collapsed — its
    // list only exists once expanded.
    const panel = await screen.findByTestId('todo-panel', undefined, { timeout: 10_000 })
    const toggle = panel.querySelector('button[aria-expanded]')
    if (toggle === null) throw new Error('the plan strip must expose its expand toggle')
    if (toggle.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle)

    const shape = todoShape(row, panel)
    if (REFRESHING_GOLDEN) {
      mkdirSync(dirname(EXPECTED), { recursive: true })
      writeFileSync(EXPECTED, shape)
    }
    await expect(shape).toMatchFileSnapshot(EXPECTED)
  })
})
