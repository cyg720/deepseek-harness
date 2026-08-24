/**
 * 文件职责：验证拥有仍在运行子代理的父会话在侧栏持续显示活动状态。
 * 技术维度：使用 Playwright、Vitest、自定义分阶段 LLM 适配器、真实子代理服务和无障碍快照。
 * 产品维度：让用户在父回合已结束时仍能看到后台子代理尚未完成，避免误判任务空闲。
 * 逻辑维度：适配器先完成父回合再挂起子回合，创建委派关系，等待子代理运行并检查父会话侧栏。
 * 关键边界：挂起调用必须响应取消信号；测试结束要终止子代理；录制模式跳过且不需真实模型。
 * 新手阅读建议：先读 StagedAdapter 的两阶段 stream，再读 waitForRunningChild，最后看侧栏状态断言。
 */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionId as SessionIdValue } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-workspace'
import {
  assertFixtureInventory,
  captureStableAria,
  compareOrRefreshGolden,
  launchWebScaffold,
  watchConsole,
  webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

/** 子代理活动侧栏状态的快照目录。 */
const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/sidebar-subagent-activity', import.meta.url))
/** 子代理运行时父会话行的预期快照。 */
const RUNNING_OWNER_EXPECTED = join(SNAPSHOT_DIR, 'owner-running.expected.md')
/** 当前快照模式。 */
const MODE = webSnapshotMode()
/** 分阶段测试适配器公开的提供方名称。 */
const HOLD_PROVIDER = 'web-test-hold'
/** 分阶段测试适配器公开的模型名称。 */
const HOLD_MODEL = 'hold'

/** Model stub that completes the owner turn, then holds its delegated child open. */
/** 先结束父回合、再持续挂起子回合的确定性模型适配器。 */
class StagedAdapter extends LlmAdapter {
  /** 当前处于挂起阶段的模型调用数量，取值不小于零。 */
  activeCalls = 0
  /** 已开始的调用总数，用于区分父回合和后续子回合。 */
  private calls = 0

  /** 根据调用次序产生完成或挂起流；options 提供取消信号，返回异步片段流。 */
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (this.calls === 0) {
      this.calls += 1
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    this.calls += 1
    const signal = options.signal
    if (signal === undefined) throw new Error('staged Web adapter requires a turn signal')
    this.activeCalls += 1
    try {
      await new Promise<never>((_resolve, reject) => {
        const abort = (): void => {
          reject(signal.reason instanceof Error ? signal.reason : new Error('holding Web adapter aborted'))
        }
        if (signal.aborted) abort()
        else signal.addEventListener('abort', abort, { once: true })
      })
    } finally {
      this.activeCalls -= 1
    }
  }
}

async function waitForRunningChild(
  scaffold: WebScaffold,
  adapter: StagedAdapter,
  childId: SessionIdValue,
): Promise<void> {
  const deadline = Date.now() + 10_000
  while (adapter.activeCalls !== 1 || scaffold.ctx.agents.get(childId)?.status !== 'running') {
    if (Date.now() >= deadline) throw new Error('held child did not enter its running model call')
    await new Promise<void>(resolve => setTimeout(resolve, 10))
  }
}

describe('web e2e: sidebar subagent activity', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let parentHandle: AgentHandle
  let childId: SessionIdValue
  let adapter: StagedAdapter
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold()
    adapter = new StagedAdapter()
    scaffold.ctx.effect(
      () => scaffold.ctx.llm.registerAdapter([HOLD_PROVIDER], adapter),
      'sidebar subagent activity staged adapter',
    )
    const cwd = join(scaffold.workspaceCwd, 'workspace')
    await mkdir(cwd)
    parentHandle = await scaffold.ctx.agents.create({
      sessionId: SessionId('sidebar-activity-owner'),
      meta: { cwd },
      agentOptions: { provider: HOLD_PROVIDER, model: HOLD_MODEL },
    })
    parentHandle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'Delegate a background job.' }],
      source: { kind: 'user' },
    }))
    await parentHandle.agent.whenIdle()
    const started = await scaffold.ctx.subagents.startContinuable({
      provider: 'spawn',
      label: 'sidebar activity child',
      signal: new AbortController().signal,
      request: {
        prompt: [{ type: 'text', text: 'Hold this delegated task open.' }],
        parent: parentHandle.agent,
      },
    })
    childId = started.childId
    await waitForRunningChild(scaffold, adapter, childId)

    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    const workspace = await scaffold.ctx.workspaceRegistry.resolveByPath(cwd)
    if (workspace === undefined) throw new Error('connected Web workspace was not registered')
    await workspace.attachSession(parentHandle.agent.session.id)
  }, 60_000)

  afterAll(async () => {
    const failures: unknown[] = []
    const child = childId === undefined ? undefined : scaffold?.ctx.agents.get(childId)
    if (child !== undefined) {
      child.cancel({ kind: 'user' })
      await child.whenIdle().catch((error: unknown) => failures.push(error))
    }
    await browser?.close().catch((error: unknown) => failures.push(error))
    await parentHandle?.dispose().catch((error: unknown) => failures.push(error))
    await scaffold?.close().catch((error: unknown) => failures.push(error))
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'sidebar subagent activity teardown failed')
  })

  it('pins a running descendant on its visible idle owner row', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-sidebar-subagent-activity'))
    const sidebar = page.getByRole('tree', { name: 'Sessions' })
    const ownerRow = sidebar.getByRole('treeitem', { name: /1 subagent running Delegate a background job/ })
    await ownerRow.waitFor({ timeout: 10_000 })
    expect(parentHandle.agent.status).toBe('idle')
    await compareOrRefreshGolden(
      RUNNING_OWNER_EXPECTED,
      await captureStableAria(page, '[role="tree"][aria-label="Sessions"]', scaffold.workspaceCwd),
      MODE,
    )
    expect(await ownerRow.locator('[data-state="ongoing"]').count()).toBe(1)
    await ownerRow.click()
    const runningTrigger = page.getByRole('button', { name: '1 subagent running' })
    await runningTrigger.waitFor({ timeout: 10_000 })
    expect(await runningTrigger.locator('[data-state="ongoing"]').count()).toBe(1)
    await assertFixtureInventory(SNAPSHOT_DIR, ['owner-running.expected.md'])
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  })
})
