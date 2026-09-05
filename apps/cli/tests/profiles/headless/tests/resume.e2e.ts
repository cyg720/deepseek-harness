/**
 * 文件职责：验证 Headless 会话在释放整个进程上下文后可从 JSONL 恢复并继续记住旧事实。
 * 技术维度：使用 Vitest、真实模型、JSONL 持久化、Cordis Context 生命周期和固定 SessionId。
 * 产品维度：保障用户跨进程继续长期编码会话时，模型能看到此前对话而无需重新说明背景。
 * 逻辑维度：第一套 Harness 告知秘密并落盘后释放，第二套 Harness 复用存储根恢复会话并询问秘密。
 * 关键边界：需要真实 API 密钥；两次运行必须使用同一持久根与会话标识；第一上下文必须先完全释放。
 * 新手阅读建议：先看 SECRET 与 SESSION_ID，再对比 Run 1 和 Run 2，最后检查恢复日志和模型回答。
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { codingHarness, finalText, SYSTEM_PROMPT, waitForIdle } from './harness.ts'

/**
 * Proves durable conversation continuity end-to-end: run 1 tells the REAL model
 * a fact and persists the turn to JSONL; run 2 is a fresh harness (new Context,
 * same `.sessions` root) that RESUMES the persisted session id and asks the
 * model to recall the fact. The recall can only come from the rehydrated event
 * log — a fresh session would have no idea. Key-gated like the other e2es.
 */
/* 中文说明：第一进程写入事实，第二个全新 Context 从同一日志恢复；正确回忆只能来自重放历史。 */

/* 跨进程恢复后模型必须回忆出的唯一秘密。 */
const SECRET = 'plum-galaxy-1791'
/** 两次独立 Harness 共享的稳定会话标识。 */
const SESSION_ID = SessionId('resume-e2e-session')

/** 当前测试拥有的 Harness 上下文。 */
let ctx: Context | undefined
/** 当前测试的临时持久化根目录。 */
let root: string | undefined

afterEach(async () => {
  // Dispose even on failure/retry: agent-loop teardown stops the loop and the
  // JSONL backend flushes; then drop the on-disk session log.
  await ctx?.fiber.dispose()
  ctx = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe.skipIf(!process.env.DEEPSEEK_API_KEY)('resume: continue a persisted session across processes', () => {
  it('recalls a fact stored in a prior, separately-disposed session', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-resume-e2e-'))

    // Run 1: a fresh agent on a KNOWN session id learns a secret, then we
    // dispose the whole context (simulating process exit) so only the JSONL
    // log on disk survives.
    ctx = await codingHarness(process.cwd(), { persona: SYSTEM_PROMPT, persistenceRoot: root })
    const first = (await ctx.agents.create({
      sessionId: SESSION_ID,
      agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    })).agent
    first.followup(createUserMessage({ content: [{ type: 'text', text: `Remember this code for later: ${SECRET}. Just acknowledge it.` }], source: { kind: 'user' } }))
    await waitForIdle(ctx, first)
    await ctx.fiber.dispose()
    ctx = undefined

    // Run 2: a brand-new context over the SAME root resumes the persisted
    // session. The loaded event log seeds the live session, so the model sees
    // run 1's exchange as conversation history.
    ctx = await codingHarness(process.cwd(), { persona: SYSTEM_PROMPT, persistenceRoot: root })
    const resumed = (await ctx.agents.resume({
      resumeSessionId: SESSION_ID,
      agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    })).agent
    expect(resumed.session.id).toBe(SESSION_ID)
    // The prior user turn is in the rehydrated log before the model is asked.
    expect(JSON.stringify(resumed.session.deriveMessages())).toContain(SECRET)

    resumed.followup(createUserMessage({ content: [{ type: 'text', text: 'What was the code I asked you to remember? Reply with just the code.' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, resumed)

    // The model recalls it — only possible from the resumed history.
    expect(finalText(resumed.session.snapshotEvents())).toContain(SECRET)
  }, 180_000)
})
