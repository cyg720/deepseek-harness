/**
 * 文件职责：验证 api/session-controller 中 control jobs host spec 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { JobOutcome } from '@deepseek-ai/dsh-jobs'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { SessionControlController } from '../src/control.ts'
import type { SessionControlFrame } from '../src/types.ts'

type BaselineFrame = Extract<SessionControlFrame, { type: 'baseline' }>
type JobFrame = Extract<SessionControlFrame, { type: 'jobs' }>

/**
 * 功能说明：处理 producer 相关流程；使用场景由所在模块及调用位置决定。
 * @param label （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 producer(label)，并按返回类型处理结果。
 */
function producer(label = 'sleep 60') {
  /**
   * 变量说明：settle 用于处理 settle 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let settle!: (outcome: JobOutcome) => void
  /**
   * 常量说明：reads 用于处理 reads 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const reads = { count: 0 }
  /**
   * 常量说明：spec 用于处理 spec 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const spec = {
    kind: 'bash' as const,
    label,
    run: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => ({
      cancel: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {},
      done: new Promise<JobOutcome>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
 */ (resolve) => { settle = resolve }),
      readOutput: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { reads.count += 1; return 'stolen output' },
    }),
  }
  return { spec, reads, settle: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：outcome（JobOutcome）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 典型用法：在完成前置校验后调用 匿名回调(outcome)，并按返回类型处理结果。
 */ (outcome: JobOutcome) => { settle(outcome) } }
}

/**
 * 功能说明：处理 harness 相关流程；使用场景由所在模块及调用位置决定。
 * @param withRegistry （boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Promise<{ ctx: Context session: Session agent: Agent control:
 * Session…；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 harness(withRegistry)，并按返回类型处理结果。
 */
async function harness(withRegistry: boolean): Promise<{
  ctx: Context
  session: Session
  agent: Agent
  control: SessionControlController
}> {
  /**
   * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  if (withRegistry) {
    await ctx.plugin(LocalJobRegistry)
    ctx.jobs.attachController('session-controller-test')
  }
  /**
   * 常量说明：session 用于处理 session 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const session = ctx.sessions.create()
  /**
   * 常量说明：agent 用于处理 agent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const agent = {
    id: session.id,
    session,
    inbox: new Inbox(session, { inserted: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {}, discarded: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {}, claimed: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {} }),
    status: 'idle',
    ctx,
  } as Agent
  ctx.agents.register(agent)
  /**
   * 常量说明：control 用于处理 control 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const control = new SessionControlController(ctx)
  await new Promise(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
 */ resolve => setTimeout(resolve, 0))
  return { ctx, session, agent, control }
}

/**
 * 功能说明：处理 baseline 相关流程；使用场景由所在模块及调用位置决定。
 * @param control （SessionControlController）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Promise<BaselineFrame>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 baseline(control)，并按返回类型处理结果。
 */
async function baseline(control: SessionControlController): Promise<BaselineFrame> {
  /**
   * 常量说明：abort 用于处理 abort 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const abort = new AbortController()
  /**
   * 常量说明：iterator 用于处理 iterator 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const iterator = control.control(abort.signal)[Symbol.asyncIterator]()
  /**
   * 常量说明：first 用于处理 first 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const first = await iterator.next()
  abort.abort()
  await iterator.next()
  if (first.done || first.value.type !== 'baseline') throw new Error('missing control baseline')
  return first.value
}

/**
 * 功能说明：收集 Jobs 相关流程；使用场景由所在模块及调用位置决定。
 * @param iterable （AsyncIterable<SessionControlFrame>）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @param count （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param abort （AbortController）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Promise<JobFrame[]>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 collectJobs(iterable, count, abort)，并按返回类型处理结果。
 */
async function collectJobs(
  iterable: AsyncIterable<SessionControlFrame>,
  count: number,
  abort: AbortController,
): Promise<JobFrame[]> {
  /**
   * 常量说明：jobs 用于处理 jobs 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const jobs: JobFrame[] = []
  for await (const /*
   * 变量说明：frame 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */ frame of iterable) {
    if (frame.type !== 'jobs') continue
    jobs.push(frame)
    if (jobs.length >= count) abort.abort()
  }
  return jobs
}

describe('Session control jobs baseline', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
    it('represents an attached session with no jobs as an empty set', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：session、control 用于处理 session、control 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { session, control } = await harness(true)
        /**
     * 常量说明：frame 用于处理 frame 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const frame = await baseline(control)
        expect(frame.value.jobs[session.id]).toEqual([])
      })

    it('carries the visible set when the stream opens', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx、session、agent、control 用于处理 ctx、session、agent、control 相关数据，
     * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const { ctx, session, agent, control } = await harness(true)
        ctx.jobs.start({ ...producer('pnpm run build').spec, owner: agent })
        /**
     * 常量说明：frame 用于处理 frame 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const frame = await baseline(control)
        /**
     * 常量说明：jobs 用于处理 jobs 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const jobs = frame.value.jobs[session.id]
        expect(jobs).toHaveLength(1)
        /**
     * 常量说明：job 用于处理 job 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const [job] = jobs ?? []
        expect(job?.startedAt).toBeTypeOf('number')
        expect({ ...job, startedAt: 0 }).toEqual({
          id: 'bash-1',
          kind: 'bash',
          label: 'pnpm run build',
          status: 'running',
          startedAt: 0,
        })
      })
  })

describe('Session control jobs updates', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
    it('publishes existing unowned jobs when a Session attaches after the stream opens', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx、control 用于处理 ctx、control 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { ctx, control } = await harness(true)
        /**
     * 常量说明：abort 用于处理 abort 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const abort = new AbortController()
        /**
     * 常量说明：iterator 用于处理 iterator 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const iterator = control.control(abort.signal)[Symbol.asyncIterator]()
        await expect(iterator.next()).resolves.toMatchObject({ value: { type: 'baseline' } })
        /**
     * 常量说明：task 用于处理 task 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const task = producer('already running')
        /**
     * 常量说明：id 用于处理 id 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const id = ctx.jobs.start(task.spec)
        await expect(iterator.next()).resolves.toMatchObject({ value: { type: 'jobs' } })

        /**
     * 常量说明：created 用于处理 created 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const created = ctx.sessions.create(SessionId('late-session'))
        await expect(iterator.next()).resolves.toMatchObject({
          value: {
            type: 'jobs',
            sessionId: created.id,
            jobs: [expect.objectContaining({ id, label: 'already running' })],
          },
        })

        task.settle({ status: 'completed' })
        abort.abort()
        await iterator.return?.()
      })

    it('pushes the owner whole set on registration, stopping, and settlement', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx、session、agent、control 用于处理 ctx、session、agent、control 相关数据，
     * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const { ctx, session, agent, control } = await harness(true)
        /**
     * 常量说明：abort 用于处理 abort 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const abort = new AbortController()
        /**
     * 常量说明：collected 用于处理 collected 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const collected = collectJobs(control.control(abort.signal), 3, abort)

        /**
     * 常量说明：task 用于处理 task 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const task = producer()
        /**
     * 常量说明：id 用于处理 id 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const id = ctx.jobs.start({ ...task.spec, owner: agent })
        ctx.jobs.kill(id, agent, 'test')
        task.settle({ status: 'killed', detail: 'signal: SIGTERM' })

        /**
     * 常量说明：frames 用于处理 frames 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const frames = await collected
        expect(frames.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：frame（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(frame)，并按返回类型处理结果。
 */ frame => frame.sessionId)).toEqual([session.id, session.id, session.id])
        expect(frames.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：frame（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(frame)，并按返回类型处理结果。
 */ frame => frame.jobs[0]?.status)).toEqual(['running', 'stopping', 'killed'])
        expect(frames[2]?.jobs[0]?.detail).toBe('signal: SIGTERM')
        expect(frames[2]?.jobs[0]?.finishedAt).toBeTypeOf('number')
      })

    it('drops internal registry fields from the browser view', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx、agent、control 用于处理 ctx、agent、control 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { ctx, agent, control } = await harness(true)
        /**
     * 常量说明：abort 用于处理 abort 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const abort = new AbortController()
        /**
     * 常量说明：collected 用于处理 collected 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const collected = collectJobs(control.control(abort.signal), 1, abort)
        ctx.jobs.start({ ...producer().spec, owner: agent, outputLimitBytes: 1_024 })

        /**
     * 常量说明：frame 用于处理 frame 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const [frame] = await collected
        expect(Object.keys(frame?.jobs[0] ?? {}).sort()).toEqual([
          'id',
          'kind',
          'label',
          'startedAt',
          'status',
        ])
      })

    it('fans an unowned change out to every attached session', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx、control 用于处理 ctx、control 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { ctx, control } = await harness(true)
        /**
     * 常量说明：second 用于处理 second 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const second = ctx.sessions.create()
        /**
     * 常量说明：abort 用于处理 abort 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const abort = new AbortController()
        /**
     * 常量说明：collected 用于处理 collected 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const collected = collectJobs(control.control(abort.signal), 2, abort)

        ctx.jobs.start(producer('open to every caller').spec)

        /**
     * 常量说明：frames 用于处理 frames 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const frames = await collected
        expect(new Set(frames.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：frame（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(frame)，并按返回类型处理结果。
 */ frame => frame.sessionId)).size).toBe(2)
        expect(frames.some(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：frame（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(frame)，并按返回类型处理结果。
 */ frame => frame.sessionId === second.id)).toBe(true)
        for (const /*
     * 变量说明：frame 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */ frame of frames) expect(frame.jobs[0]?.label).toBe('open to every caller')
      })

    it('does not resume persisted sessions while projecting an unowned change', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx、control 用于处理 ctx、control 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { ctx, control } = await harness(true)
        /**
     * 常量说明：coldId 用于处理 coldId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const coldId = SessionId('session-cold-tasks')
        /**
     * 变量说明：loaded 用于处理 loaded 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
        let loaded = false
        ctx.provide('sessionPersistence', {
          list: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => [{ version: 0, id: coldId, createdAt: 5, cwd: '/tmp' }],
          locate: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => undefined,
          load: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { loaded = true; throw new Error('job projection must not load a cold log') },
        } as never)
        /**
     * 常量说明：abort 用于处理 abort 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const abort = new AbortController()
        /**
     * 常量说明：collected 用于处理 collected 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const collected = collectJobs(control.control(abort.signal), 1, abort)

        ctx.jobs.start(producer().spec)
        await collected
        expect(loaded).toBe(false)
        expect(ctx.agents.get(coldId)).toBeUndefined()
      })

    it('reports empty sets when no jobs registry is composed', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：session、control 用于处理 session、control 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { session, control } = await harness(false)
        /**
     * 常量说明：frame 用于处理 frame 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const frame = await baseline(control)
        expect(frame.value.jobs[session.id]).toEqual([])
      })

    it('never consumes model output while projecting a lifecycle', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx、agent、control 用于处理 ctx、agent、control 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { ctx, agent, control } = await harness(true)
        /**
     * 常量说明：abort 用于处理 abort 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const abort = new AbortController()
        /**
     * 常量说明：collected 用于处理 collected 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const collected = collectJobs(control.control(abort.signal), 3, abort)

        /**
     * 常量说明：task 用于处理 task 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const task = producer()
        /**
     * 常量说明：id 用于处理 id 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const id = ctx.jobs.start({ ...task.spec, owner: agent })
        ctx.jobs.kill(id, agent, 'test')
        task.settle({ status: 'killed', detail: 'signal: SIGTERM' })
        await collected

        expect(task.reads.count).toBe(0)
      })

    it('never consumes model output while producing a baseline', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx、agent、control 用于处理 ctx、agent、control 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { ctx, agent, control } = await harness(true)
        /**
     * 常量说明：task 用于处理 task 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const task = producer()
        ctx.jobs.start({ ...task.spec, owner: agent })

        /**
     * 常量说明：frame 用于处理 frame 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const frame = await baseline(control)

        expect(frame.value.jobs[agent.id]).toHaveLength(1)
        expect(task.reads.count).toBe(0)
      })

  })
