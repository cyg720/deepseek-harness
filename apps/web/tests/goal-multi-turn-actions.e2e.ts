// Keyless replay of a real two-round Goal run. Each autonomous round ends as
// its own turn, so the first answer must keep its IconActions when Goal opens
// round two and the final answer must own a second, distinct action row.
// 第一轮答案在目标开启第二轮后仍应保留操作行，最终答案拥有第二条独立操作行。
/**
 * 文件职责：验证真实两轮 Goal 中每个已完成助手轮次都保留独立消息操作区。
 * 技术维度：使用真实模型记录或确定性回放、目标会话事件、文件夹具和 Playwright ARIA 快照。
 * 产品维度：自动目标跨多轮执行时，用户仍可分别复制、反馈或从每轮答案创建分支。
 * 逻辑维度：构造稳定包目录，等待两个 turn/end，记录或回放 Goal，再检查两条分支按钮和日志轮次。
 * 关键边界：记录与回放模式走不同用例；清理浏览器和服务时聚合错误，不能掩盖场景失败。
 * 新手阅读建议：先看 PACKAGE_FILES 与 whenTurnsSettled，再比较记录用例和双操作行回放用例。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterEach, describe, expect, it, onTestFailed } from 'vitest'
import { parseSessionLog } from '@deepseek-ai/dsh-llm-replay'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-goal'
import {
  assertFixtureInventory, captureExpandedTurnProcessAria, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, recordFixture, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/goal-multi-turn-actions', import.meta.url))
const FIXTURE = join(SNAPSHOT_DIR, 'session.v2.jsonl')
const OVERRIDE = join(SNAPSHOT_DIR, 'replay.override.json')
/** 两轮答案和操作行的 ARIA 快照。 */
const UI_EXPECTED = join(SNAPSHOT_DIR, 'ui.expected.md')
const UI_EXPANDED_EXPECTED = join(SNAPSHOT_DIR, 'ui-expanded.expected.md')
const MODE = webSnapshotMode()

/** 要求系统自动执行两个目标轮次的用户目标文本。 */
const PROMPT = '做两个turn，每个turn输出随机一个包的文件结构。注意你做完一个turn之后，直接输出内容，停止，我们的系统会帮你再开一个turn，你看着做一个类似的'
/** 提交给编辑器的完整 /goal 命令。 */
const COMMAND = `/goal ${PROMPT}`

/** 写入隔离工作区、供模型选择的稳定包文件清单。 */
const PACKAGE_FILES: Readonly<Record<string, string>> = {
  'packages/client/ui-conversation/README.md': '# UI conversation\n',
  'packages/client/ui-conversation/package.json': '{"name":"@deepseek-ai/dsh-client-ui-conversation"}\n',
  'packages/client/ui-conversation/src/client.ts': 'export {}\n',
  'packages/client/ui-chat/tests/chat-view.client.spec.tsx': 'export {}\n',
  'packages/context/session-reference/README.md': '# Session reference\n',
  'packages/context/session-reference/package.json': '{"name":"@deepseek-ai/dsh-session-reference"}\n',
  'packages/context/session-reference/src/index.ts': 'export {}\n',
  'packages/context/session-reference/src/uri.ts': 'export {}\n',
  'packages/context/session-reference/tests/session-reference.spec.ts': 'export {}\n',
  'packages/llm/token-meter/README.md': '# Token meter\n',
  'packages/llm/token-meter/package.json': '{"name":"@deepseek-ai/dsh-token-meter"}\n',
  'packages/llm/token-meter/src/index.ts': 'export {}\n',
  'packages/llm/token-meter/tests/token-meter.spec.ts': 'export {}\n',
  'packages/skill/skill-filesystem/README.md': '# Local skill provider\n',
  'packages/skill/skill-filesystem/package.json': '{"name":"@deepseek-ai/dsh-skill-filesystem"}\n',
  'packages/skill/skill-filesystem/src/index.ts': 'export {}\n',
  'packages/skill/skill-filesystem/src/invariant.ts': 'export {}\n',
  'packages/skill/skill-filesystem/tests/skill-filesystem.spec.ts': 'export {}\n',
}

/** Materialize a stable package inventory inside the isolated session workspace. */
/* 在隔离会话工作区写入固定包清单，消除真实仓库变化对记录结果的影响。 */
async function seedPackageInventory(workspaceRoot: string): Promise<void> {
  for (const [relativePath, content] of Object.entries(PACKAGE_FILES)) {
    /** 当前夹具文件在 workspace 下的绝对路径。 */
    const path = join(workspaceRoot, 'workspace', relativePath)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content)
  }
}

/** Await exactly the requested number of durable turn ends, then flush the session. */
/* 等待精确数量的持久 turn/end，再刷新并返回会话编号。 */
function whenTurnsSettled(scaffold: WebScaffold, count: number, timeoutMs: number): Promise<SessionId> {
  return new Promise<SessionId>((resolve, reject) => {
    /** 已观察到的 turn/end 数量。 */
    let completed = 0
    /** 未按时完成指定轮数时拒绝等待的计时器。 */
    const timer = setTimeout(() => {
      off()
      reject(new Error(`only ${completed}/${count} Goal turns ended within ${timeoutMs}ms`))
    }, timeoutMs)
    /** 会话事件监听撤销函数。 */
    const off = scaffold.ctx.on('session/event', (session, event: SessionEvent) => {
      if (event.type !== 'turn/end') return
      completed += 1
      if (completed !== count) return
      clearTimeout(timer)
      off()
      scaffold.ctx.sessions.flush(session).then(() => { resolve(session.id) }, reject)
    })
  })
}

/** Goal-owned round numbers in durable user-message order. */
/* 按持久用户消息顺序提取 Goal 来源的轮次编号。 */
function goalRounds(events: readonly SessionEvent[]): number[] {
  return events.flatMap(event => event.type === 'user/message' && event.data.source.kind === 'goal'
    ? [event.data.source.round]
    : [])
}

/** Objective written by each durable Goal creation. */
/* 提取每次持久 Goal create 事件写入的目标文本。 */
function createdObjectives(events: readonly SessionEvent[]): string[] {
  return events.flatMap(event => event.type === 'goal/change' && event.data.operation === 'create'
    ? [event.data.goal.objective]
    : [])
}

describe('web e2e: Goal keeps one assistant action row per completed turn', () => {
  /** 当前用例启动的 Web 脚手架。 */
  let scaffold: WebScaffold | undefined
  /** 当前用例启动的 Chromium。 */
  let browser: Browser | undefined
  /** 当前用例交互页面。 */
  let page: Page
  /** 页面错误与警告监视器。 */
  let tripwire: ReturnType<typeof watchConsole>
  /** 当前 Goal 运行捕获的会话事件。 */
  let sessionEvents: SessionEvent[]

  afterEach(async () => {
    /** 浏览器、服务或清理阶段聚合的错误。 */
    const failures: unknown[] = []
    await browser?.close().catch((error: unknown) => failures.push(error))
    browser = undefined
    /** 释放前暂存的脚手架引用。 */
    const closing = scaffold
    scaffold = undefined
    await closing?.close().catch((error: unknown) => failures.push(error))
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'goal-multi-turn-actions teardown failed')
  })

  /** Boot the real Web composition and connect a fresh package fixture workspace. */
  /* 启动真实 Web 组合并连接带固定包清单的新工作区。 */
  async function launch(): Promise<void> {
    sessionEvents = []
    scaffold = await launchWebScaffold(
      MODE === 'record' ? {} : { replayFixture: FIXTURE, replayOverride: OVERRIDE },
    )
    await seedPackageInventory(scaffold.workspaceCwd)
    scaffold.ctx.on('session/event', (_session, event: SessionEvent) => { sessionEvents.push(event) })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }

  /** Submit the Goal command after arming the two-turn barrier. */
  /* 在安装两轮结束屏障后提交 Goal 命令。 */
  async function runGoal(timeoutMs: number): Promise<SessionId> {
    const input = page.locator('[data-composer-input]').first()
    await input.waitFor({ timeout: 10_000 })
    /** 等待两个持久轮次结束的 Promise。 */
    const settled = whenTurnsSettled(scaffold!, 2, timeoutMs)
    await input.fill(COMMAND)
    await input.press('Enter')
    return settled
  }

  it.skipIf(MODE !== 'record')('records the two-round Goal through the real model', async () => {
    await launch()
    onTestFailed(() => saveFailureShot(page, 'web-e2e-goal-multi-turn-actions-record'))
    /** 真实模型记录完成后的会话编号。 */
    const sessionId = await runGoal(360_000)
    await recordFixture(scaffold!, sessionId, FIXTURE)
  }, 380_000)

  it.skipIf(MODE === 'record')('keeps actions on both completed Goal turn tails', async () => {
    /** 已提交夹具解析出的持久会话事件。 */
    const fixtureEvents = parseSessionLog(await readFile(FIXTURE, 'utf8'))
    expect(createdObjectives(fixtureEvents)).toEqual([PROMPT])
    expect(goalRounds(fixtureEvents)).toEqual([1, 2])

    await launch()
    onTestFailed(() => saveFailureShot(page, 'web-e2e-goal-multi-turn-actions'))
    await runGoal(120_000)

    expect(sessionEvents.flatMap(event => event.type === 'turn/end' ? [event.data.turn] : []))
      .toEqual([1, 2])
    expect(goalRounds(sessionEvents)).toEqual([1, 2])
    expect(sessionEvents.flatMap(event =>
      event.type === 'request/header' ? [event.data.reason] : [])).toEqual(['initial', 'series'])
    await expect.poll(() => page.locator('[data-turn-process]').count(), { timeout: 15_000 }).toBe(2)
    expect(await page.getByRole('button', { name: 'System prompt' }).count()).toBe(2)
    expect(await page.locator(
      '[data-chat-flow-kind="system-prompt"][hidden="until-found"]',
    ).count()).toBe(0)
    const branchButtons = page.getByRole('button', { name: 'Branch into a new conversation' })
    await expect.poll(() => branchButtons.count(), { timeout: 15_000 }).toBe(2)
    expect(await branchButtons.evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-disabled'))))
      .toEqual([null, null])
    await branchButtons.last().focus()
    /** 两轮目标答案与操作区的归一化 ARIA 树。 */
    const snapshot = await captureStableAria(page, '[class*="centerCol"]', scaffold!.workspaceCwd)
    await compareOrRefreshGolden(UI_EXPECTED, snapshot, MODE)
    const expanded = await captureExpandedTurnProcessAria(
      page,
      '[class*="centerCol"]',
      scaffold!.workspaceCwd,
    )
    await compareOrRefreshGolden(UI_EXPANDED_EXPECTED, expanded, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 140_000)

  it.skipIf(MODE === 'record')('keeps a closed fixture inventory', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, [
      'replay.override.json', 'session.v2.jsonl', 'ui.expected.md', 'ui-expanded.expected.md',
    ])
  })
})
