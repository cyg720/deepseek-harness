/**
 * 文件职责：验证交互与审批的 tool-ask-user.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis 服务、会话事件、持久状态、Node 宿主接口和 Vitest。
 * 产品维度：保证交互与审批在授权、等待、失败和清理场景中可靠。
 * 逻辑维度：构造服务和状态，驱动操作并断言事件与结果。
 * 关键边界：匿名标识不是认证；模型可见审批、提问和任务信息必须写入会话日志。
 * 新手阅读建议：先读类型与事件，再按注册、请求、状态变化和清理流程阅读。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import UserQuestionService, {
  type AskUserQuestionAnswer,
  type AskUserQuestionRequest,
} from '@deepseek-ai/dsh-user-questions'
import * as toolAskUser from '@deepseek-ai/dsh-tool-ask-user'

/** 中文说明：测试局部值 testToolSignal，由紧邻初始化决定。 */
const testToolSignal = new AbortController().signal

interface QuestionAnswerer {
  ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer>
}

function registerQuestionAnswerer(ctx: Context, answerer: QuestionAnswerer): () => void {
  return ctx.on('user-questions/request', request => answerer.ask(request))
}

interface OptionSchemaShape {
  properties: {
    questions: {
      items: {
        properties: {
          options: {
            items: {
              properties: Record<string, { type: string }>
            }
          }
        } & Record<string, unknown>
      }
    }
  }
}

/** 中文说明：函数 setup 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function setup() {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(toolAskUser)
  return ctx
}

/** 中文说明：函数 stubAgent 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function stubAgent(id: string, delegationDepth = 0): Agent {
  /** 中文说明：测试局部值 agentId，由紧邻初始化决定。 */
  const agentId = id as Agent['id']
  return {
    id: agentId,
    session: { id: agentId, header: { delegationDepth } },
  } as unknown as Agent
}

describe('ask_user_question tool', () => {
  it('registers a model-facing tool schema', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 schema，由紧邻初始化决定。 */
    const schema = ctx.tools.schemas().find(tool => tool.name === 'ask_user_question')

    expect(schema).toMatchObject({
      name: 'ask_user_question',
      parameters: {
        type: 'object',
        properties: {
          questions: { type: 'array' },
        },
        required: ['questions'],
      },
    })
    /** 中文说明：测试局部值 parameters，由紧邻初始化决定。 */
    const parameters = schema?.parameters as unknown as OptionSchemaShape
    expect(parameters.properties.questions.items.properties).toMatchObject({
      id: { type: 'string' },
      question: { type: 'string' },
      header: { type: 'string' },
      options: { type: 'array' },
      multi_select: { type: 'boolean' },
    })
    expect(parameters.properties.questions.items.properties.options.items.properties).toMatchObject({
      label: { type: 'string' },
      description: { type: 'string' },
    })
    expect(parameters.properties.questions.items.properties.options.items.properties).not.toHaveProperty('value')
    expect(parameters.properties.questions.items.properties.options.items.properties).not.toHaveProperty('recommended')
    expect(parameters.properties.questions.items.properties.options.items.properties).not.toHaveProperty('preview')
  })

  it('asks the registered user-questions provider and projects structured answers to text', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 seen，由紧邻初始化决定。 */
    const seen: AskUserQuestionRequest[] = []
    registerQuestionAnswerer(ctx, {
      async ask(request) {
        seen.push(request)
        return { answers: [{ id: 'pkg', selected: ['pnpm'] }] }
      },
    })

    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: ToolCallId('ask-1'),
      name: 'ask_user_question',
      arguments: {
        questions: [{
          id: 'pkg',
          question: 'Which package manager should I use?',
          options: [{ label: 'pnpm', description: 'Use pnpm workspaces.' }],
        }],
      },
    })

    expect(result).toMatchObject({
      isError: false,
      content: [{ type: 'text', text: '{"answers":[{"id":"pkg","selected":["pnpm"]}]}' }],
    })
    expect(seen).toMatchObject([{
      questions: [{
        id: 'pkg',
        question: 'Which package manager should I use?',
        options: [{ label: 'pnpm', description: 'Use pnpm workspaces.' }],
      }],
    }])
  })

  it('passes recommended option labels through without adding schema fields', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 seen，由紧邻初始化决定。 */
    const seen: AskUserQuestionRequest[] = []
    registerQuestionAnswerer(ctx, {
      async ask(request) {
        seen.push(request)
        return { answers: [{ id: 'pkg', selected: ['pnpm (Recommended)'] }] }
      },
    })

    await ctx.tools.execute({
      signal: testToolSignal,
      callId: ToolCallId('ask-recommended'),
      name: 'ask_user_question',
      arguments: {
        questions: [{
          id: 'pkg',
          question: 'Which package manager should I use?',
          options: [
            { label: 'pnpm (Recommended)' },
            { label: 'npm' },
          ],
        }],
      },
    })

    expect(seen[0]?.questions[0]?.options).toEqual([
      { label: 'pnpm (Recommended)' },
      { label: 'npm' },
    ])
  })

  it('projects custom answers and multi-select choices', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    registerQuestionAnswerer(ctx, {
      async ask() {
        return {
          answers: [
            { id: 'targets', selected: ['tests', 'docs'], custom: 'release notes' },
            { id: 'labels-only', selected: ['tests'] },
            { id: 'notes', selected: [], custom: 'ship today' },
          ],
        }
      },
    })

    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: ToolCallId('ask-multi'),
      name: 'ask_user_question',
      arguments: {
        questions: [
          {
            id: 'targets',
            question: 'What should I update?',
            options: [{ label: 'tests' }, { label: 'docs' }],
            multi_select: true,
          },
          {
            id: 'labels-only',
            question: 'Which labels should I keep?',
            options: [{ label: 'tests' }, { label: 'docs' }],
            multi_select: true,
          },
          { id: 'notes', question: 'Any note?' },
        ],
      },
    })

    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected ask_user_question success')
    expect(result.value).toEqual({
      answers: [
        { id: 'targets', selected: ['tests', 'docs'], custom: 'release notes' },
        { id: 'labels-only', selected: ['tests'] },
        { id: 'notes', selected: [], custom: 'ship today' },
      ],
    })
    expect(result.content).toEqual([{
      type: 'text',
      text: '{"answers":[{"id":"targets","selected":["tests","docs"],"custom":"release notes"},{"id":"labels-only","selected":["tests"]},{"id":"notes","selected":[],"custom":"ship today"}]}',
    }])
  })

  it('passes the tool abort signal to the user-questions request', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 seen，由紧邻初始化决定。 */
    const seen: AskUserQuestionRequest[] = []
    registerQuestionAnswerer(ctx, {
      async ask(request) {
        seen.push(request)
        return { answers: [{ id: 'continue', selected: ['ok'] }] }
      },
    })
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new AbortController()

    await ctx.tools.execute({
      callId: ToolCallId('ask-2'),
      name: 'ask_user_question',
      arguments: { questions: [{ id: 'continue', question: 'Continue?' }] },
      signal: controller.signal,
    })

    expect(seen[0]?.signal).toBe(controller.signal)
  })

  it('passes optional header and a resumed runtime root through to the user-questions request', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 seen，由紧邻初始化决定。 */
    const seen: AskUserQuestionRequest[] = []
    registerQuestionAnswerer(ctx, {
      async ask(request) {
        seen.push(request)
        return { answers: [{ id: 'continue', selected: ['ok'] }] }
      },
    })
    /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
    const agent = stubAgent('resumed-root', 1)
    ctx.agents.enter(agent, undefined)

    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: ToolCallId('ask-3'),
      name: 'ask_user_question',
      arguments: { questions: [{ id: 'continue', header: 'Confirm', question: 'Continue?' }] },
      agent,
    })

    expect(result.content).toEqual([{ type: 'text', text: '{"answers":[{"id":"continue","selected":["ok"]}]}' }])
    expect(seen[0]).toMatchObject({ questions: [{ id: 'continue', header: 'Confirm', question: 'Continue?' }], agent })
  })

  it('returns structured user-questions errors through tool execution', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()

    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: ToolCallId('ask-no-provider'),
      name: 'ask_user_question',
      arguments: { questions: [{ id: 'continue', question: 'Continue?' }] },
    })

    expect(result).toMatchObject({
      isError: true,
      error: { info: { name: 'UserQuestionError', code: 'NO_PROVIDER' } },
    })
  })

  it('rejects a live runtime-owned agent with a structured DELEGATED_CALLER error', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 seen，由紧邻初始化决定。 */
    const seen: AskUserQuestionRequest[] = []
    registerQuestionAnswerer(ctx, {
      async ask(request) {
        seen.push(request)
        return { answers: [{ id: 'continue', selected: ['ok'] }] }
      },
    })
    /** 中文说明：测试局部值 root，由紧邻初始化决定。 */
    const root = stubAgent('root', 0)
    /** 中文说明：测试局部值 child，由紧邻初始化决定。 */
    const child = stubAgent('child', 0)
    ctx.agents.enter(root, undefined)
    ctx.agents.enter(child, root)

    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: ToolCallId('ask-delegated'),
      name: 'ask_user_question',
      arguments: { questions: [{ id: 'continue', question: 'Continue?' }] },
      agent: child,
    })

    expect(result).toMatchObject({
      isError: true,
      error: { info: { name: 'UserQuestionError', code: 'DELEGATED_CALLER' } },
      content: [{
        type: 'text',
        text: "Error: human interaction is unavailable while the calling agent is owned by another live agent; include the unresolved question or decision in the child agent's final result",
      }],
    })
    expect(seen).toHaveLength(0)
  })

  it('returns a structured error for empty question batches', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()

    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: ToolCallId('ask-empty'),
      name: 'ask_user_question',
      arguments: { questions: [] },
    })

    expect(result).toMatchObject({
      isError: true,
      error: { info: { name: 'UserQuestionError', code: 'EMPTY_QUESTIONS' } },
    })
  })

  it('unregisters the tool when its plugin fiber is disposed', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(UserQuestionService)
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = await ctx.plugin(toolAskUser)
    expect(ctx.tools.get('ask_user_question')).toBeDefined()

    await fiber.dispose()

    expect(ctx.tools.get('ask_user_question')).toBeUndefined()
  })
})
