/**
 * 文件职责：验证真实模型仅使用 bash 修复临时目录中的 JavaScript 缺陷，并由外部测试确认结果。
 * 技术维度：使用 Vitest、Headless 编码 Harness、真实 DeepSeek 模型、Node 子进程和临时文件系统。
 * 产品维度：证明无界面智能体能完成典型“复现失败—修改代码—运行验证”的编码任务。
 * 逻辑维度：写入有缺陷模块与测试，先确认失败，启动智能体执行修复，再由宿主重跑测试并检查文件。
 * 关键边界：无 API 密钥时自跳过；不得修改测试文件；成功依据外部 node 进程而非智能体自述。
 * 新手阅读建议：先对比 TEST_FILE 与 BUGGY_ADD，再看任务提示，最后查看修复前后两次外部执行。
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { codingHarness, finalText, SYSTEM_PROMPT, waitForIdle } from './harness.ts'
import { SessionId } from '@deepseek-ai/dsh-session'

/**
 * The swebench-style smoke test: a real model fixes a real bug in a temp
 * directory using only the bash tool, and the fix is verified OUTSIDE the
 * agent by re-running the test script. Key-gated.
 */
/* 中文说明：真实模型在临时目录修复真实错误，最终由智能体之外重新运行测试脚本验证。 */

/* 用于验证 add 函数正确性的不可修改测试文件内容。 */
const TEST_FILE = [
  "const assert = require('node:assert');",
  "const { add } = require('./add.js');",
  'assert.strictEqual(add(2, 3), 5);',
  'assert.strictEqual(add(-1, 1), 0);',
  "console.log('PASS');",
  '',
].join('\n')

/** 初始带有减法错误的 add.js 内容。 */
const BUGGY_ADD = [
  '// A tiny module with an obvious bug.',
  'function add(a, b) {',
  '  return a - b;',
  '}',
  'module.exports = { add };',
  '',
].join('\n')

/** 当前编码任务的临时工作目录。 */
let workdir: string | undefined
/** 当前测试拥有的编码 Harness 上下文。 */
let ctx: Context | undefined

afterEach(async () => {
  // Dispose the harness even on failure/retry: agent-loop teardown stops the
  // loop and LocalBashExecutor teardown kills anything the model left running.
  await ctx?.fiber.dispose()
  ctx = undefined
  if (workdir !== undefined) await rm(workdir, { recursive: true, force: true })
  workdir = undefined
})

describe.skipIf(!process.env.DEEPSEEK_API_KEY)('coding task: fix a failing test via bash', () => {
  it('repairs add.js so node add.test.js passes', async () => {
    workdir = await mkdtemp(join(tmpdir(), 'dsh-coding-task-'))
    await writeFile(join(workdir, 'add.js'), BUGGY_ADD)
    await writeFile(join(workdir, 'add.test.js'), TEST_FILE)

    // Confirm the fixture actually fails before the agent touches it.
    const before = spawnSync('node', ['add.test.js'], { cwd: workdir })
    expect(before.status).not.toBe(0)

    ctx = await codingHarness(workdir, { persona: SYSTEM_PROMPT })
    const agent = await ctx.agentLoop.create(SessionId('e2e-task'), { provider: 'deepseek-official', model: 'deepseek-v4-flash' })

    agent.followup(createUserMessage({
      content: [{
        type: 'text',
        text: 'In the current directory, `node add.test.js` fails because add.js has a bug. '
        + 'Fix add.js so the test passes, run `node add.test.js` to verify, and report the result. '
        + 'Do not modify add.test.js.',
      }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    // The agent claims success…
    const summary = finalText(agent.session.snapshotEvents()).toLowerCase()
    expect(summary.length).toBeGreaterThan(0)

    // …and the world agrees: the test passes when WE run it, and the test
    // file is byte-identical (an agent that neutered the test instead of
    // fixing the bug fails here, not just on a keyword probe).
    const untouchedTest = await readFile(join(workdir, 'add.test.js'), 'utf8')
    expect(untouchedTest).toBe(TEST_FILE)

    const after = spawnSync('node', ['add.test.js'], { cwd: workdir, encoding: 'utf8' })
    expect(after.stdout).toContain('PASS')
    expect(after.status).toBe(0)

    const fixed = await readFile(join(workdir, 'add.js'), 'utf8')
    expect(fixed).not.toMatch(/a\s*-\s*b/)
  }, 180_000)
})
