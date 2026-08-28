// Session-header background jobs driven by a real `ctx.jobs` entry. No model
// call is involved.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { JobId } from '@deepseek-ai/dsh-jobs'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, seedSession, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/fresh-round-trip/session.jsonl', import.meta.url))
const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/background-job-list', import.meta.url))
const RUNNING_EXPECTED = join(SNAPSHOT_DIR, 'running.expected.md')
/** 任务取消结算后菜单的 ARIA 快照。 */
const SETTLED_EXPECTED = join(SNAPSHOT_DIR, 'settled.expected.md')
/** 当前快照运行模式。 */
const MODE = webSnapshotMode()
/** 播种父会话的固定编号。 */
const SEED_ID = 'background-job-list-web-e2e'
// Long enough that the running assertions never race the process exiting on
// their own; the test kills it explicitly to reach the settled state.
// 命令持续足够久，运行态断言不会与自然退出竞争；测试会主动终止它进入结算态。
/** 保持后台槽位开放、等待测试取消的命令。 */
const COMMAND = 'sleep 45'

/**
 * Wait for opening a session to publish its live Agent.
 * @param scaffold - the booted web scaffold.
 * @param sessionId - the opened session's identity.
 * @returns the registered Agent instance.
 */
/*
 * 等待打开会话后主机发布对应的真实 Agent。
 * @param scaffold 已启动的 Web 脚手架。
 * @param sessionId 已打开会话编号。
 * @returns 注册表中的同一 Agent 实例。
 * @example `await liveAgent(scaffold, SessionId(id))`
 */
async function liveAgent(scaffold: WebScaffold, sessionId: SessionId): Promise<Agent> {
  /** 主机发布 Agent 的绝对截止时间。 */
  const deadline = Date.now() + 30_000
  for (;;) {
    /** 当前轮询在 Agent 注册表中找到的实例。 */
    const found = scaffold.ctx.agents.get(sessionId)
    if (found !== undefined) return found
    if (Date.now() > deadline) throw new Error(`opening session "${sessionId}" published no live Agent`)
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}

describe.skipIf(MODE === 'record')('web e2e: background job list', () => {
  /** 真实 Web 主机和工作区夹具。 */
  let scaffold: WebScaffold
  /** 本场景使用的 Chromium 实例。 */
  let browser: Browser
  /** 打开播种会话的页面。 */
  let page: Page
  /** 页面错误与警告监视器。 */
  let tripwire: ReturnType<typeof watchConsole>
  /** 打开会话后由主机恢复的真实 Agent。 */
  let agent: Agent
  /** 第一用例启动、第二用例取消的后台任务编号。 */
  let jobId: JobId

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, await readFile(FIXTURE, 'utf8'), SEED_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })

    /** 左侧会话树的分组行。 */
    const groupRow = page.locator('[role="treeitem"]').first()
    await groupRow.waitFor({ timeout: 15_000 })
    await groupRow.click()
    /** 播种会话对应的树行。 */
    const sessionRow = page.locator('[role="treeitem"]').nth(1)
    await sessionRow.waitFor({ timeout: 10_000 })
    await sessionRow.click()

    // Opening the session drives the Host's ordinary Agent resolution; the
    // job owner must be that exact live instance, never a second one.
    // `expect.poll` is test-scoped, so this hook polls by hand.
    // 打开会话走正式 Agent 恢复流程，任务必须归属于该实例；beforeAll 中手动轮询等待发布。
    agent = await liveAgent(scaffold, SessionId(SEED_ID))
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('shows a running background job in the session header without a refresh', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-background-job-running'))
    // Polling for zero would pass at t=0 before delivery and prove nothing.
    const trigger = page.getByRole('button', { name: '1 background job running' })
    expect(await trigger.count()).toBe(0)

    /** 真实 bash 工具启动后台命令后返回的工具结果。 */
    const started = await scaffold.ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('background-job-list-e2e'),
      name: 'bash',
      arguments: { command: COMMAND, description: 'Hold a background slot open', run_in_background: true },
      agent,
    })
    /** 工具结果中所有文本块拼接后的报告。 */
    const reported = started.content.map(block => block.type === 'text' ? block.text : '').join('')
    /** 从工具报告中提取的 bash 后台任务编号匹配。 */
    const matched = /\bbash-\d+\b/.exec(reported)
    if (matched === null) throw new Error(`background bash reported no job id: ${reported}`)
    jobId = JobId(matched[0])

    await trigger.waitFor({ timeout: 15_000 })
    await trigger.click()
    /** 打开任务菜单后的第一条任务行。 */
    const row = page.getByRole('list', { name: 'Background jobs' }).getByRole('listitem').first()
    await row.waitFor({ timeout: 10_000 })
    await expect.poll(() => row.textContent()).toContain(COMMAND)

    /** 运行中任务菜单的归一化 ARIA 树。 */
    const snapshot = await captureStableAria(page, '[class*="menu"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(RUNNING_EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)

  it('flips the open list to the cancelled outcome when the registry settles it', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-background-job-settled'))
    expect(scaffold.ctx.jobs.kill(jobId, agent, 'web e2e cancellation')).toBe('requested')

    const idle = page.getByRole('button', { name: '1 background job' })
    await idle.waitFor({ timeout: 20_000 })

    /** 已结算任务菜单的归一化 ARIA 树。 */
    const snapshot = await captureStableAria(page, '[class*="menu"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(SETTLED_EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)

  it('keeps its snapshot inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['running.expected.md', 'settled.expected.md'])
  })
})
