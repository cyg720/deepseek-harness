/**
 * 文件职责：验证ACP 示例的 acp-agent.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis、异步资源生命周期、远程文件/进程接口和 Vitest。
 * 产品维度：保证ACP 示例在真实组装、失败和清理场景中可靠。
 * 逻辑维度：构造服务或远程替身，驱动操作并断言结果。
 * 关键边界：凭据不得泄漏；远程句柄、终端和后台进程必须在取消或卸载时释放。
 * 新手阅读建议：先读接口和夹具，再按创建、操作、错误和清理流程阅读。
 */
import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import { TOOL_ORDER_REST } from '@deepseek-ai/dsh-system-prompt'
import type { Message } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as acpAgent from '../src/index.ts'

/**
 * In-process unit coverage for the @deepseek-ai/dsh-acp-demo composition:
 * mounting it brings up the agent-spine-demo spine + JSONL persistence + the ACP
 * bridge in one `ctx.plugin`. It loads no Loader-only plugin (no hmr), so it
 * mounts in a plain Context.
 *
 * The REAL Loader-path guard (export shape via `unwrapExports`, the headline
 * ACP operations end-to-end) is the keyless bin smoke in `load-path.e2e.ts`;
 * this spec asserts the composition and the persistenceRoot default branch.
 */
/** 中文说明：函数 mount 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function mount(config: acpAgent.Config, withBash = false): Promise<Context> {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  if (withBash) {
    ctx.provide('shell', {
      sandboxMode: undefined,
      resolve() { throw new Error('composition test does not execute bash') },
      run() { throw new Error('composition test does not execute bash') },
      start() { throw new Error('composition test does not execute bash') },
    })
  }
  config.persistenceRoot ??= await mkdtemp(join(tmpdir(), 'dsh-acp-demo-persistence-'))
  await ctx.plugin(acpAgent, config)
  return ctx
}

/** 中文说明：函数 isolatedSkillsConfig 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function isolatedSkillsConfig(catalogDescriptionMaxLength?: number): Promise<NonNullable<acpAgent.Config['skills']>> {
  /** 中文说明：测试局部值 home，由紧邻初始化决定。 */
  const home = await mkdtemp(join(tmpdir(), 'dsh-acp-demo-skills-'))
  return {
    filesystem: { dshHome: join(home, '.dsh'), agentsHome: join(home, '.agents') },
    ...catalogDescriptionMaxLength !== undefined ? { tool: { catalogDescriptionMaxLength } } : {},
  }
}

/** 中文说明：函数 composePrefix 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function composePrefix(ctx: Context): Promise<Message[]> {
  /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
  const agent = ctx.agentLoop.create(SessionId(`acp-demo-prefix-${randomUUID()}`), {}, { cwd: '/tmp' })
  /** 中文说明：测试局部值 signal，由紧邻初始化决定。 */
  const signal = new AbortController().signal
  /** 中文说明：测试局部值 decision，由紧邻初始化决定。 */
  const decision = await agentEvents(ctx, agent).waterfall(
    'agent/pre-step', { messages: [], turn: 1, step: 1, signal },
    () => Promise.resolve({ kind: 'enter', messages: [] }),
  )
  if (decision.kind === 'enter') {
    /** 中文说明：测试局部值 message，由紧邻初始化决定。 */
    for (const message of decision.messages) {
      agent.session.append('user/message', message, { surfaceOp: 'append' })
    }
  }
  return agent.session.deriveMessages()
}

/** 中文说明：函数 withIsolatedSkillHomes 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function withIsolatedSkillHomes<T>(run: () => Promise<T>): Promise<T> {
  /** 中文说明：测试局部值 oldDshHome，由紧邻初始化决定。 */
  const oldDshHome = process.env.DSH_HOME
  /** 中文说明：测试局部值 oldAgentsHome，由紧邻初始化决定。 */
  const oldAgentsHome = process.env.DSH_AGENTS_HOME
  /** 中文说明：测试局部值 home，由紧邻初始化决定。 */
  const home = await mkdtemp(join(tmpdir(), 'dsh-acp-demo-default-skills-'))
  process.env.DSH_HOME = join(home, '.dsh')
  process.env.DSH_AGENTS_HOME = join(home, '.agents')
  try {
    return await run()
  } finally {
    if (oldDshHome === undefined) {
      delete process.env.DSH_HOME
    } else {
      process.env.DSH_HOME = oldDshHome
    }
    if (oldAgentsHome === undefined) {
      delete process.env.DSH_AGENTS_HOME
    } else {
      process.env.DSH_AGENTS_HOME = oldAgentsHome
    }
  }
}

describe('dsh-acp-demo composition', () => {
  it('brings up the spine + persistence + the ACP bridge', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mount({
      provider: 'mock',
      model: 'mock',
      persona: 'hi',
      persistenceRoot: await mkdtemp(join(tmpdir(), 'dsh-acp-demo-test-')),
      persistenceCompression: 'none',
      skills: await isolatedSkillsConfig(),
      workspaceContext: false,
    })
    expect(ctx.get('agents')).toBeDefined()
    expect(ctx.get('sessions')).toBeDefined()
    expect(ctx.get('sessionPersistence')).toBeDefined()
    expect(ctx.get('sessionQuery')).toBeDefined()
    expect(ctx.get('sessionReferenceResolver')).toBeUndefined()
    expect((ctx.get('sessionPersistence') as unknown as { config: { compression?: string } }).config.compression).toBe('none')
    expect(ctx.get('agentLoop')).toBeDefined()
    expect(ctx.get('userQuestions')).toBeUndefined()
    expect(ctx.get('commands')).toBeUndefined()
    expect(ctx.get('tools')?.get('ask_user_question')).toBeUndefined()
    expect(ctx.get('goals')).toBeDefined()
    expect(ctx.get('tools')?.get('get_goal')).toBeDefined()
    // No pre-created agents — ACP session/new creates them on demand.
    expect(ctx.get('agents')!.list()).toHaveLength(0)
    await ctx.fiber.dispose()
  })

  it('can explicitly omit the persisted-goal stack', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mount({
      provider: 'mock',
      model: 'mock',
      goals: false,
      workspaceContext: false,
    })
    expect(ctx.get('goals')).toBeUndefined()
    expect(ctx.get('tools')?.get('get_goal')).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('defaults the persistence root when omitted', async () => {
    // Exercises the `DEFAULT_PERSISTENCE_ROOT` fallback for a direct-apply caller that
    // bypasses the schema's `.default(...)`: call `apply` directly (not via
    // `ctx.plugin`, which validates+defaults the config first) with no
    // persistenceRoot, so the runtime fallback is the one that fires.
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    // No persona: covers the omitted-persona forwarding branch too.
    await acpAgent.apply(ctx, {
      provider: 'mock',
      model: 'mock',
      skills: await isolatedSkillsConfig(),
      workspaceContext: false,
    })
    expect(ctx.get('sessionPersistence')).toBeDefined()
    await ctx.fiber.dispose()
  })

  it('forwards explicit project-instruction controls to the bundled spine', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mount({
      provider: 'mock',
      model: 'mock',
      persona: 'hi',
      persistenceRoot: await mkdtemp(join(tmpdir(), 'dsh-acp-demo-workspace-context-')),
      workspaceContext: false,
    })
    expect(ctx.get('agents')).toBeDefined()
    expect(ctx.get('agentLoop')).toBeDefined()
    await ctx.fiber.dispose()
  })

  it('uses default skill config when apply is called directly without skills', async () => {
    await withIsolatedSkillHomes(async () => {
      /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
      const ctx = new Context()
      await acpAgent.apply(ctx, { provider: 'mock', model: 'mock', workspaceContext: false })
      expect(ctx.skills).toBeDefined()
      expect(await ctx.skills.list()).toEqual([])
      await ctx.fiber.dispose()
    })
  })

  it('forwards skill config and dshHome into agent-spine-demo', async () => {
    /** 中文说明：测试局部值 skills，由紧邻初始化决定。 */
    const skills = await isolatedSkillsConfig(6)
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mount({ provider: 'mock', model: 'mock', persona: 'hi', dshHome: skills.filesystem!.dshHome!, skills, workspaceContext: false })
    ctx.skills.register({ name: 'acp-skill', description: 'ACP skill', source: 'runtime', content: 'body' })
    expect(JSON.stringify(await composePrefix(ctx))).toContain('- `acp-skill`: ACP...')
    await ctx.fiber.dispose()
  })

  it('forwards maxParallelToolCalls to the bundled agent loop', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mount({
      provider: 'mock',
      model: 'mock',
      maxParallelToolCalls: 3,
      persistenceRoot: await mkdtemp(join(tmpdir(), 'dsh-acp-demo-test-parallel-')),
      skills: await isolatedSkillsConfig(),
      workspaceContext: false,
    })
    expect(ctx.get('agentLoop')?.config.maxParallelToolCalls).toBe(3)
    await ctx.fiber.dispose()
  })

  it('forwards task admission config to the bundled task provider', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mount({
      provider: 'mock',
      model: 'mock',
      jobs: { maxConcurrentJobsPerOwner: 1 },
      skills: await isolatedSkillsConfig(),
      workspaceContext: false,
    })
    /** 中文说明：测试局部值 settle，由紧邻初始化决定。 */
    let settle!: (outcome: { status: 'killed' }) => void
    ctx.jobs.start({
      kind: 'bash',
      label: 'hold configured slot',
      run: () => ({
        cancel: () => { settle({ status: 'killed' }) },
        done: new Promise((resolve) => { settle = resolve }),
      }),
    })
    expect(() => ctx.jobs.start({
      kind: 'bash',
      label: 'blocked configured task',
      run: () => ({ cancel: () => {}, done: Promise.resolve({ status: 'completed' }) }),
    })).toThrow('(limit: 1)')
    await ctx.fiber.dispose()
  })

  it('forwards bundled tool config into agent-core', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mount({
      provider: 'mock',
      model: 'mock',
      workspaceContext: false,
      toolBash: { enableRunInBackground: false },
      toolJobs: { waitTimeoutMs: 7, maxWaitTimeoutMs: 11 },
      skills: await isolatedSkillsConfig(),
    }, true)
    /** 中文说明：测试局部值 bash，由紧邻初始化决定。 */
    const bash = ctx.tools.schemas().find(tool => tool.name === 'bash')
    expect(Object.keys((bash!.parameters as { properties: Record<string, unknown> }).properties))
      .not.toContain('run_in_background')
    await ctx.fiber.dispose()
  })

  it('exposes its plugin shape', () => {
    expect(acpAgent.name).toBe('acp-demo')
    expect(acpAgent.Config).toBeDefined()
  })

  it('forwards toolOrder through agent-spine-demo to the system-prompt assembly', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mount({
      provider: 'mock',
      model: 'mock',
      toolOrder: ['zulu', TOOL_ORDER_REST],
      persistenceRoot: await mkdtemp(join(tmpdir(), 'dsh-acp-demo-test-tool-order-')),
      workspaceContext: false,
    })
    // The bundle's own bash tools pend on the absent `ctx.shell` executor in
    // this providerless mount, so register two plain tools to order.
    /** 中文说明：测试局部值 name，由紧邻初始化决定。 */
    for (const name of ['alpha', 'zulu']) {
      ctx.get('tools')!.register({
        name,
        description: name,
        parameters: {},
        output: { schema: { type: 'null' }, render: () => [] },
        execute: async () => null,
      })
    }
    /** 中文说明：测试局部值 assembly，由紧邻初始化决定。 */
    const assembly = await ctx.get('systemPrompt')!.assemble()
    expect(assembly.tools.map(tool => tool.name)).toEqual([
      'zulu',
      'alpha',
      'create_goal',
      'get_goal',
      'job_kill',
      'job_list',
      'job_output',
      'skill',
      'update_goal',
    ])
    await ctx.fiber.dispose()
  })

  it('has the namespace-plugin export shape (no stray default) so the Loader keeps name/Config/apply', () => {
    // A default export would make `unwrapExports` collapse this inject-less namespace and silently
    // drop `name`/`Config` while the app still boots. Guard the postmortem-0001 shape directly.
    expect('default' in acpAgent).toBe(false)
    expect(typeof acpAgent.apply).toBe('function')

    /** 中文说明：测试局部值 loader，由紧邻初始化决定。 */
    const loader = Object.create(Loader.prototype) as Loader
    /** 中文说明：测试局部值 unwrapped，由紧邻初始化决定。 */
    const unwrapped = loader.unwrapExports(acpAgent) as Record<string, unknown>
    expect(unwrapped).toBe(acpAgent)
    expect(unwrapped.name).toBe('acp-demo')
    expect(unwrapped.Config).toBeDefined()
    expect(typeof unwrapped.apply).toBe('function')
  })
})
