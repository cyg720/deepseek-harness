// Web e2e scenario (browserless): the subagent.interrupt RPC against the real
// composition. A live continuable child holds its model turn open through a
// replay hang entry; plain HTTP queues a follow-up, interrupts the turn, and
// proves from the real session state that the turn aborted, the follow-up
// parked without auto-starting a new turn, and a later waking send resumed the
// preserved FIFO order. No browser: the RPC surface is the product surface
// under test, and subagent-interrupt-ui.e2e.ts owns the composer interaction.
// 中文说明：不启动浏览器，直接通过真实 HTTP 产品接口验证子代理中止、跟进停放和后续先进先出恢复。
/**
 * 文件职责：验证 subagent.interrupt RPC 能中止可续接子代理当前回合而保留已排队跟进。
 * 技术维度：使用 Vitest、真实 Web 组合、HTTP RPC、挂起模型回放、会话状态和临时覆盖文件。
 * 产品维度：让外部客户端可靠停止子代理，并在稍后唤醒时继续未丢失的工作。
 * 逻辑维度：创建挂起子代理，HTTP 排入跟进并中止，检查回合状态，再发送唤醒消息验证执行顺序。
 * 关键边界：场景测试 RPC 而非浏览器；中止后队列不得自动开始；录制模式跳过并严格清理临时目录。
 * 新手阅读建议：先读 RpcResult 与 rpc，再看 waitFor 和 textCompletion，最后跟踪主场景的状态转换。
 */
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SessionId as sessionId, type SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent'
import { launchWebScaffold, webSnapshotMode, type WebScaffold } from './scaffold.ts'

/** 当前快照模式。 */
const MODE = webSnapshotMode()
/** 启动子代理首个挂起回合的消息。 */
const INITIAL = 'Explain event sourcing in one sentence.'
/** 中止前排入且必须保留的跟进消息。 */
const FOLLOWUP = 'Now give the same explanation to a human reader.'
/** 中止后触发队列继续执行的唤醒消息。 */
const WAKING = 'And add one concrete example.'

/** 一元 RPC 的成功值或带代码与消息的失败结果。 */
type RpcResult<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

/** POST one unary RPC through the real HTTP carrier and unwrap its result. */
/** 向 baseUrl 的 method 发送 payload 并返回业务结果。示例：await rpc(url, 'subagent.interrupt', payload)。 */
async function rpc<T>(baseUrl: string, method: string, payload: unknown): Promise<RpcResult<T>> {
  const response = await fetch(`${baseUrl}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: `interrupt-e2e-${method}-${crypto.randomUUID()}`,
      method,
      payload,
    }),
  })
  if (!response.ok) throw new Error(`${method} failed over HTTP ${response.status}: ${await response.text()}`)
  return (await response.json() as { result: RpcResult<T> }).result
}

/** Poll a synchronous condition (hook-safe; expect.poll is test-body only). */
/** 轮询 predicate；what 用于超时错误，timeoutMs 默认三十秒，成功时无返回值。 */
async function waitFor(predicate: () => boolean, what: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise<void>(resolve => setTimeout(resolve, 10))
  }
}

/** One text-only scripted model completion (no tool calls: real tools are mounted). */
/** 把 text 包装为一次无工具的完整模型回放对象。示例：textCompletion('done')。 */
function textCompletion(text: string): object {
  return {
    kind: 'chunks',
    chunks: [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text },
      { type: 'block-end', index: 0, block: { type: 'text', text } },
      { type: 'usage', usage: { inputTokens: 20, outputTokens: 8 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ],
  }
}

describe.skipIf(MODE === 'record')('web e2e: subagent.interrupt over the real composition', () => {
  let scaffold: WebScaffold
  let sidecarRoot: string
  let readyFile: string
  let parentId: SessionId
  let childId: SessionId

  beforeAll(async () => {
    sidecarRoot = await mkdtemp(join(tmpdir(), 'dsh-web-subagent-interrupt-'))
    readyFile = join(sidecarRoot, 'hang-ready')
    // Whole-script replacement: the child's three model calls are the hang
    // (turn 1, interrupted), the parked follow-up's turn, and the waking turn.
    // The parent never runs a turn, so the child claims this primary script.
    await writeFile(join(sidecarRoot, 'replay.override.json'), JSON.stringify([
      { kind: 'hang', readyFile },
      textCompletion('resumed response one'),
      textCompletion('resumed response two'),
    ]))
    // Header-only primary fixture: the bare-array override replaces the
    // derived script entirely; the path only anchors replay installation.
    await writeFile(
      join(sidecarRoot, 'session.jsonl'),
      '{"type":"session","version":0,"id":"primary","createdAt":0}\n',
    )
    scaffold = await launchWebScaffold({
      replayFixture: join(sidecarRoot, 'session.jsonl'),
      replayOverride: join(sidecarRoot, 'replay.override.json'),
    })

    // A live parent Agent through the real API; no workspace or browser.
    const created = await rpc<{ sessionId: string }>(scaffold.baseUrl, 'session.create', {
      cwd: scaffold.workspaceCwd,
    })
    if (!created.ok) throw new Error(`session.create failed: ${created.error.code}`)
    parentId = sessionId(created.value.sessionId)
    const parent = scaffold.ctx.agents.get(parentId)
    if (parent === undefined) throw new Error('created parent session did not publish a live Agent')

    const started = await scaffold.ctx.subagents.startContinuable({
      provider: 'spawn',
      label: 'event-sourcing researcher',
      signal: new AbortController().signal,
      request: { prompt: [{ type: 'text', text: INITIAL }], parent },
    })
    childId = started.childId
    // The hang entry writes readyFile after its prefix chunks, immediately
    // before waiting for cancellation: the deterministic "turn is open" gate.
    await waitFor(() => existsSync(readyFile), 'the held child turn to open')
  }, 120_000)

  afterAll(async () => {
    const failures: unknown[] = []
    await scaffold?.close().catch((error: unknown) => failures.push(error))
    await rm(sidecarRoot, { recursive: true, force: true }).catch((error: unknown) => failures.push(error))
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'subagent interrupt teardown failed')
  })

  it('parks a queued follow-up on interrupt and resumes it FIFO on a waking send', async () => {
    // Queue the follow-up while the turn is still open, then interrupt.
    const queued = await rpc<{ messageId: string }>(scaffold.baseUrl, 'subagent.prompt', {
      parentSessionId: parentId,
      childSessionId: childId,
      mode: 'continuable',
      content: [{ type: 'text', text: FOLLOWUP }],
    })
    expect(queued).toMatchObject({ ok: true })

    const settled = scaffold.whenTurnSettled()
    const interrupted = await rpc<{ accepted: true }>(scaffold.baseUrl, 'subagent.interrupt', {
      parentSessionId: parentId,
      childSessionId: childId,
      mode: 'continuable',
    })
    expect(interrupted).toMatchObject({ ok: true, value: { accepted: true } })
    // accepted acknowledges the admitted cancel, not quiescence: wait for the
    // aborted turn/end (the composition's first turn/end) before asserting.
    expect(await settled).toBe(childId)

    // Parked, not resumed: the Activation stays resident with an idle driver,
    // the follow-up is retained, and no second turn opened.
    const child = scaffold.ctx.agents.get(childId)
    expect(child).toBeDefined()
    expect(child!.status).toBe('idle')
    expect(child!.inbox.nextTurn).toHaveLength(1)
    expect(child!.session.events.filter(event => event.type === 'turn/start')).toHaveLength(1)
    const lastEnd = child!.session.events.filter(event => event.type === 'turn/end').at(-1)
    expect((lastEnd)?.data.reason.kind).toBe('aborted')

    // Only an explicit waking send resumes the parked queue, FIFO, then the
    // child runs both turns to completion and settles.
    const waking = await rpc<{ messageId: string }>(scaffold.baseUrl, 'subagent.prompt', {
      parentSessionId: parentId,
      childSessionId: childId,
      mode: 'continuable',
      content: [{ type: 'text', text: WAKING }],
    })
    expect(waking).toMatchObject({ ok: true })
    await expect.poll(() => scaffold.ctx.agents.get(childId), { timeout: 60_000 }).toBeUndefined()

    const loaded = await scaffold.ctx.sessionPersistence.load(childId)
    // Human-origin messages only: the real composition also injects
    // runtime-context snapshots as non-user-source messages.
    const userTexts = loaded.events.flatMap(event => event.type === 'user/message'
      && event.data.source.kind === 'user'
      ? event.data.content.flatMap(block => block.type === 'text' ? [block.text] : [])
      : [])
    expect(userTexts).toEqual([INITIAL, FOLLOWUP, WAKING])
    const turnEndKinds = loaded.events
      .filter(event => event.type === 'turn/end')
      .map(event => (event).data.reason.kind)
    expect(turnEndKinds).toEqual(['aborted', 'completed', 'completed'])
  }, 120_000)
})
