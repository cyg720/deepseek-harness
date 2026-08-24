/**
 * 文件职责：验证 minimal 智能体预设发送精确提示与工具定义，并挂载持久 shell 和编辑器能力。
 * 技术维度：使用 Vitest、真实 Web 脚手架、模型回放、预设服务和工具执行接口。
 * 产品维度：保障精简预设只携带必要上下文，同时仍支持连续 shell 状态和文件编辑任务。
 * 逻辑维度：启动回放环境，注入不应生效的系统提示，创建预设智能体，执行回合与工具并比较 fixture。
 * 关键边界：系统提示注入不得到达 minimal 模型请求；清理必须释放智能体、提示注册和脚手架。
 * 新手阅读建议：先看 beforeAll 如何挂载 minimal，再读请求头断言，最后跟踪 bash 与 editor 的状态传递。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { CallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { assertFixtureInventory, launchWebScaffold, type WebScaffold } from './scaffold.ts'

/** minimal 预设回放记录所在目录。 */
const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/minimal-preset', import.meta.url))
/** 固定模型请求与响应的会话 fixture。 */
const FIXTURE = join(SNAPSHOT_DIR, 'session.jsonl')
/** 要求模型精确回复的固定测试提示。 */
const PROMPT = 'Reply exactly MINIMAL_PRESET_REQUEST_OK and stop.'

describe('minimal agent preset', () => {
  /** 提供回放模型、工具和预设注册的 Web 脚手架。 */
  let scaffold: WebScaffold
  /** 按 minimal 预设创建的智能体句柄。 */
  let agentHandle: AgentHandle
  /** 移除故意注入系统提示的注销函数。 */
  let disposeInjectedPrompt: () => void

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ replayFixture: FIXTURE })
    disposeInjectedPrompt = scaffold.ctx.systemPrompt.section({
      name: 'test:injected-prompt',
      order: 999,
      text: 'THIS TEXT MUST NOT REACH THE MODEL.',
    })
    agentHandle = await scaffold.ctx.agents.create({
      sessionId: SessionId('minimal-preset-smoke'),
      meta: { cwd: scaffold.workspaceCwd, agentPreset: 'minimal' },
      agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      setup: agentCtx => scaffold.ctx.agentPresets.mount(agentCtx, 'minimal').then(() => undefined),
    })
  })

  afterAll(async () => {
    /** 汇总全部清理错误，确保每项资源都尝试释放。 */
    const failures: unknown[] = []
    await agentHandle?.dispose().catch((error: unknown) => failures.push(error))
    try {
      disposeInjectedPrompt?.()
    } catch (error: unknown) {
      failures.push(error)
    }
    await scaffold?.close().catch((error: unknown) => failures.push(error))
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'minimal preset smoke teardown failed')
  })

  it('sends the exact RL prompt and schemas, then executes the persistent shell and editor', async () => {
    agentHandle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: PROMPT }],
      source: { kind: 'user' },
    }))
    await agentHandle.agent.whenIdle()

    /** 本轮真实发送给回放模型的请求头。 */
    const requestHeader = agentHandle.agent.session.requestHeader()
    if (requestHeader === undefined) throw new Error('the minimal agent issued no model request')
    expect(agentHandle.agent.session.events.some(event => event.type === 'user/message'
      && event.data.source.kind === 'plugin'
      && event.data.source.plugin === '@deepseek-ai/dsh-system-prompt')).toBe(false)
    /** minimal 预设为该智能体挂载的文件系统服务。 */
    const presetFileSystem = scaffold.ctx.agentPresets.serviceFor(agentHandle.agent, 'fs')
    expect(presetFileSystem).toBeDefined()
    expect(presetFileSystem?.sandboxMode).toBeUndefined()
    expect(scaffold.ctx.agentPresets.serviceFor(agentHandle.agent, 'compaction')).toBeUndefined()

    /** 用于验证持久 shell 当前目录与环境变量的临时子目录。 */
    const stateDir = join(scaffold.workspaceCwd, 'persistent-state')
    await mkdir(stateDir)
    /** 工具调用共享的未取消信号。 */
    const signal = new AbortController().signal
    await scaffold.ctx.tools.execute({
      signal,
      callId: CallId('minimal-bash-state-setup'),
      name: 'bash',
      arguments: { command: `cd ${JSON.stringify(stateDir)} && export DSH_MINIMAL_STATE=PERSISTED` },
      agent: agentHandle.agent,
    })
    /** 从第二次 bash 调用读取的持久环境变量和工作目录结果。 */
    const bash = await scaffold.ctx.tools.execute({
      signal,
      callId: CallId('minimal-bash-state-read'),
      name: 'bash',
      arguments: { command: 'printf \'%s:%s\n\' "$DSH_MINIMAL_STATE" "$PWD"' },
      agent: agentHandle.agent,
    })
    /** editor 工具将要修改的测试文件路径。 */
    const seedPath = join(scaffold.workspaceCwd, 'preset-smoke.txt')
    await writeFile(seedPath, 'MINIMAL_EDITOR_OK\n')
    /** editor 工具执行替换后的结构化结果。 */
    const editor = await scaffold.ctx.tools.execute({
      signal,
      callId: CallId('minimal-editor-smoke'),
      name: 'str_replace_editor',
      arguments: { command: 'view', path: seedPath },
      agent: agentHandle.agent,
    })

    /** 从工具结果提取纯文本内容；result 是 bash 同类结果。示例：text(bash)。 */
    const text = (result: typeof bash): string => result.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
      .replaceAll(scaffold.workspaceCwd, '{{cwd}}')
      .trimEnd()

    expect({
      prompt: requestHeader.system,
      tools: requestHeader.tools?.map(tool => tool.name),
      bash: text(bash),
      editor: text(editor),
    }).toMatchInlineSnapshot(`
      {
        "bash": "PERSISTED:{{cwd}}/persistent-state",
        "editor": "Here's the content of {{cwd}}/preset-smoke.txt with line numbers (which has a total of 2 lines):
           1  MINIMAL_EDITOR_OK
           2",
        "prompt": "You are a helpful software engineer assistant.",
        "tools": [
          "bash",
          "str_replace_editor",
        ],
      }
    `)
    expect(requestHeader.tools?.toSorted((left, right) => left.name.localeCompare(right.name)))
      .toEqual(scaffold.ctx.tools.schemas(agentHandle.agent).toSorted((left, right) => left.name.localeCompare(right.name)))
    await assertFixtureInventory(SNAPSHOT_DIR, ['session.jsonl'])
  })
})
