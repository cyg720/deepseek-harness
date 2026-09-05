import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { spawnHarness, waitForIdle } from './harness.ts'
import { SessionId } from '@deepseek-ai/dsh-session'

/** Key-gated smoke for a real parent delegating filesystem work to a real child. */
/* 中文：需要真实 API 密钥的冒烟测试，覆盖父代理委派子代理执行文件系统任务。 */

/* 当前用例持有的 Harness 上下文；未启动或清理后为 undefined。 */
let ctx: Context | undefined
/** 当前用例的临时工作目录；清理后为 undefined。 */
let workdir: string | undefined

/** 中文：每个用例后释放插件纤程并递归删除临时目录。 */
afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  if (workdir !== undefined) await rm(workdir, { recursive: true, force: true })
  workdir = undefined
})

/** 中文：存在 API 密钥时才启用的真实子代理后端测试组。 */
describe.skipIf(!process.env.DEEPSEEK_API_KEY)('spawn backend with-key smoke', () => {
  /** 中文：让父代理委派子代理写 proof.txt，并从磁盘与父日志双重验证；无参数和返回值。 */
  it('a parent delegates to a child that writes a file on disk', async () => {
    workdir = await mkdtemp(join(tmpdir(), 'dsh-subagent-spawn-e2e-'))
    /** 装载在临时工作区上的真实 Harness 上下文。 */
    ctx = await spawnHarness(workdir)
    const parent = await ctx.agentLoop.create(SessionId('e2e-parent'), { provider: 'deepseek-official', model: 'deepseek-v4-flash' })

    parent.followup(createUserMessage({
      content: [{ type: 'text', text:
      'Use the subagent tool to delegate this exact task: "Use the bash tool to write the text '
      + 'SUBAGENT_WAS_HERE into a file named proof.txt in the current directory." '
      + 'After the subagent finishes, tell me it is done.' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, parent)

    // Assert the filesystem effect independently of the model response.
    // 中文：独立检查文件系统副作用，不依赖模型自然语言声称已经完成。
    /** 子代理应写入的证明文件内容。 */
    const proof = await readFile(join(workdir, 'proof.txt'), 'utf8')
    expect(proof).toContain('SUBAGENT_WAS_HERE')

    // The parent's log records the subagent tool/call + its result (not the
    // child's internal steps).
    const events = parent.session.snapshotEvents()
    const subagentCalls = events.filter(e => e.type === 'tool/call' && e.data.name === 'subagent')
    expect(subagentCalls.length).toBeGreaterThan(0)
  }, 180_000)
})
/**
 * 中文说明：
 * - 文件职责：用真实模型验证父代理可委派子代理执行文件写入，并在父会话记录工具调用。
 * - 技术维度：使用 Vitest 密钥门控、临时目录、真实 AgentLoop、子代理工具和文件系统断言。
 * - 产品维度：证明用户任务能由父代理分派给子代理并产生可核验的实际结果。
 * - 逻辑维度：创建临时工作区与完整 Harness，发送委派指令，等待空闲，再检查文件和父会话事件。
 * - 关键边界：仅在 DEEPSEEK_API_KEY 存在时运行，超时 180 秒；清理必须释放上下文并删除临时目录。
 * - 新手阅读建议：先看 describe.skipIf 的运行条件，再跟踪 followup、waitForIdle、磁盘和日志两类证据。
 */
