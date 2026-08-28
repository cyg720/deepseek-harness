// @vitest-environment jsdom
// 中文：使用 jsdom 运行装配后的 Web 应用交互快照。
// Assembled POSIX home-path display: the fixture Host home is `/home/fixture`
// and a second Workspace lives under it. The sidebar hover card must show
// `~/Documents/project` while copy still writes the full path.
// 中文：夹具 Host 主目录为 /home/fixture；悬停卡显示 ~/Documents/project，但复制按钮保留完整路径。
/**
 * 中文说明：
 * - 文件职责：验证装配 Web 应用对主目录下工作区显示波浪号缩写，但复制语义仍使用绝对路径。
 * - 技术维度：使用 Vitest 文件快照、Testing Library、jsdom 和真实装配启动夹具。
 * - 产品维度：侧栏路径更简洁易读，同时复制结果可直接用于终端或文件工具。
 * - 逻辑维度：启动应用，定位工作区树项，触发悬停，读取显示与 aria-label，再匹配黄金文件。
 * - 关键边界：仅模拟 POSIX 主目录；刷新黄金文件时才会创建目录并覆盖 expected 文本。
 * - 新手阅读建议：先区分 hoverPath 与 copy 两种路径，再看 shape 如何固定为可审查快照。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { installAssembledBootEnv, mountAssembledApp, REFRESHING_GOLDEN } from './assembled-boot.ts'

const EXPECTED = join(process.cwd(), 'apps/web/tests/expected/home-path-tilde/workspace-hover.expected.txt')

installAssembledBootEnv()

/** 中文：装配后 POSIX 主目录路径显示测试组。 */
describe('assembled POSIX home-path display', () => {
  /** 中文：悬停显示缩写路径并验证复制按钮保留完整路径；无参数和返回值。 */
  it('shows the home-descendant Workspace path as ~ and copies the full path', async () => {
    mountAssembledApp()

    /** 会话侧栏的树形区域。 */
    const tree = await screen.findByRole('tree', { name: 'Sessions' }, { timeout: 10_000 })
    /** 名称为 project 且可展开的工作区树项。 */
    const group = (await within(tree).findAllByText('project'))
      .map(el => el.closest<HTMLElement>('[role="treeitem"]'))
      .find(el => el?.getAttribute('aria-expanded') !== null)
    if (group == null) throw new Error('home-descendant Workspace group missing')

    fireEvent.pointerEnter(group.parentElement as HTMLElement)
    /** 悬停卡中使用波浪号缩写的路径元素。 */
    const hoverPath = await waitFor(() => {
      /** 当前轮查询到的缩写路径节点。 */
      const found = screen.getByText('~/Documents/project')
      expect(found).toBeTruthy()
      return found
    }, { timeout: 2_000 })
    expect(screen.queryByText('/home/fixture/Documents/project')).toBeNull()
    /** 其无障碍名称携带完整绝对路径的复制按钮。 */
    const copy = screen.getByRole('button', { name: 'Copy: /home/fixture/Documents/project' })

    /** 固定记录显示路径与复制语义的快照文本。 */
    const shape = [
      `hover=${hoverPath.textContent}`,
      `copy=${copy.getAttribute('aria-label')}`,
    ].join('\n') + '\n'
    if (REFRESHING_GOLDEN) {
      mkdirSync(dirname(EXPECTED), { recursive: true })
      writeFileSync(EXPECTED, shape)
    }
    await expect(shape).toMatchFileSnapshot(EXPECTED)
    act(() => { fireEvent.pointerLeave(group.parentElement as HTMLElement) })
  })
})
