/**
 * 文件职责：验证 subagent-acp.e2e.ts 覆盖的子代理进程与协议行为与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、文件存储或受控子进程协议。
 * 产品维度：保障 Agent 的子代理进程与协议能力稳定、安全且可诊断。
 * 逻辑维度：准备或解析输入，执行核心流程，再处理结果、错误与资源清理。
 * 关键边界：外部进程和持久化数据不可信；敏感环境需净化；清理必须等待资源完全停止。
 * 新手阅读建议：先看导出类型和夹具，再读主流程，最后关注协议错误、恢复和清理。
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { resolveExampleLaunch } from '@deepseek-ai/dsh-loader-smoke'
import * as acp from '../src/index.ts'

/**
 * With-key cross-process boundary proof: the backend spawns the real acp-agent example, speaks ACP over
 * stdio, and returns its real model answer. This is the out-of-process counterpart to in-process
 * spawn coverage and self-skips without `DEEPSEEK_API_KEY`.
 */

// The real acp-agent example: its bin + cordis.yml (the live DeepSeek config).
/** 中文说明：变量 binScript 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const binScript = fileURLToPath(new URL('../../../examples/acp-demo/src/bin.ts', import.meta.url))
/** 中文说明：变量 exampleConfig 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const exampleConfig = fileURLToPath(new URL('../../../../examples/acp-agent/cordis.yml', import.meta.url))
/** 中文说明：变量 repoTsconfig 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

// How to launch the child acp-agent (src via tsx / lib via plain node, per DSH_EXAMPLE_MODE).
// The subprocess seam scrubs ambient creds while spec.env merges after it, so the model key is
// forwarded explicitly; TSX_TSCONFIG_PATH is added by the resolver in src mode only.
/** 中文说明：变量 childLaunch 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const childLaunch = resolveExampleLaunch({
  srcBin: binScript,
  configArgs: ['--config', exampleConfig],
  tsconfigPath: repoTsconfig,
  env: {
    ...process.env.DEEPSEEK_API_KEY !== undefined ? { DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY } : {},
    ...process.env.DEEPSEEK_BASE_URL !== undefined ? { DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL } : {},
    DSH_PERMISSION_MODE: 'danger-full-access',
  },
})

/** The ACP backend ignores the parent, but the seam requires one. */
/** 中文说明：变量 fakeParent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const fakeParent = { id: 'parent', session: { header: {} } } as unknown as Agent

/** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let ctx: Context | undefined
/** 中文说明：变量 workdir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let workdir: string | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  if (workdir !== undefined) await rm(workdir, { recursive: true, force: true })
  workdir = undefined
})

describe.skipIf(!process.env.DEEPSEEK_API_KEY)('ACP backend with-key e2e (drive our own acp-agent)', () => {
  it('drives the real acp-agent example process to answer a prompt', async () => {
    workdir = await mkdtemp(join(tmpdir(), 'dsh-subagent-acp-e2e-'))
    ctx = new Context()
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(acp, {
      providerName: 'acp',
      command: childLaunch.command,
      args: childLaunch.args,
      cwd: workdir,
      permission: 'reject',
      env: childLaunch.env as Record<string, string>,
    })

    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = await ctx.subagents.start('acp', {
      prompt: [{ type: 'text', text: 'Reply with exactly the word PONG and nothing else. Do not use any tools.' }],
      parent: fakeParent,
      signal: new AbortController().signal,
    })
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await run.result
    await run.dispose()

    // The real child process completed its turn and streamed a real answer back
    // across the ACP boundary.
    expect(result.stopReason).toBe('completed')
    /** 中文说明：函数值 text 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const text = result.output.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('')
    expect(text.length).toBeGreaterThan(0)
    expect(text.toUpperCase()).toContain('PONG')
  }, 180_000)

  it('drives the child to do real file work via its own bash tool', async () => {
    workdir = await mkdtemp(join(tmpdir(), 'dsh-subagent-acp-e2e-'))
    ctx = new Context()
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(acp, {
      providerName: 'acp',
      command: childLaunch.command,
      args: childLaunch.args,
      cwd: workdir,
      // The child needs to act (run bash), so approve its permission prompts.
      permission: 'allow',
      env: childLaunch.env as Record<string, string>,
    })

    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = await ctx.subagents.start('acp', {
      prompt: [{ type: 'text', text:
        'Use the bash tool to write the text ACP_CHILD_WAS_HERE into a file named proof.txt '
        + 'in the current directory. Then reply DONE.' }],
      parent: fakeParent,
      signal: new AbortController().signal,
    })
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await run.result
    await run.dispose()

    expect(result.stopReason).toBe('completed')
    // Assert the filesystem effect independently of the model response.
    /** 中文说明：变量 proof 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const proof = await readFile(join(workdir, 'proof.txt'), 'utf8')
    expect(proof).toContain('ACP_CHILD_WAS_HERE')
  }, 180_000)
})
