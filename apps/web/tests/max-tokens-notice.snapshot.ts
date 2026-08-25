// @vitest-environment jsdom
// Assembled max-tokens snapshot: boots the real built `packages/client/*/lib/
// client.js` bundles through AppWebEntry's ModuleLoader path against the
// keyless FixtureApiClient transport, opens the fixture session, and pins the
// surface its max-tokens turn (72) reaches — the turn-end notice row that a
// provider output-cap truncation must render instead of ending silently.
//
// The dot state is pinned beside the copy on purpose: `dot=warning` is what
// distinguishes this notice from the error row, so a regression that routes
// max-tokens through the turn-error presentation changes this file even when
// its own copy still renders.
// 中文说明：警告圆点可区分截断提示与错误行，因此也属于必须固定的产品展示状态。
/**
 * 文件职责：验证已构建客户端为达到输出上限的回合展示本地化警告，而不是静默结束。
 * 技术维度：使用 Vitest、jsdom、Testing Library、真实客户端模块加载和文件快照。
 * 产品维度：让用户知道回答因最大令牌数被截断，并理解可继续提问，而不会误认为系统故障。
 * 逻辑维度：启动组装应用，打开固定历史会话，定位提示行，归一化关键字段并比较快照。
 * 关键边界：依赖已构建客户端和第 72 回合 fixture；刷新模式会写入预期文件。
 * 新手阅读建议：先读 noticeShape 的三个稳定字段，再看测试如何等待截断正文和提示行。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { hasClass, installAssembledBootEnv, mountAssembledApp, REFRESHING_GOLDEN } from './assembled-boot.ts'

/** 截断提示稳定字段的预期文本快照路径。 */
const EXPECTED = join(process.cwd(), 'apps/web/tests/snapshots/max-tokens-notice/history-turn.expected.txt')

installAssembledBootEnv()

/** Normalize the notice row to stable fields: its dot state, title, and hint. */
/* 将 row 归一化为圆点状态、标题和提示，返回快照文本。示例：noticeShape(statusRow)。 */
function noticeShape(row: Element): string {
  /** 按 CSS 模块类名查找首个元素文本；缺失时返回稳定占位符。 */
  const first = (name: string): string =>
    [...row.querySelectorAll('*')].filter(el => hasClass(el, name))[0]?.textContent?.trim() ?? '<absent>'
  return [
    `dot=${row.querySelector('[data-state]')?.getAttribute('data-state') ?? '<absent>'}`,
    `title=${first('maxTokensTitle')}`,
    `hint=${first('turnErrorMessage')}`,
  ].join('\n')
}

describe('assembled max-tokens turn-end notice', () => {
  it('renders the localized truncation notice after the cut-off answer instead of ending silently', async () => {
    mountAssembledApp()

    /** 包含固定历史会话的侧栏树。 */
    const tree = await screen.findByRole('tree', { name: 'Sessions' }, { timeout: 10_000 })
    fireEvent.click(await within(tree).findByText('Fixture 历史会话'))
    // The truncated answer itself stays in the flow: the notice supplements the
    // partial output, it never replaces it.
    // 中文说明：提示行补充截断原因，不会取代已经生成的部分回答。
    await screen.findByText(/条目 3：这一条写到一半被/, undefined, { timeout: 10_000 })
    /** 包含最大令牌标题的状态行。 */
    const row = await waitFor(() => {
      /** 本轮查询找到的截断提示候选元素。 */
      const found = [...document.querySelectorAll('[role="status"]')]
        .find(candidate => [...candidate.querySelectorAll('*')].some(el => hasClass(el, 'maxTokensTitle')))
      expect(found).not.toBeUndefined()
      return found!
    }, { timeout: 10_000 })

    /** 用于文件快照比较的稳定提示文本。 */
    const shape = noticeShape(row)
    if (REFRESHING_GOLDEN) {
      mkdirSync(dirname(EXPECTED), { recursive: true })
      writeFileSync(EXPECTED, shape)
    }
    await expect(shape).toMatchFileSnapshot(EXPECTED)
  })
})
