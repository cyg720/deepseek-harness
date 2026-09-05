/**
 * 文件职责：验证反馈记录的 loader-composition.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis Context、插件生命周期、React 和 Vitest。
 * 产品维度：保证反馈记录在配置、运行、失败和清理场景中可理解且可靠。
 * 逻辑维度：构造插件或沙箱，驱动操作并断言日志与清理。
 * 关键边界：沙箱与宿主 Context 不可混用；反馈追加新记录，不改写既有会话历史。
 * 新手阅读建议：先读类型和夹具，再按注册、执行、错误与卸载流程阅读。
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import * as CommandFeedback from '@deepseek-ai/dsh-command-feedback'
import { getOrCreateAnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'

/** 中文说明：测试局部值 root: string | undefined，由紧邻初始化决定。 */
let root: string | undefined
/** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  vi.unstubAllEnvs()
})

/** Register one idle agent over a store-owned session, as an app's spine does. */
/* 中文说明：函数 agent 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function agent(ctx: Context): Agent {
  /** 中文说明：测试局部值 scope，由紧邻初始化决定。 */
  const scope = ctx.plugin(() => {})
  /** 中文说明：测试局部值 id，由紧邻初始化决定。 */
  const id = SessionId('feedback-loader-agent')
  /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
  const session = ctx.sessions.create(id)
  /** 中文说明：测试局部值 inbox，由紧邻初始化决定。 */
  const inbox = new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} })
  /** 中文说明：测试局部值 status，由紧邻初始化决定。 */
  let status: AgentStatus = 'idle'
  /** 中文说明：测试局部值 value，由紧邻初始化决定。 */
  const value: Agent = {
    id,
    options: {},
    session,
    inbox,
    ctx: scope.ctx,
    get status() { return status },
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => {},
    cancel() { status = 'idle' },
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  ctx.agents.register(value)
  return value
}

describe('/feedback real Loader composition through cordis.yml', () => {
  it('boots cordis.yml and records feedback without model-visible output', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-command-feedback-loader-'))
    vi.stubEnv('DSH_HOME', root)
    /** 中文说明：测试局部值 configPath，由紧邻初始化决定。 */
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-agent'",
      "- name: '@deepseek-ai/dsh-session'",
      "- name: '@deepseek-ai/dsh-commands'",
      "- name: '@deepseek-ai/dsh-command-feedback'",
      '',
    ].join('\n'))

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    /** 中文说明：测试局部值 modules，由紧邻初始化决定。 */
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-agent', AgentRegistry],
      ['@deepseek-ai/dsh-session', SessionStore],
      ['@deepseek-ai/dsh-commands', CommandRuntime],
      ['@deepseek-ai/dsh-command-feedback', CommandFeedback],
    ])
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await context.loader.await()

    /** 中文说明：测试局部值 owner，由紧邻初始化决定。 */
    const owner = agent(context)
    /** 中文说明：测试局部值 signal，由紧邻初始化决定。 */
    const signal = new AbortController().signal

    // Discoverable through the composed registry, as a UI adapter finds it.
    expect(context.commands.list(owner).map(command => command.name)).toContain('feedback')

    /** 中文说明：测试局部值 accepted，由紧邻初始化决定。 */
    const accepted = await context.commands.execute(owner, '/feedback the diff view is unreadable', [], signal)
    /** 中文说明：测试局部值 userId，由紧邻初始化决定。 */
    const userId = getOrCreateAnonymousUserId({ env: { DSH_HOME: root } })
    expect(accepted?.result).toEqual({
      kind: 'success',
      text: `Feedback recorded for session feedback-loader-agent\nAnonymous user: ${userId}. Session sharing is not configured.`,
    })
    /** 中文说明：测试局部值 rejected，由紧邻初始化决定。 */
    const rejected = await context.commands.execute(owner, '/feedback', [], signal)
    expect(rejected?.result).toEqual({
      kind: 'error',
      text: 'Feedback text is required. Usage: /feedback <text>',
    })

    // The domain event owns the payload; generic command bookkeeping omits it.
    expect(owner.session.snapshotEvents().map(event => event.type))
      .toEqual(['command/run', 'feedback/record', 'command/done', 'command/run', 'command/done'])
    const run = owner.session.snapshotEvents().find(event => event.type === 'command/run')
    expect(run?.type === 'command/run' && Object.hasOwn(run.data, 'args')).toBe(false)
    const feedback = owner.session.snapshotEvents().find(event => event.type === 'feedback/record')
    expect(feedback?.type === 'feedback/record' && feedback.data.text).toBe('the diff view is unreadable')
    expect(JSON.stringify(owner.session.snapshotEvents()).match(/the diff view is unreadable/gu)).toHaveLength(1)

    // Nothing reached the model.
    expect(owner.session.deriveMessages()).toEqual([])
    expect(owner.session.surface.nodes).toEqual([])
  })
})
