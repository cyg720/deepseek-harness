/** Cold Session list visibility through the shipped compressed JSONL backend. */
/**
 * 文件职责：验证压缩 JSONL 后端中的冷空白会话不会出现在 Web 侧栏列表。
 * 技术维度：使用真实会话持久化、Playwright、文件大小检查和 ARIA 快照。
 * 产品维度：避免从未产生有效内容的空白会话污染用户会话列表和工作区分组。
 * 逻辑维度：创建小型空白会话物理文件，冷启动浏览器，确认工作区名缺失并比较侧栏快照。
 * 关键边界：物理夹具必须不超过 1 KiB；验证的是冷持久化列表，而不是当前活动空白会话。
 * 新手阅读建议：先看 seedBlankSession 与 locate 的持久化证据，再看浏览器侧栏的缺失断言。
 */

import { mkdir, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, seedBlankSession,
  watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

/** 本场景黄金快照目录。 */
const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/cold-blank-session', import.meta.url))
/** 冷启动侧栏的 ARIA 快照。 */
const SIDEBAR_EXPECTED = join(SNAPSHOT_DIR, 'sidebar.expected.md')
/** 当前快照运行模式。 */
const MODE = webSnapshotMode()
/** 冷空白会话的固定编号。 */
const SESSION_ID = 'cold-blank-session-web-e2e'
/** 只供空白会话使用的工作区目录名。 */
const WORKSPACE_NAME = 'cold-blank-workspace'

describe('web e2e: cold blank Session visibility', () => {
  /** 真实 Web 主机和持久化夹具。 */
  let scaffold: WebScaffold
  /** 本场景使用的 Chromium 实例。 */
  let browser: Browser
  /** 冷启动后观察侧栏的页面。 */
  let page: Page
  /** 页面错误和警告监视器。 */
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    /** 空白会话使用的实际工作区路径。 */
    const cwd = join(scaffold.workspaceCwd, WORKSPACE_NAME)
    await mkdir(cwd, { recursive: true })
    await seedBlankSession(scaffold, SESSION_ID, cwd)
    /** 持久化列表中刚创建的空白会话头。 */
    const header = (await scaffold.ctx.sessionPersistence.list())
      .find(candidate => candidate.id === SESSION_ID)
    if (header === undefined) throw new Error('blank Session fixture did not materialize')
    /** 空白会话 JSONL 物理文件定位信息。 */
    const location = scaffold.ctx.sessionPersistence.locate(header)
    if (location === undefined) throw new Error('JSONL fixture has no physical artifact')
    expect((await stat(location.path)).size).toBeLessThanOrEqual(1024)

    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('keeps the verified cold blank Session out of the sidebar', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-cold-blank-session'))
    /** 当前页面的会话树。 */
    const tree = page.getByRole('tree', { name: 'Sessions' })
    await tree.waitFor({ timeout: 30_000 })
    expect(await tree.getByText(WORKSPACE_NAME, { exact: true }).count()).toBe(0)
    /** 归一化后的冷启动侧栏 ARIA 树。 */
    const sidebar = await captureStableAria(page, '[role="tree"][aria-label="Sessions"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(SIDEBAR_EXPECTED, sidebar, MODE)
    expect(tripwire.pageErrors).toEqual([])
  })
})
