import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { codingHarness, finalText, SYSTEM_PROMPT, waitForIdle } from './harness.ts'
import { SessionId } from '@deepseek-ai/dsh-session'

/**
 * The first place a REAL model meets the REAL bash tool: the cheap canary
 * before the coding-task e2e. Key-gated (see vitest.e2e.config.ts).
 */
/*
 * 中文说明：
 * - 文件职责：用真实 DeepSeek 模型和真实 Bash 工具验证完整 AgentLoop 的最小端到端路径。
 * - 技术维度：使用 Vitest 密钥门控、临时目录、真实插件栈、会话事件和异步资源释放。
 * - 产品维度：在更昂贵的编码任务前快速证明模型能调用终端并把真实输出报告给用户。
 * - 逻辑维度：创建临时 Harness，发送 echo 请求，等待代理空闲，再从工具调用、结果和最终文本三层验证。
 * - 关键边界：需要 DEEPSEEK_API_KEY，最长 120 秒；失败或超时后仍必须释放进程和目录。
 * - 新手阅读建议：先看 skipIf 运行条件，再沿 followup、waitForIdle 和三组事件断言阅读。
 */

/* 当前用例持有的真实 Harness 上下文。 */
let ctx: Context | undefined
/** 当前用例的临时 Bash 工作目录。 */
let workdir: string | undefined

/** 中文：每例后释放 AgentLoop/进程资源并删除临时目录。 */
afterEach(async () => {
  // Always dispose the harness, even on failure/retry/timeout: agent-loop
  // teardown stops the loop and LocalBashExecutor teardown kills any
  // process the model left behind.
  // 中文：即使失败、重试或超时，也释放 Harness；循环和 Bash 执行器会终止遗留进程。
  await ctx?.fiber.dispose()
  ctx = undefined
  if (workdir !== undefined) await rm(workdir, { recursive: true, force: true })
  workdir = undefined
})

/** 中文：存在 API 密钥时启用的真实模型加 Bash 测试组。 */
describe.skipIf(!process.env.DEEPSEEK_API_KEY)('full loop: real model + real bash tool', () => {
  /** 中文：要求模型执行 echo 并从调用、结果、答复三处验证输出；无参数和返回值。 */
  it('runs a bash command on request and reports its output', async () => {
    workdir = await mkdtemp(join(tmpdir(), 'dsh-full-loop-e2e-'))
    /** 装载在临时目录上的完整编码 Harness。 */
    ctx = await codingHarness(workdir, { persona: SYSTEM_PROMPT })
    const agent = await ctx.agentLoop.create(SessionId('e2e-loop'), { provider: 'deepseek-official', model: 'deepseek-v4-flash' })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Run `echo e2e-ok` with the bash tool and tell me its exact output.' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const events = agent.session.snapshotEvents()
    const calls = events.filter(event => event.type === 'tool/call')
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.some(event => event.data.name === 'bash')).toBe(true)

    /** 会话中的全部工具结果事件。 */
    const results = events.filter(event => event.type === 'tool/result')
    /** 从工具结果内容中扁平提取的所有文本块。 */
    const resultTexts = results.flatMap(event =>
      event.data.message.content[0].content.filter(block => block.type === 'text').map(block => block.text))
    expect(resultTexts.some(text => text.includes('e2e-ok'))).toBe(true)

    expect(finalText(events)).toContain('e2e-ok')
  }, 120_000)
})
