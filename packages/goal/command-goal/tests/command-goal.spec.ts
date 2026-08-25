/**
 * 文件职责：验证目标管理的 command-goal.spec.ts 行为与安全边界。
 * 技术维度：TypeScript、Cordis、会话事件、路径策略、判别联合和 Vitest。
 * 产品维度：保证目标管理操作可预测、可审计并在失败时保持一致。
 * 逻辑维度：构造请求与状态，驱动服务并断言输出和清理。
 * 关键边界：文件路径必须经过策略检查；目标引用含版本，过期修改必须拒绝。
 * 新手阅读建议：先读类型与测试夹具，再按校验、执行、事件折叠和错误流程阅读。
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import GoalService from '@deepseek-ai/dsh-goal'
import type { GoalRef } from '@deepseek-ai/dsh-goal'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import * as commandGoal from '@deepseek-ai/dsh-command-goal'

/** 中文说明：类型或类 Harness 约束文件或目标数据职责。 */
interface Harness {
  readonly ctx: Context
  readonly agent: Agent
  readonly session: Session
  readonly plugin: Awaited<ReturnType<Context['plugin']>>
}

/** Build a live idle agent accepted by the exact-identity goal service. */
/** 中文说明：函数 stubAgent 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function stubAgent(ctx: Context, id: string): { agent: Agent; session: Session } {
  // Store-created: the command executor durably logs lifecycle events on it.
  /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
  const session = ctx.sessions.create(SessionId(id))
  /** 中文说明：测试局部值 inbox，由紧邻初始化决定。 */
  const inbox = new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} })
  /** 中文说明：测试局部值 status，由紧邻初始化决定。 */
  let status: AgentStatus = 'idle'
  /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
  const agent: Agent = {
    id: session.id,
    options: {},
    session,
    inbox,
    ctx: new Context(),
    get status() { return status },
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject(input) { inbox.append('next-step', input) },
    cancel() { status = 'idle' },
    runMaintenance: task => task(new AbortController().signal),
    whenIdle() { return Promise.resolve() },
  }
  return { agent, session }
}

/** Mount the real command registry, goal domain, and producer. */
/** 中文说明：函数 harness 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function harness(): Promise<Harness> {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(GoalService)
  /** 中文说明：测试局部值 plugin，由紧邻初始化决定。 */
  const plugin = await ctx.plugin(commandGoal)
  /** 中文说明：测试局部值 { agent, session }，由紧邻初始化决定。 */
  const { agent, session } = stubAgent(ctx, `command-goal-${Math.random()}`)
  ctx.agents.register(agent)
  return { ctx, agent, session, plugin }
}

/** The log with executor-owned command lifecycle bookkeeping stripped (goal assertions target domain events). */
/** 中文说明：函数 domainEvents 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function domainEvents(session: Session): readonly Session['events'][number][] {
  /** 中文说明：测试局部值 lifecycle，由紧邻初始化决定。 */
  const lifecycle = new Set<number>()
  /** 中文说明：测试局部值 event，由紧邻初始化决定。 */
  for (const event of session.events) {
    if (event.type !== 'command/run' && event.type !== 'command/done') continue
    lifecycle.add(event.seq)
    // The zero-step wrap around a lifecycle event is bookkeeping too.
    /** 中文说明：测试局部值 before，由紧邻初始化决定。 */
    const before = session.events[event.seq - 1]
    /** 中文说明：测试局部值 after，由紧邻初始化决定。 */
    const after = session.events[event.seq + 1]
    if (before?.type === 'turn/start') lifecycle.add(before.seq)
    if (after?.type === 'turn/end') lifecycle.add(after.seq)
  }
  return session.events.filter(event => !lifecycle.has(event.seq))
}

/** Execute `/goal` through the same registry boundary as a UI adapter. */
/** 中文说明：函数 run 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function run(test: Harness, suffix = ''): Promise<NonNullable<Awaited<ReturnType<CommandRuntime['execute']>>>['result']> {
  /** 中文说明：测试局部值 execution，由紧邻初始化决定。 */
  const execution = await test.ctx.commands.execute(
    test.agent,
    `/goal${suffix}`,
    [],
    new AbortController().signal,
  )
  if (execution === undefined) throw new Error('goal command was not registered')
  return execution.result
}

/** Current exact compare-and-set ref. */
/** 中文说明：函数 ref 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function ref(goal: NonNullable<ReturnType<GoalService['get']>>): GoalRef {
  return { id: goal.id, revision: goal.revision }
}

describe('@deepseek-ai/dsh-command-goal registration', () => {
  it('registers one global command with Loader-safe exports and disposes it', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness()
    expect(commandGoal.name).toBe('command-goal')
    expect(commandGoal.inject).toEqual(['commands', 'goals'])
    expect('default' in commandGoal).toBe(false)
    /** 中文说明：测试局部值 loader，由紧邻初始化决定。 */
    const loader = Object.create(Loader.prototype) as Loader
    expect(loader.unwrapExports(commandGoal)).toBe(commandGoal)

    expect(test.ctx.commands.list(test.agent)).toContainEqual({
      name: 'goal',
      description: 'set or view the goal for a long-running task',
      input: { hint: '[<objective>|clear|edit <objective>|pause|resume]', images: true },
    })
    expect(test.ctx.commands.find(test.agent, 'goal')).toBeDefined()

    await test.plugin.dispose()
    expect(test.ctx.commands.find(test.agent, 'goal')).toBeUndefined()
  })
})

describe('/goal human command', () => {
  it('shows an empty status without mutating the session', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness()
    await expect(run(test)).resolves.toEqual({
      kind: 'success',
      text: 'No goal is currently set.\nUsage: /goal [<objective>|clear|edit <objective>|pause|resume]',
    })
    expect(domainEvents(test.session)).toEqual([])
  })

  it('creates a trimmed objective and refuses silent replacement of unfinished work', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness()
    /** 中文说明：测试局部值 created，由紧邻初始化决定。 */
    const created = await run(test, '\n  finish the release  ')
    expect(created.kind).toBe('success')
    expect(created.text).toContain('Goal created\nStatus: active')
    expect(created.text).toContain('Objective: finish the release')
    expect(created.text).toContain('Rounds: 0/256')
    expect(created.text).toContain('Activation: armed')
    expect(test.ctx.goals.get(test.agent)?.objective).toBe('finish the release')
    expect(domainEvents(test.session).map(event => event.type)).toEqual(['goal/change'])

    /** 中文说明：测试局部值 count，由紧邻初始化决定。 */
    const count = domainEvents(test.session).length
    await expect(run(test, ' replacement')).resolves.toEqual({
      kind: 'error',
      text: 'A goal is already active. Use /goal edit <objective> to change it or /goal clear before replacing it.',
    })
    expect(domainEvents(test.session)).toHaveLength(count)
  })

  it('treats only exact control words as controls', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness()
    await run(test, ' pause everything only after verification')
    expect(test.ctx.goals.get(test.agent)?.objective).toBe('pause everything only after verification')
  })

  it('edits inline, requires an objective, and starts a new goal when the old one is complete', async () => {
    /** 中文说明：测试局部值 empty，由紧邻初始化决定。 */
    const empty = await harness()
    /** 中文说明：测试局部值 invalidEdit，由紧邻初始化决定。 */
    const invalidEdit = await run(empty, ' edit')
    expect(invalidEdit.kind).toBe('error')
    expect(invalidEdit.text).toContain('requires a replacement objective')
    /** 中文说明：测试局部值 missingEdit，由紧邻初始化决定。 */
    const missingEdit = await run(empty, ' edit replacement')
    expect(missingEdit.kind).toBe('error')
    expect(missingEdit.text).toContain('/goal edit requires one')

    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness()
    await run(test, ' first')
    /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
    const first = test.ctx.goals.get(test.agent)!
    /** 中文说明：测试局部值 updated，由紧邻初始化决定。 */
    const updated = await run(test, ' EDIT\n  second  ')
    expect(updated.kind).toBe('success')
    expect(updated.text).toContain('Goal updated')
    expect(test.ctx.goals.get(test.agent)).toMatchObject({ id: first.id, objective: 'second', revision: 2 })

    /** 中文说明：测试局部值 current，由紧邻初始化决定。 */
    const current = test.ctx.goals.get(test.agent)!
    test.ctx.goals.complete(test.agent, ref(current))
    /** 中文说明：测试局部值 replacement，由紧邻初始化决定。 */
    const replacement = await run(test, ' edit third')
    expect(replacement.kind).toBe('success')
    expect(replacement.text).toContain('Goal created')
    expect(test.ctx.goals.get(test.agent)).toMatchObject({ objective: 'third', revision: 1 })
    expect(test.ctx.goals.get(test.agent)?.id).not.toBe(first.id)
  })

  it('returns direct missing-state results for pause, resume, and clear', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness()
    /** 中文说明：测试局部值 missingPause，由紧邻初始化决定。 */
    const missingPause = await run(test, ' pause')
    expect(missingPause.kind).toBe('error')
    expect(missingPause.text).toContain('/goal pause requires one')
    /** 中文说明：测试局部值 missingResume，由紧邻初始化决定。 */
    const missingResume = await run(test, ' resume')
    expect(missingResume.kind).toBe('error')
    expect(missingResume.text).toContain('/goal resume requires one')
    await expect(run(test, ' clear')).resolves.toEqual({ kind: 'success', text: 'No goal to clear.' })
  })

  it('pauses, resumes, clears, and converts expected domain rejections to command errors', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness()
    await run(test, ' work')
    /** 中文说明：测试局部值 redundantResume，由紧邻初始化决定。 */
    const redundantResume = await run(test, ' RESUME')
    expect(redundantResume).toEqual({
      kind: 'error',
      text: 'The goal command is not valid for the current state. Run /goal to view available commands.',
    })
    /** 中文说明：测试局部值 paused，由紧邻初始化决定。 */
    const paused = await run(test, ' PAUSE')
    expect(paused.kind).toBe('success')
    expect(paused.text).toContain('Goal paused')
    expect(test.ctx.goals.get(test.agent)).toMatchObject({ phase: 'paused', activation: 'disarmed' })
    /** 中文说明：测试局部值 resumed，由紧邻初始化决定。 */
    const resumed = await run(test, ' resume')
    expect(resumed.kind).toBe('success')
    expect(resumed.text).toContain('Goal resumed')
    expect(test.ctx.goals.get(test.agent)).toMatchObject({ phase: 'active', activation: 'armed' })
    await expect(run(test, ' clear')).resolves.toEqual({ kind: 'success', text: 'Goal cleared.' })
    expect(test.ctx.goals.get(test.agent)).toBeUndefined()
  })

  it('shows every durable phase and distinguishes disarmed active state', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness()
    test.ctx.goals.create(test.agent, { objective: 'state matrix', maxGoalRounds: 1 })
    test.ctx.goals.disarm(test.agent)
    expect((await run(test)).text)
      .toContain('Status: active\nObjective: state matrix\nRounds: 0/1\nActivation: disarmed')
    expect((await run(test)).text).toContain('/goal resume')

    /** 中文说明：测试局部值 goal，由紧邻初始化决定。 */
    let goal = test.ctx.goals.get(test.agent)!
    goal = test.ctx.goals.resume(test.agent, ref(goal))
    goal = test.ctx.goals.pause(test.agent, ref(goal))
    expect((await run(test)).text).toContain('Status: paused')

    goal = test.ctx.goals.resume(test.agent, ref(goal))
    goal = test.ctx.goals.block(test.agent, ref(goal), {
      code: 'upstream-unavailable',
      message: 'Provider unavailable',
    })
    /** 中文说明：测试局部值 blocked，由紧邻初始化决定。 */
    const blocked = await run(test)
    expect(blocked.text).toContain('Status: blocked')
    expect(blocked.text).toContain('Blocker: upstream-unavailable: Provider unavailable')

    goal = test.ctx.goals.resume(test.agent, ref(goal))
    test.ctx.goals.complete(test.agent, ref(goal))
    /** 中文说明：测试局部值 complete，由紧邻初始化决定。 */
    const complete = await run(test)
    expect(complete.text).toContain('Status: complete')
    expect(complete.text).toContain('Commands: /goal <objective>, /goal clear')
  })

  it('does not turn unexpected implementation failures into expected command results', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness()
    vi.spyOn(test.ctx.goals, 'get').mockImplementationOnce(() => { throw new Error('unexpected failure') })
    await expect(run(test)).rejects.toThrow('unexpected failure')
  })
})

describe('/goal image attachments', () => {
  /** 中文说明：测试局部值 PNG，由紧邻初始化决定。 */
  const PNG = 'AAAA'

  /** Wire the fake store the executor admits through (once per harness). */
  /** 中文说明：函数 provideStore 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
  function provideStore(test: Harness): void {
    /** 中文说明：测试局部值 saved，由紧邻初始化决定。 */
    let saved = 0
    /** 中文说明：测试局部值 saveImage，由紧邻初始化决定。 */
    const saveImage = (input: { mediaType: string; name?: string }) => {
      saved += 1
      return Promise.resolve({
        attachmentId: `att-${saved}`, mediaType: input.mediaType, bytes: 3, width: 1, height: 1,
        ...input.name === undefined ? {} : { name: input.name },
      })
    }
    test.ctx.provide('attachments', {
      imageLimits: {
        maxImageBytes: 1024, maxImagesPerMessage: 4, maxMessageImageBytes: 1024,
        maxImagePixels: 1_000_000, mediaTypes: ['image/png'],
      },
      validateImage: () => Promise.resolve(),
      saveImage,
      async saveImages(inputs: readonly { mediaType: string; name?: string }[]) {
        /** 中文说明：测试局部值 refs，由紧邻初始化决定。 */
        const refs = []
        /** 中文说明：测试局部值 input，由紧邻初始化决定。 */
        for (const input of inputs) refs.push(await saveImage(input))
        return refs
      },
    })
  }

  /** Run /goal with `count` composer images through the executor boundary. */
  /** 中文说明：函数 runWithImages 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
  async function runWithImages(test: Harness, suffix: string, count: number) {
    /** 中文说明：测试局部值 images，由紧邻初始化决定。 */
    const images = Array.from({ length: count }, (_, index) => ({
      mediaType: 'image/png' as const, data: PNG, name: `ref-${index + 1}.png`,
    }))
    /** 中文说明：测试局部值 execution，由紧邻初始化决定。 */
    const execution = await test.ctx.commands.execute(test.agent, `/goal${suffix}`, images, new AbortController().signal)
    if (execution === undefined) throw new Error('goal command was not registered')
    return execution.result
  }

  it('submits one user followup carrying the admitted images ahead of the round prompt', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness()
    provideStore(test)
    /** 中文说明：测试局部值 followup，由紧邻初始化决定。 */
    const followup = vi.fn()
    ;(test.agent as unknown as { followup: typeof followup }).followup = followup
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await runWithImages(test, ' rebuild the cathedral', 2)
    expect(result.kind).toBe('success')
    expect(followup).toHaveBeenCalledTimes(1)
    /** 中文说明：测试局部值 message，由紧邻初始化决定。 */
    const message = followup.mock.calls[0]?.[0] as {
      content: ReadonlyArray<Record<string, unknown>>
      source: { kind: string }
    }
    expect(message.source).toEqual({ kind: 'user' })
    expect(message.content.map(block => block.type)).toEqual(['image', 'image', 'text'])
    expect(message.content.at(-1)).toEqual({ type: 'text', text: 'Reference images for the goal objective.' })
    expect((message.content[0] as { attachment: { name: string } }).attachment.name).toBe('ref-1.png')
  })

  it('accompanies an edit and a post-complete recreate the same way', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness()
    provideStore(test)
    /** 中文说明：测试局部值 followup，由紧邻初始化决定。 */
    const followup = vi.fn()
    ;(test.agent as unknown as { followup: typeof followup }).followup = followup
    test.ctx.goals.create(test.agent, { objective: 'initial objective' })
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await runWithImages(test, ' edit refined objective', 1)
    expect(result.kind).toBe('success')
    expect(followup).toHaveBeenCalledTimes(1)
  })

  it('rejects attachments on sub-commands that cannot use them, leaving the domain untouched', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness()
    provideStore(test)
    /** 中文说明：测试局部值 followup，由紧邻初始化决定。 */
    const followup = vi.fn()
    ;(test.agent as unknown as { followup: typeof followup }).followup = followup
    test.ctx.goals.create(test.agent, { objective: 'active objective' })
    /** 中文说明：测试局部值 suffix，由紧邻初始化决定。 */
    for (const suffix of [' pause', '', ' clear']) {
      /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
      const result = await runWithImages(test, suffix, 1)
      expect(result).toEqual({
        kind: 'error',
        text: 'Image attachments only accompany a goal objective: /goal <objective> or /goal edit <objective>.',
      })
    }
    expect(followup).not.toHaveBeenCalled()
    expect(test.ctx.goals.get(test.agent)?.phase).toBe('active')
  })

  it('does not submit attachments when goal creation is refused', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness()
    provideStore(test)
    /** 中文说明：测试局部值 followup，由紧邻初始化决定。 */
    const followup = vi.fn()
    ;(test.agent as unknown as { followup: typeof followup }).followup = followup
    test.ctx.goals.create(test.agent, { objective: 'existing objective' })
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await runWithImages(test, ' replacement objective', 1)
    expect(result.kind).toBe('error')
    expect(followup).not.toHaveBeenCalled()
  })
})
