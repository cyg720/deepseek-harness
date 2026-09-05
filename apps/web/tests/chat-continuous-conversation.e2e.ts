// Web e2e contract for a conversation grown through the real composer rather
// than pre-seeded history. Twelve deterministic replay turns exercise repeated
// send/settle/render cycles, including two real bash executions and one long,
// multi-chunk final turn. Assertions stay semantic: no host timing, heap, or
// mounted-row cardinality is treated as a correctness contract.
// 断言只关注语义结果，不把宿主时序、内存或已挂载行数当成正确性标准。
/**
 * 文件职责：验证通过真实编辑器连续增长的十二轮会话在发送、工具执行和渲染中保持语义身份。
 * 技术维度：使用 Playwright、LLM 回放覆盖、真实 Bash 工具、会话事件和确定性增量流。
 * 产品维度：长时间连续对话不会丢失早期消息、工具结果或最终长回复，编辑器始终可继续使用。
 * 逻辑维度：生成十二轮规格和回放脚本，逐轮发送并等待完成，最后交叉检查 DOM 与会话日志。
 * 关键边界：记录模式跳过生成式场景；临时回放目录、浏览器和服务即使失败也必须全部清理。
 * 新手阅读建议：先看 turnSpec 如何描述一轮，再比较 textStream/toolStream，最后读十二轮断言。
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { ToolCallId, expandAssistantStream, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type { ReplayEntry, ReplayOverrideDoc } from '@deepseek-ai/dsh-llm-replay'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import {
  launchWebScaffold,
  watchConsole,
  webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import {
  connectFreshWorkspace, conversationContextKey, expandOwningTurnProcess, newEnglishPage, saveFailureShot,
} from './support.ts'

/** 当前 Web 快照运行模式。 */
const MODE = webSnapshotMode()
/** 连续对话总轮数。 */
const TURN_COUNT = 12
/** 需要真实执行 Bash 工具的轮次。 */
const TOOL_TURNS = [4, 9] as const
/** 回放增量之间的发送间隔，单位毫秒。 */
const STREAM_PACE_MS = 10

/** 一轮连续对话的用户标记、回复增量和可选工具身份。 */
interface TurnSpec {
  readonly index: number
  readonly prompt: string
  readonly userMarker: string
  readonly firstMarker: string
  readonly doneMarker: string
  readonly deltas: readonly string[]
  readonly callId?: ReturnType<typeof ToolCallId>
  readonly toolResultMarker?: string
}

/** 把轮次编号补齐为三位稳定后缀。 */
function suffix(index: number): string {
  return String(index).padStart(3, '0')
}

/** 为最后一轮生成足够长、包含早期所有权要求的多行提示。 */
function longFinalPrompt(userMarker: string): string {
  return [
    `${userMarker} Reconcile this accumulated conversation without losing earlier turn ownership.`,
    ...Array.from(
      { length: 36 },
      (_, index) => `Context ${String(index + 1).padStart(2, '0')}: preserve token-${String(index)} and verify ${'payload '.repeat(12).trimEnd()}.`,
    ),
    'Return one continuous response and finish with the requested completion marker.',
  ].join('\n')
}

/** 根据轮次生成普通或工具轮的完整确定性规格。 */
function turnSpec(index: number): TurnSpec {
  /** 三位轮次标识。 */
  const id = suffix(index)
  /** 当前轮用户消息中的唯一标记。 */
  const userMarker = `CONTINUOUS_CHAT_USER_${id}`
  /** 当前轮首个模型增量标记。 */
  const firstMarker = `CONTINUOUS_CHAT_FIRST_${id}`
  /** 当前轮完成标记。 */
  const doneMarker = `CONTINUOUS_CHAT_DONE_${id}`
  /** 最终轮比普通轮发送更多增量。 */
  const deltaCount = index === TURN_COUNT ? 36 : 8
  /** 当前轮依次回放的文本增量。 */
  const deltas = Array.from({ length: deltaCount }, (_, chunkIndex) => {
    if (chunkIndex === 0) return `${firstMarker} `
    if (chunkIndex === deltaCount - 1) return `${doneMarker}.`
    return `turn-${id}-chunk-${String(chunkIndex).padStart(2, '0')} keeps semantic ownership stable. `
  })
  if (!TOOL_TURNS.includes(index as (typeof TOOL_TURNS)[number])) {
    return {
      index,
      prompt: index === TURN_COUNT
        ? longFinalPrompt(userMarker)
        : `${userMarker} Continue this same conversation through turn ${String(index)}.`,
      userMarker,
      firstMarker,
      doneMarker,
      deltas,
    }
  }
  return {
    index,
    prompt: `${userMarker} Run the requested deterministic tool for turn ${String(index)}, then continue.`,
    userMarker,
    firstMarker,
    doneMarker,
    deltas,
    callId: ToolCallId(`continuous-chat-tool-${id}`),
    toolResultMarker: `CONTINUOUS_CHAT_TOOL_RESULT_${id}`,
  }
}

/** 把普通轮规格转换为完整 LLM 文本流。 */
function textStream(spec: TurnSpec): StreamChunk[] {
  /** 所有增量拼接后的最终助手文本。 */
  const response = spec.deltas.join('')
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    ...spec.deltas.map(text => ({ type: 'text-delta' as const, index: 0, text })),
    { type: 'block-end', index: 0, block: { type: 'text', text: response } },
    {
      type: 'usage',
      usage: {
        inputTokens: Math.ceil(spec.prompt.length / 4),
        outputTokens: Math.ceil(response.length / 4),
      },
    },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/** 把工具轮规格转换为 Bash 工具调用流。 */
function toolStream(spec: TurnSpec): StreamChunk[] {
  if (spec.callId === undefined || spec.toolResultMarker === undefined) {
    throw new Error(`turn ${String(spec.index)} has no tool identity`)
  }
  /** 发送给 Bash 工具的 JSON 参数文本。 */
  const args = JSON.stringify({
    command: `printf '${spec.toolResultMarker}\\n'`,
    description: spec.toolResultMarker,
  })
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    {
      type: 'tool-call-delta',
      index: 0,
      id: spec.callId,
      name: 'bash',
      argumentsDelta: args,
    },
    {
      type: 'block-end',
      index: 0,
      block: { type: 'tool-call', id: spec.callId, name: 'bash', arguments: args },
    },
    { type: 'usage', usage: { inputTokens: 256, outputTokens: 24 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

/** 将轮次规格展开为回放提供方按调用顺序消费的条目。 */
function replayScript(specs: readonly TurnSpec[]): ReplayOverrideDoc {
  return specs.flatMap((spec): ReplayEntry[] => {
    /** 当前轮最终文本回复条目。 */
    const final: ReplayEntry = { kind: 'chunks', chunks: textStream(spec) }
    return spec.callId === undefined
      ? [final]
      : [{ kind: 'chunks', chunks: toolStream(spec) }, final]
  })
}

/** 提取用户消息事件中的全部文本块。 */
function userText(event: Extract<SessionEvent, { type: 'user/message' }>): string {
  return event.data.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

/** 提取助手消息事件中的全部文本块。 */
function assistantText(event: Extract<SessionEvent, { type: 'assistant/message' }>): string {
  return event.data.message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

/** 提取工具结果事件首条消息中的全部文本块。 */
function toolResultText(event: Extract<SessionEvent, { type: 'tool/result' }>): string {
  return event.data.message.content[0].content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

/** 计算用户消息在聊天虚拟列表中的稳定语义键。 */
function messageKey(event: SessionEvent<'user/message'>): string {
  return conversationContextKey('input-message', String(event.data.id))
}

/** 计算助手步骤在聊天虚拟列表中的稳定语义键。 */
function assistantKey(event: SessionEvent<'assistant/message'>): string {
  return conversationContextKey('assistant-step', `${event.data.turn}:${event.data.step}`)
}

describe('web e2e: continuous conversation grown through the composer', () => {
  /** 本场景使用的 Chromium 实例。 */
  let browser: Browser
  /** 连续发送十二轮消息的页面。 */
  let page: Page
  /** 临时回放覆盖目录。 */
  let replayDir: string
  /** 真实 Web 主机与工作区夹具。 */
  let scaffold: WebScaffold
  /** 页面错误和一般警告监视器。 */
  let tripwire: ReturnType<typeof watchConsole>
  /** 额外捕获的控制台 warning 文本。 */
  const consoleWarnings: string[] = []
  /** 主机持久化的全部会话事件。 */
  const sessionEvents: SessionEvent[] = []
  /** 十二轮按顺序生成的确定性规格。 */
  const specs = Array.from({ length: TURN_COUNT }, (_, offset) => turnSpec(offset + 1))

  beforeAll(async () => {
    replayDir = await mkdtemp(join(tmpdir(), 'dsh-continuous-chat-replay-'))
    /** 回放提供方读取的覆盖 JSON 文件。 */
    const replayOverride = join(replayDir, 'replay.override.json')
    await writeFile(replayOverride, JSON.stringify(replayScript(specs)))
    scaffold = await launchWebScaffold({
      replayFixture: join(replayDir, 'override-only.jsonl'),
      replayOverride,
      replayContextWindow: 10_000_000,
      paceMs: STREAM_PACE_MS,
    })
    scaffold.ctx.on('session/event', (_session, event: SessionEvent) => {
      sessionEvents.push(event)
    })
    browser = await chromium.launch()
    page = await newEnglishPage(browser, 900)
    tripwire = watchConsole(page)
    page.on('console', (message) => {
      if (message.type() === 'warning') consoleWarnings.push(message.text())
    })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd, 'continuous-chat-e2e')
  }, 120_000)

  afterAll(async () => {
    /** 清理浏览器、服务或临时目录时收集的错误。 */
    const failures: unknown[] = []
    await browser?.close().catch((error: unknown) => failures.push(error))
    await scaffold?.close().catch((error: unknown) => failures.push(error))
    if (replayDir !== undefined) {
      await rm(replayDir, { recursive: true, force: true })
        .catch((error: unknown) => failures.push(error))
    }
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'continuous Chat e2e cleanup failed')
  })

  it.skipIf(MODE === 'record')('keeps twelve generated turns and tool rows bound to one live session', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-chat-continuous-conversation'))
    const composer = page.locator('[data-composer-input][contenteditable="true"]').last()
    await composer.waitFor({ timeout: 15_000 })
    let sessionId: SessionId | undefined

    for (const spec of specs) {
      const eventStart = sessionEvents.length
      expect(await composer.textContent()).toBe('')
      expect(await composer.isEnabled()).toBe(true)
      await composer.fill(spec.prompt)
      expect(await composer.textContent()).toBe(spec.prompt)

      const settled = scaffold.whenTurnSettled(60_000)
      await page.getByRole('button', { name: 'Send message', exact: true }).click()
      await page.getByText(spec.userMarker, { exact: false }).last().waitFor({ timeout: 15_000 })
      await expect.poll(() => sessionEvents.slice(eventStart).some(event => (
        event.type === 'user/message'
        && event.data.source.kind === 'user'
        && userText(event).includes(spec.userMarker)
      )), { timeout: 15_000 }).toBe(true)
      const echoedUser = sessionEvents.slice(eventStart).find(
        (event): event is SessionEvent<'user/message'> => (
          event.type === 'user/message'
          && event.data.source.kind === 'user'
          && userText(event).includes(spec.userMarker)
        ),
      )
      if (echoedUser === undefined) throw new Error(`turn ${String(spec.index)} has no user echo event`)
      const userRow = page.locator(`[data-chat-anchor-key="${messageKey(echoedUser)}"]`)
      await expect.poll(() => userRow.count(), { timeout: 10_000 }).toBe(1)
      expect(await userRow.getAttribute('data-chat-flow-kind')).toBe('user')
      expect(await userRow.textContent()).toContain(spec.userMarker)
      await page.getByText(spec.firstMarker, { exact: false }).last().waitFor({ timeout: 15_000 })
      const settledSessionId = await settled
      if (sessionId === undefined) {
        sessionId = settledSessionId
      } else {
        expect(settledSessionId).toBe(sessionId)
      }

      await expect.poll(() => page.locator('[data-streaming="true"]').count(), { timeout: 15_000 }).toBe(0)
      await page.getByText(spec.doneMarker, { exact: false }).last().waitFor({ timeout: 15_000 })
      await expect.poll(() => composer.textContent(), { timeout: 10_000 }).toBe('')
      await expect.poll(() => composer.isEnabled(), { timeout: 10_000 }).toBe(true)

      const turnEvents = sessionEvents.slice(eventStart)
      const turnStarts = turnEvents.filter((event): event is SessionEvent<'turn/start'> => (
        event.type === 'turn/start'
      ))
      const users = turnEvents.filter((event): event is SessionEvent<'user/message'> => (
        event.type === 'user/message' && event.data.source.kind === 'user'
      ))
      const assistants = turnEvents.filter((event): event is SessionEvent<'assistant/message'> => (
        event.type === 'assistant/message'
      ))
      const finalAssistants = assistants.filter(event => assistantText(event).includes(spec.doneMarker))
      const turnEnds = turnEvents.filter((event): event is SessionEvent<'turn/end'> => (
        event.type === 'turn/end'
      ))
      const chunks = turnEvents.flatMap(event => (
        event.type === 'assistant/message' || event.type === 'assistant/attempt'
          ? expandAssistantStream(event.data.stream)
          : []
      ))

      expect(turnStarts).toHaveLength(1)
      expect(turnStarts[0]?.data.turn).toBe(spec.index)
      expect(users).toHaveLength(1)
      expect(users[0]?.seq).toBe(echoedUser.seq)
      expect(userText(users[0]!)).toBe(spec.prompt)
      expect(finalAssistants).toHaveLength(1)
      expect(assistants).toHaveLength(spec.callId === undefined ? 1 : 2)
      expect(turnEnds).toHaveLength(1)
      expect(turnEnds[0]?.data).toEqual({ turn: spec.index, reason: { kind: 'completed' } })
      expect(chunks).toHaveLength(spec.deltas.length + (spec.callId === undefined ? 4 : 9))

      const assistantRow = page.locator(`[data-chat-anchor-key="${assistantKey(finalAssistants[0]!)}"]`)
      await expect.poll(() => assistantRow.count(), { timeout: 10_000 }).toBe(1)
      expect(await assistantRow.getAttribute('data-chat-flow-kind')).toBe('assistant-step')
      expect(await assistantRow.textContent()).toContain(spec.doneMarker)

      const calls = turnEvents.filter((event): event is SessionEvent<'tool/call'> => event.type === 'tool/call')
      const results = turnEvents.filter((event): event is SessionEvent<'tool/result'> => event.type === 'tool/result')
      if (spec.callId === undefined || spec.toolResultMarker === undefined) {
        expect(calls).toHaveLength(0)
        expect(results).toHaveLength(0)
        continue
      }

      expect(calls).toHaveLength(1)
      expect(results).toHaveLength(1)
      expect(calls[0]?.data).toMatchObject({
        turn: spec.index,
        callId: spec.callId,
        name: 'bash',
      })
      expect(results[0]?.data.turn).toBe(spec.index)
      expect(results[0]?.data.message.source.callId).toBe(spec.callId)
      expect(results[0]?.data.message.content[0].isError).toBe(false)
      expect(toolResultText(results[0]!)).toBe(`${spec.toolResultMarker}\n`)

      const toolRow = page.locator(`[data-chat-call-id="${spec.callId}"]`)
      await expect.poll(() => toolRow.count(), { timeout: 10_000 }).toBe(1)
      expect(await toolRow.textContent()).toContain(spec.toolResultMarker)
      await expandOwningTurnProcess(page, toolRow)
      const disclosure = toolRow.locator('[data-sample="bash"]')
      expect(await disclosure.getAttribute('aria-expanded')).toBe('false')
      await disclosure.click()
      await expect.poll(() => disclosure.getAttribute('aria-expanded'), { timeout: 10_000 }).toBe('true')
      // The collapsed summary deliberately repeats the result marker; the
      // last exact match is the expanded terminal output owned by this call.
      await toolRow.getByText(spec.toolResultMarker, { exact: true }).last().waitFor({ timeout: 10_000 })
      await disclosure.click()
      await expect.poll(() => disclosure.getAttribute('aria-expanded'), { timeout: 10_000 }).toBe('false')
    }

    if (sessionId === undefined) throw new Error('continuous conversation completed no turn')
    expect(scaffold.ctx.agents.get(sessionId)?.session.snapshotEvents().filter(event => (
      event.type === 'turn/end' && event.data.reason.kind === 'completed'
    ))).toHaveLength(TURN_COUNT)
    expect(sessionEvents.flatMap(event =>
      event.type === 'request/header' ? [event.data.reason] : [])).toEqual(['initial'])
    expect(await page.getByRole('button', { name: 'System prompt' }).count()).toBe(1)
    expect(await page.locator(
      '[data-chat-flow-kind="system-prompt"][hidden="until-found"]',
    ).count()).toBe(0)
    expect(specs.at(-1)?.prompt.length).toBeGreaterThan(4_000)
    expect(sessionEvents.flatMap(event => (
      (event.type === 'assistant/message' || event.type === 'assistant/attempt')
        && event.data.turn === TURN_COUNT
        ? expandAssistantStream(event.data.stream)
        : []
    )).length).toBeGreaterThan(30)
    expect(consoleWarnings).toEqual([])
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 180_000)
})
