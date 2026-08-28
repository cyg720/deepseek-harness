// Long-history Chat behavior contract that stays valid under a virtualized
// renderer: wheel input only navigates to the semantic target; assertions pin
// content identity and interaction routing rather than scroll geometry or
// mounted row counts.
// 滚轮只用于导航到语义目标，断言固定内容身份和交互路由，不依赖几何或挂载行数。
/**
 * 文件职责：验证虚拟化长聊天中异构行、工具调用、分叉和继续回复始终绑定正确语义身份。
 * 技术维度：使用 Playwright、88 轮确定性夹具、会话事件键、模型回放和真实分叉操作。
 * 产品维度：用户在很长历史中展开工具、复制内容或从旧轮次分叉时不会操作到错误消息。
 * 逻辑维度：播种长历史并定位末轮工具，验证行顺序与独立展开，再定位分叉轮并继续对话。
 * 关键边界：滚动实现可替换，测试不固定 DOM 数量或像素位置；记录模式不运行该确定性断言。
 * 新手阅读建议：先看 FIXTURE 的关键轮次，再读 requiredEvent 和语义键函数，最后看交互用例。
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import type { ReplayEntry, ReplayOverrideDoc } from '@deepseek-ai/dsh-llm-replay'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { createChatScrollFixture } from './chat-scroll-fixture.ts'
import {
  launchWebScaffold,
  seedSession,
  watchConsole,
  webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { conversationContextKey, expandOwningTurnProcess, newEnglishPage, saveFailureShot } from './support.ts'

/** 当前快照运行模式。 */
const MODE = webSnapshotMode()
/** 播种长历史会话的固定编号。 */
const SESSION_ID = 'chat-long-interactions-e2e'
/** 夹具包含的总轮数。 */
const FIXTURE_TURNS = 88
/** 含两次 Bash 调用的最后一轮。 */
const TOOL_TURN = FIXTURE_TURNS
/** 用于验证分叉的历史轮次。 */
const BRANCH_TURN = 80
/** 目标轮第一条工具调用编号。 */
const TARGET_CALL_1 = 'chat-scroll-088-1'
/** 目标轮第二条工具调用编号。 */
const TARGET_CALL_2 = 'chat-scroll-088-2'
/** 分叉后继续对话的用户提示。 */
const CONTINUE_PROMPT = 'CHAT_INTERACTION_CONTINUE Continue from this exact branch point.'
/** 分叉后回复的首增量标记。 */
const CONTINUE_FIRST = 'CHAT_INTERACTION_CONTINUE_FIRST'
/** 分叉后回复的完成标记。 */
const CONTINUE_DONE = 'CHAT_INTERACTION_CONTINUE_DONE'
/** 具有稳定消息和工具标记的 88 轮聊天夹具。 */
const FIXTURE = createChatScrollFixture({
  markerPrefix: 'INTERACTION',
  title: 'CHAT_INTERACTION long semantic identity session',
  turns: FIXTURE_TURNS,
})

/** 生成分叉后唯一一次模型继续回复的确定性增量。 */
function continuationChunks(): StreamChunk[] {
  /** 所有增量拼接后的最终回复。 */
  const response = `${CONTINUE_FIRST} The fork retained the intended prefix. ${CONTINUE_DONE}.`
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: `${CONTINUE_FIRST} ` },
    { type: 'text-delta', index: 0, text: `The fork retained the intended prefix. ${CONTINUE_DONE}.` },
    { type: 'block-end', index: 0, block: { type: 'text', text: response } },
    { type: 'usage', usage: { inputTokens: 512, outputTokens: 32 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/** 把增量数组包装为回放提供方条目。 */
function replayEntry(chunks: StreamChunk[]): ReplayEntry {
  return { kind: 'chunks', chunks }
}

/** 判断任意会话事件序列化后是否携带目标标记。 */
function carries(event: SessionEvent, marker: string): boolean {
  return JSON.stringify(event).includes(marker)
}

/** 从未知内容块数组中安全提取所有文本。 */
function textContent(content: readonly unknown[]): string {
  return content.flatMap((block) => {
    if (typeof block !== 'object' || block === null) return []
    /** 只读取 type 和 text 的内容块视图。 */
    const candidate = block as { type?: unknown; text?: unknown }
    return candidate.type === 'text' && typeof candidate.text === 'string'
      ? [candidate.text]
      : []
  }).join('')
}

/** 等待字体完成并跨过两帧，使虚拟列表布局稳定。 */
async function nextPaint(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise<void>(resolve => requestAnimationFrame(() => {
      requestAnimationFrame(() => { resolve() })
    }))
  })
}

/** 通过会话搜索打开播种长历史并等待最后一轮渲染。 */
async function openSeed(page: Page): Promise<void> {
  // The compact layout dropped group session counts; the seeded baseline is
  // the Ungrouped bucket once cold summaries load.
  // 紧凑布局取消分组计数，冷摘要完成后以 Ungrouped 行作为加载屏障。
  await page.getByText('Ungrouped', { exact: true }).waitFor({ timeout: 30_000 })
  // Search collapsed into a header action; expand it before filling.
  // 搜索收进头部操作，填入查询前先确保它已展开。
  /** 会话搜索展开按钮。 */
  const searchButton = page.getByRole('button', { name: 'Search sessions' })
  if (await searchButton.getAttribute('aria-expanded') !== 'true') await searchButton.click()
  /** 会话搜索输入框。 */
  const search = page.getByRole('textbox', { name: 'Search sessions...', exact: true })
  await search.fill(FIXTURE.markers.user(1))
  /** 搜索结果树中的会话行集合。 */
  const results = page.getByRole('tree', { name: 'Search results' }).getByRole('treeitem')
  await results.first().waitFor({ timeout: 60_000 })
  /** 搜索返回的会话行数量，必须精确为一。 */
  const resultCount = await results.count()
  if (resultCount !== 1) throw new Error(`expected one seeded search result, received ${String(resultCount)}`)
  await results.click()
  await results.click()
  await page.getByText(FIXTURE.markers.assistant(FIXTURE.turns), { exact: false })
    .last().waitFor({ timeout: 30_000 })
  await nextPaint(page)
}

/** 使用滚轮逐步导航，直到虚拟列表挂载目标选择器。 */
async function wheelUntilMounted(page: Page, selector: string, deltaY: number): Promise<void> {
  /** 真实聊天外层滚动容器。 */
  const scrollport = page.locator('[data-conversation-scroll]')
  /** 用于把鼠标移入滚动区域的布局框。 */
  const box = await scrollport.boundingBox()
  if (box === null) throw new Error('conversation scrollport has no layout box')
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(140, box.height / 3))
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await page.locator(selector).count() > 0) return
    await page.mouse.wheel(0, deltaY)
    await nextPaint(page)
  }
  throw new Error(`semantic Chat target did not mount: ${selector}`)
}

/** 从事件列表中取得指定类型且携带标记的必需事件。 */
function requiredEvent<T extends SessionEvent['type']>(
  events: readonly SessionEvent[],
  type: T,
  marker: string,
): Extract<SessionEvent, { type: T }> {
  /** 第一个类型和标记均匹配的事件。 */
  const event = events.find((candidate): candidate is Extract<SessionEvent, { type: T }> => (
    candidate.type === type && carries(candidate, marker)
  ))
  if (event === undefined) throw new Error(`${type} carrying ${marker} is absent`)
  return event
}

/** 计算用户消息行的稳定聊天语义键。 */
function messageKey(event: SessionEvent<'user/message'>): string {
  return conversationContextKey('input-message', String(event.data.id))
}

/** 计算助手步骤行的稳定聊天语义键。 */
function assistantKey(event: SessionEvent<'assistant/message'>): string {
  return conversationContextKey('assistant-step', `${event.data.turn}:${event.data.step}`)
}

/** 计算指定轮次尾部操作行的稳定聊天语义键。 */
function turnTailKey(turn: number): string {
  return conversationContextKey('turn-tail', String(turn))
}

describe('web e2e: long Chat interaction contract', () => {
  /** 本场景使用的 Chromium 实例。 */
  let browser: Browser
  /** 打开长历史会话的页面。 */
  let page: Page
  /** 临时回放覆盖目录。 */
  let replayDir: string
  /** 真实 Web 主机与工作区夹具。 */
  let scaffold: WebScaffold
  /** 页面错误和警告监视器。 */
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    replayDir = await mkdtemp(join(tmpdir(), 'dsh-chat-interaction-replay-'))
    /** 回放覆盖 JSON 路径。 */
    const replayOverride = join(replayDir, 'replay.override.json')
    /** 只包含分叉继续回复的回放脚本。 */
    const replay: ReplayOverrideDoc = [replayEntry(continuationChunks())]
    await writeFile(replayOverride, JSON.stringify(replay))
    scaffold = await launchWebScaffold({
      replayFixture: join(replayDir, 'override-only.jsonl'),
      replayOverride,
      replayContextWindow: 10_000_000,
      paceMs: 18,
    })
    await seedSession(scaffold, FIXTURE.log, SESSION_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser, 900)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await openSeed(page)
  }, 120_000)

  afterAll(async () => {
    /** 清理浏览器、服务或临时目录时聚合的错误。 */
    const failures: unknown[] = []
    await browser?.close().catch((error: unknown) => failures.push(error))
    await scaffold?.close().catch((error: unknown) => failures.push(error))
    if (replayDir !== undefined) {
      await rm(replayDir, { recursive: true, force: true })
        .catch((error: unknown) => failures.push(error))
    }
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'long Chat interaction cleanup failed')
  })

  it.skipIf(MODE === 'record')('keeps heterogeneous rows and their actions bound to exact semantic identities', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-chat-long-interactions'))
    const source = scaffold.ctx.agents.get(SessionId(SESSION_ID))
    if (source === undefined) throw new Error('seeded long-history agent is not attached')

    const toolUserMarker = FIXTURE.markers.user(TOOL_TURN)
    const toolAssistantMarker = FIXTURE.markers.assistant(TOOL_TURN)
    const toolMarker1 = FIXTURE.markers.tool(TOOL_TURN, 1)
    const toolMarker2 = FIXTURE.markers.tool(TOOL_TURN, 2)
    const toolUserEvent = requiredEvent(source.session.events, 'user/message', toolUserMarker)
    const toolAssistantEvent = requiredEvent(source.session.events, 'assistant/message', toolAssistantMarker)
    const branchUserMarker = FIXTURE.markers.user(BRANCH_TURN)
    const branchAssistantMarker = FIXTURE.markers.assistant(BRANCH_TURN)
    const branchUserEvent = requiredEvent(source.session.events, 'user/message', branchUserMarker)
    const branchAssistantEvent = requiredEvent(source.session.events, 'assistant/message', branchAssistantMarker)
    const boundary = source.session.events.find((event): event is SessionEvent<'turn/end'> => (
      event.type === 'turn/end' && event.data.turn === BRANCH_TURN
    ))
    if (boundary === undefined) throw new Error(`turn ${String(BRANCH_TURN)} has no turn/end event`)
    const expectedUserText = textContent(branchUserEvent.data.content)

    const turnNavigation = page.getByRole('navigation', { name: 'Turn navigation' })
    await turnNavigation.waitFor({ state: 'visible', timeout: 15_000 })
    const initialTurnButtons = turnNavigation.getByRole('button')
    const initialTurnCount = await initialTurnButtons.count()
    expect(initialTurnCount).toBeGreaterThan(1)
    expect(await initialTurnButtons.last().getAttribute('aria-current')).toBe('true')
    const firstTurnButton = initialTurnButtons.first()
    const firstTurnLabel = await firstTurnButton.getAttribute('aria-label')
    if (firstTurnLabel === null) throw new Error('first Turn navigation mark has no accessible label')
    const firstTurn = Number(firstTurnLabel.match(/^Jump to turn (\d+)$/)?.[1])
    expect(Number.isSafeInteger(firstTurn)).toBe(true)
    await firstTurnButton.focus()
    const preview = page.getByRole('tooltip')
    await preview.waitFor({ state: 'visible', timeout: 5_000 })
    // The first loaded Turn may begin mid-Turn at a page boundary. Its mark is
    // still useful with the loaded response and gains the prompt after prepend.
    expect(await preview.textContent()).toContain(`Turn ${String(firstTurn)}`)
    expect(await preview.textContent()).toContain(FIXTURE.markers.assistant(firstTurn))
    const firstTurnPosition = await firstTurnButton.evaluate(button => (
      button.parentElement?.style.getPropertyValue('--turn-position') ?? ''
    ))
    expect(firstTurnPosition).toBe('0%')

    const loadEarlier = page.getByRole('button', { name: 'Load earlier', exact: true })
    await loadEarlier.click()
    await expect.poll(() => turnNavigation.getByRole('button').count(), { timeout: 15_000 })
      .toBeGreaterThan(initialTurnCount)
    const stableFirstTurnButton = turnNavigation.getByRole('button', { name: firstTurnLabel })
    expect(await stableFirstTurnButton.evaluate(button => (
      button.parentElement?.style.getPropertyValue('--turn-position') ?? ''
    ))).not.toBe(firstTurnPosition)
    await stableFirstTurnButton.focus()
    await expect.poll(() => preview.textContent(), { timeout: 5_000 })
      .toContain(FIXTURE.markers.user(firstTurn))
    expect(await preview.textContent()).toContain(FIXTURE.markers.assistant(firstTurn))
    await stableFirstTurnButton.press('Enter')
    await expect.poll(() => stableFirstTurnButton.getAttribute('aria-current'), { timeout: 5_000 }).toBe('true')
    await expect.poll(
      () => page.locator(`[data-chat-turn="${String(firstTurn)}"][data-chat-flow-kind="user"]`).count(),
      { timeout: 5_000 },
    ).toBe(1)

    // Desktop-only affordance: a narrow Chat container hides the rail outright.
    await page.setViewportSize({ width: 800, height: 900 })
    await turnNavigation.waitFor({ state: 'hidden', timeout: 5_000 })
    await page.setViewportSize({ width: 1_680, height: 900 })
    await turnNavigation.waitFor({ state: 'visible', timeout: 5_000 })

    await wheelUntilMounted(page, `[data-chat-call-id="${TARGET_CALL_2}"]`, -1_100)
    const toolUserKey = messageKey(toolUserEvent)
    const toolAssistantKey = assistantKey(toolAssistantEvent)
    const toolUserRow = page.locator(`[data-chat-anchor-key="${toolUserKey}"]`)
    const toolAssistantRow = page.locator(`[data-chat-anchor-key="${toolAssistantKey}"]`)
    const call1 = page.locator(`[data-chat-call-id="${TARGET_CALL_1}"]`)
    const call2 = page.locator(`[data-chat-call-id="${TARGET_CALL_2}"]`)

    await expect.poll(() => toolUserRow.count(), { timeout: 10_000 }).toBe(1)
    await expect.poll(() => toolAssistantRow.count(), { timeout: 10_000 }).toBe(1)
    expect(await call1.count()).toBe(1)
    expect(await call2.count()).toBe(1)
    expect(await toolUserRow.getAttribute('data-chat-flow-kind')).toBe('user')
    expect(await toolAssistantRow.getAttribute('data-chat-flow-kind')).toBe('assistant-step')
    expect(await toolUserRow.textContent()).toContain(toolUserMarker)
    expect(await toolAssistantRow.textContent()).toContain(toolAssistantMarker)
    expect(await call1.textContent()).toContain(toolMarker1)
    expect(await call2.textContent()).toContain(toolMarker2)

    const expectedOrder = [
      toolUserKey,
      conversationContextKey('tool-call', TARGET_CALL_1),
      conversationContextKey('tool-call', TARGET_CALL_2),
      toolAssistantKey,
    ]
    const actualOrder = await page.locator('[data-chat-anchor-key]').evaluateAll((rows, keys) => (
      rows.map(row => (row as HTMLElement).dataset.chatAnchorKey)
        .filter((key): key is string => key !== undefined && keys.includes(key))
    ), expectedOrder)
    expect(actualOrder).toEqual(expectedOrder)
    const toolKinds = await Promise.all([call1, call2].map(row => row.evaluate(element => (
      element.closest<HTMLElement>('[data-chat-flow-kind]')?.dataset.chatFlowKind ?? null
    ))))
    expect(toolKinds).toEqual(['tool-call', 'tool-call'])

    const summary1 = call1.locator('[data-sample="bash"]')
    const summary2 = call2.locator('[data-sample="bash"]')
    await expandOwningTurnProcess(page, call2)
    expect(await summary1.getAttribute('aria-expanded')).toBe('false')
    expect(await summary2.getAttribute('aria-expanded')).toBe('false')
    await summary2.focus()
    await summary2.press('Enter')
    await expect.poll(() => summary2.getAttribute('aria-expanded'), { timeout: 10_000 }).toBe('true')
    expect(await summary1.getAttribute('aria-expanded')).toBe('false')
    await call2.getByText(`${toolMarker2} output line 12`, { exact: true }).waitFor({ timeout: 10_000 })

    const branchUserKey = messageKey(branchUserEvent)
    const branchAssistantKey = assistantKey(branchAssistantEvent)
    await wheelUntilMounted(page, `[data-chat-anchor-key="${branchUserKey}"]`, -1_100)
    const userRow = page.locator(`[data-chat-anchor-key="${branchUserKey}"]`)
    const assistantRow = page.locator(`[data-chat-anchor-key="${branchAssistantKey}"]`)
    const turnTailRow = page.locator(`[data-chat-anchor-key="${turnTailKey(BRANCH_TURN)}"]`)
    expect(await userRow.textContent()).toContain(branchUserMarker)
    expect(await assistantRow.textContent()).toContain(branchAssistantMarker)
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await userRow.hover()
    await userRow.getByRole('button', { name: 'Copy', exact: true }).click()
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()), { timeout: 5_000 })
      .toBe(expectedUserText)

    await turnTailRow.hover()
    await turnTailRow.getByRole('button', { name: 'Branch into a new conversation', exact: true }).click()
    await expect.poll(
      () => scaffold.ctx.agents.list().find(agent => agent.session.header.parentSession === SessionId(SESSION_ID)),
      { timeout: 15_000 },
    ).toBeDefined()
    const child = scaffold.ctx.agents.list()
      .find(agent => agent.session.header.parentSession === SessionId(SESSION_ID))
    if (child === undefined) throw new Error('message branch did not create a child session')
    expect(child.session.header.seedLength).toBe(boundary.seq + 1)
    expect(child.session.events.some(event => carries(event, branchAssistantMarker))).toBe(true)
    expect(child.session.events.some(event => carries(event, FIXTURE.markers.user(BRANCH_TURN + 1)))).toBe(false)
    expect(child.session.events.some(event => carries(event, FIXTURE.markers.user(FIXTURE.turns)))).toBe(false)

    const currentCrumb = page.getByRole('navigation', { name: 'Session hierarchy' })
      .getByRole('button').last()
    await expect.poll(() => currentCrumb.textContent(), { timeout: 15_000 })
      .toBe(`${FIXTURE.title} (1)`)
    await page.getByText(branchAssistantMarker, { exact: false }).last().waitFor({ timeout: 15_000 })
    const settled = scaffold.whenTurnSettled(60_000)
    const composer = page.locator('[data-composer-input][contenteditable="true"]').last()
    await composer.fill(CONTINUE_PROMPT)
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect.poll(() => page.getByText(CONTINUE_PROMPT, { exact: true }).count(), { timeout: 15_000 }).toBe(1)
    expect(await settled).toBe(child.session.id)
    await page.getByText(CONTINUE_DONE, { exact: false }).last().waitFor({ timeout: 15_000 })
    await expect.poll(() => page.locator('[data-streaming="true"]').count(), { timeout: 15_000 }).toBe(0)
    expect(await composer.textContent()).toBe('')
    expect(await composer.isEnabled()).toBe(true)
    expect(source.session.events.some(event => carries(event, CONTINUE_PROMPT))).toBe(false)
    expect(child.session.events.filter(event => (
      event.type === 'user/message' && carries(event, CONTINUE_PROMPT)
    ))).toHaveLength(1)
    const lastTurnEnd = child.session.events.findLast((event): event is SessionEvent<'turn/end'> => (
      event.type === 'turn/end'
    ))
    expect(lastTurnEnd?.data.reason).toEqual({ kind: 'completed' })
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 180_000)
})
