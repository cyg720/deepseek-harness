// Web e2e scenario: the session-header background-job list over the real
// host. No model call is involved — a genuine `run_in_background` bash call
// registers with `ctx.jobs`, and the assertion chain is the whole delivery
// path: registry change feed → api-proxy `session/jobs` frame → the client's
// `jobsBySession` mirror → the header action.
// 完整链路为任务注册表变更、API 推送、客户端会话任务镜像，最后到会话头操作入口。
/**
 * 文件职责：端到端验证后台 Bash 任务从主机注册到浏览器会话头列表的实时展示与结算。
 * 技术维度：使用真实工具执行、Jobs 注册表、Playwright、ARIA 快照和已播种会话。
 * 产品维度：用户无需刷新即可查看运行中的后台任务，并在取消后立即看到最终状态。
 * 逻辑维度：打开播种会话获得真实 Agent，启动后台命令，检查运行列表，再取消任务并检查结算列表。
 * 关键边界：记录模式跳过；命令特意运行足够久并由测试主动终止，避免自然退出竞争。
 * 新手阅读建议：先看 liveAgent 如何取得会话所有者，再跟随运行、提取 JobId、取消和快照流程。
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { JobId } from '@deepseek-ai/dsh-jobs'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, seedSession, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

/** 用于打开稳定会话的已有回放夹具。 */
const FIXTURE = fileURLToPath(new URL('./snapshots/fresh-round-trip/session.jsonl', import.meta.url))
/** 后台任务列表场景的快照目录。 */
const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/background-job-list', import.meta.url))
/** 任务运行中菜单的 ARIA 快照。 */
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
 * Wait for the Host to publish the live Agent that opening a session resumes.
 * @param scaffold - the booted web scaffold.
 * @param sessionId - the opened session's identity.
 * @returns the registered Agent instance.
 */
/**
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
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
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
    // Point assertion, not a poll: `expect.poll` retries until a predicate
    // holds, so polling for zero passes at t=0 and proves nothing. The
    // "renders nothing without a task" branch is owned by the component suite.
    // 这里用即时零计数断言，避免 expect.poll 在初始时刻通过而没有证明实时更新。
    /** 任务启动后才应出现的会话头入口。 */
    const trigger = page.getByRole('button', { name: '1 background job running' })
    expect(await trigger.count()).toBe(0)

    /** 真实 bash 工具启动后台命令后返回的工具结果。 */
    const started = await scaffold.ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('background-job-list-e2e'),
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

    // The trigger drops its live count once the task leaves running/stopping,
    // which is also the proof that settlement reached the browser unprompted.
    // 任务离开运行/停止中状态后入口去掉 live 计数，也证明结算主动推送到了浏览器。
    /** 任务结算后保留历史数量但不显示运行中的入口。 */
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
