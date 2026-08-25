/*
 * ================================ 文件注释 ================================
 * 【文件职责】实现 ReactLoopAgent：agent-loop 的核心驱动类，把一条会话推进过“轮次 turn → 步骤 step → 模型请求 → 工具调用 → 结果回灌”的循环。
 * 【技术维度】基于 vendored Cordis；通过瀑布式事件（agent/pre-step、agent/request）暴露扩展点；所有模型可见输入都持久化到会话日志（模型可见即日志可重建）。
 * 【产品维度】用户每发一条消息都由它驱动模型回复；工具调用、出错重试、取消、维护任务等生命周期行为都编排在 turn()/step() 中。
 * 【逻辑维度】按代码顺序：Phase 状态机 → send/steer/inject 入站 → cancel/whenIdle 生命周期 → wakeDriver 唤醒闩锁 → turn 开轮 → step 单步 → buildRequest 组装冻结请求。
 * 【关键边界】不负责智能体的创建与注册（那是 index.ts 的 AgentLoop）；请求必须冻结且能从会话日志重建；错误要么结构化要么归一到 UNKNOWN 码；max-tokens 结论有粘性，后续步骤不能降级。
 * 【新手阅读建议】先读 Phase 与构造函数了解状态，再读 turn() 与 step() 两个核心循环，最后看 buildRequest()；wakeDriver 的唤醒闩锁逻辑较绕，可放最后。
 * ==========================================================================
 */
/**
 * Default Agent driver over queued turns and step-boundary input. Every request
 * is derived from the session log.
 * @module dsh-agent-loop/agent
 */

import type {
  Agent,
  AgentCancelCause,
  AgentEventDispatch,
  AgentOptions,
  AgentStatus,
  CancelOptions,
  InboxTarget,
  PreStepDecision,
  RequestErrorAction,
} from '@deepseek-ai/dsh-agent'
import { Inbox, agentEvents, assembleContextFor } from '@deepseek-ai/dsh-agent'
import type { GenerateOptions, LlmCallConfig, Message, PreparedLlmCall } from '@deepseek-ai/dsh-llm'
import {
  BlockAssembler,
  LlmError,
  createAssistantMessage,
  deepFreeze,
  errorChain,
  markAgentLoopRequest,
} from '@deepseek-ai/dsh-llm'
import type { Scope } from '@deepseek-ai/dsh-scope'
import { createScope } from '@deepseek-ai/dsh-scope'
import type { EpochHeader, RequestContext, Session, SessionId, TurnEndReason, UserMessage } from '@deepseek-ai/dsh-session'
import { canonicalHeader, headerEquals } from '@deepseek-ai/dsh-session'
import { joinContextSections, renderContextSections, renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import type { Context } from '@deepseek-ai/cordis'
import { RuntimeContextProjection } from './runtime-context.ts'
import { executeToolCalls } from './tool-calls.ts'

// 驱动器状态机：idle = 无活动；maintenance = 正在跑非轮次维护任务；running = 驱动器正在推进轮次/步骤。
type Phase =
  | { kind: 'idle'; lastTurn: number }
  | {
    kind: 'maintenance'
    abort: AbortController
    lastTurn: number
    wakeRequested: boolean
  }
  | { kind: 'running'; abort: AbortController; turn: number; step: number; wakeRequested: boolean }

// 步骤的结束原因：只有“完成”和“撞上输出上限”两种（其余 turn 结束原因不会从步骤层面返回）。
type StepEndReason = Extract<TurnEndReason, { kind: 'completed' | 'max-tokens' }>

// 一步的准备结果：reject = 该步骤被拒（轮次以 blocked 收尾）；enter = 带着消息与组装好的提示词进入模型调用。
type PreparedStep =
  | { kind: 'reject' }
  | { kind: 'enter'; messages: UserMessage[]; assembly: PromptAssembly }

/** Remove adapter-derived values before plugins propose the next request config. */
// 在把上一请求头交给 agent/request 瀑布前，先剥掉由适配器派生（adapterDefaults 标记）的字段，
// 让插件基于“用户配置层”的纯净值提出下一个请求配置。
function requestProposal(header: EpochHeader): LlmCallConfig {
  if (header.adapterDefaults === undefined) return header.config
  const proposal = { ...header.config }
  if (header.adapterDefaults.reasoningEffort === true) delete proposal.reasoningEffort
  if (header.adapterDefaults.maxTokens === true) delete proposal.maxTokens
  return proposal
}

/** Drives one session through turn and step boundaries. */
// ReactLoopAgent：把一个会话推进过“轮次 → 步骤 → 模型请求 → 工具调用”循环的驱动器；每个 agent 一个实例。
export class ReactLoopAgent implements Agent {
  // 待处理消息队列投影：外部通过它投递 followup/steer/inject，循环通过它领取每步的输入。
  readonly inbox: Inbox
  // 当前驱动器状态（见 Phase 状态机）。
  private phase: Phase
  // 当前“整机活动”的完成承诺：whenIdle() 等它收敛；替换活动时会被覆盖。
  private activityDone: Promise<void> = Promise.resolve()

  /** The agent-scoped registration boundary; the lifecycle owner unwinds it after the driver exits. */
  // 本 agent 专属作用域：其 ctx 下注册的一切（工具、监听器等）都随作用域拆除统一回收。
  readonly scope: Scope
  // 作用域上下文（scope.ctx 的延伸，带 agent 关联），agent 内所有注册与分发都走它。
  readonly ctx: Context

  /** Fused dispatcher, built once in the constructor so hot-path dispatches never allocate. */
  // 融合分发器：构造时建一次，热路径分发时复用，避免每次分配载体。
  private readonly dispatch: AgentEventDispatch

  /** Whether this loop instance has appended its initial/resume request anchor. */
  // 是否已写入过首个 request/header 锚点：决定后续请求头是“首次写入”还是“变更写入”。
  private requestHeaderLogged = false
  // 动态运行时上下文的持久化投影（追踪 dsh-system-prompt 快照，见 runtime-context.ts）。
  private readonly runtimeContext: RuntimeContextProjection

  // 构造：建分发器/收件箱/作用域/投影，并从会话日志恢复轮次计数。
  constructor(
    private loopCtx: Context,
    public readonly id: SessionId,
    public readonly options: AgentOptions,
    public readonly session: Session,
  ) {
    // 分发器与收件箱通知桥接：inbox 的插入/丢弃/领取直接转成对应 agent 事件。
    this.dispatch = agentEvents(loopCtx, this)
    this.inbox = new Inbox(session, {
      inserted: (message) => { this.dispatch.emit('agent/inbox/inserted', { message }) },
      discarded: (message) => { this.dispatch.emit('agent/inbox/discarded', { message }) },
      claimed: (message, turn) => { this.dispatch.emit('agent/inbox/claimed', { message, turn }) },
    })
    // 从日志恢复“上一轮次号”：resume 续跑时从 turn/start 事件倒查，没有则从 0 开始。
    const lastTurn = session.events.findLast(event => event.type === 'turn/start')?.data.turn ?? 0
    this.phase = { kind: 'idle', lastTurn }
    // 建作用域并让 ctx 带上 agent 关联（供 ctx.agent 读取与 scope 过滤）。
    this.scope = createScope(loopCtx, this)
    this.ctx = this.scope.ctx.extend({ agent: this })
    this.runtimeContext = new RuntimeContextProjection(this.ctx, session)
  }

  // 对外状态：idle（无驱动器）或 running（驱动器活跃）；maintenance 对外仍表现为 idle。
  get status(): AgentStatus {
    return this.phase.kind === 'idle' || this.phase.kind === 'maintenance' ? 'idle' : 'running'
  }

  /** Commit a phase and publish its externally visible status transition. */
  // 提交新状态：若对外状态发生翻转，则发布一次 agent/status 事件。
  private setPhase(next: Phase): void {
    const previousStatus = this.status
    this.phase = next
    const status = this.status
    if (status !== previousStatus) {
      this.dispatch.emit('agent/status', { status })
    }
  }

  // 通用投递入口：先按目标边界做 splice 插入，需要唤醒时再调用 wakeDriver。
  send(message: UserMessage, target: InboxTarget, wakeup: boolean): void {
    // Waking input cannot join an aborted activity, so it starts the next turn.
    // Captured before the insertion so a reentrant cancel from a splice observer cannot reclassify it.
    // 唤醒输入不能加入已中止的活动：若唤醒发生在“非 idle 且已中止”的相位上，目标改投到下一轮，
    // 且此判定必须在插入之前捕获，防止 splice 观察者的重入取消改变它。
    const wakingAfterAbort = wakeup && this.phase.kind !== 'idle' && this.phase.abort.signal.aborted
    const resolvedTarget = wakingAfterAbort ? 'next-turn' : target
    this.inbox.splice(resolvedTarget, Infinity, 0, [message])
    if (wakeup) this.wakeDriver(wakingAfterAbort)
  }

  // 普通追问：进入下一轮队列并唤醒驱动器。
  followup(input: UserMessage): void {
    this.send(input, 'next-turn', true)
  }

  // 转向（steering）：投到最近一步边界并唤醒，正在运行的驱动器在下一轮步骤边界消费。
  steer(input: UserMessage): void {
    this.send(input, 'next-step', true)
  }

  // 上下文注入：投到最近一步边界但不唤醒（只等已有活动顺路消费）。
  inject(input: UserMessage): void {
    this.send(input, 'next-step', false)
  }

  // 取消：默认清空收件箱并中止当前活动；keepInbox 保留队列（只中止活动）。
  cancel(cause: AgentCancelCause, options: CancelOptions = {}): void {
    if (!options.keepInbox) {
      this.inbox.clear()
      if (this.phase.kind !== 'idle') this.phase.wakeRequested = false
    }
    if (this.phase.kind !== 'idle') this.phase.abort.abort(cause)
  }

  // 维护任务：只能在 idle 相位启动（否则同步抛错）；任务期间的唤醒输入先闩锁，任务收敛后再播放。
  runMaintenance<T>(job: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.phase.kind !== 'idle') throw new Error(`agent "${this.id}" already has active work`)
    const done = Promise.withResolvers<void>()
    const maintenance: Phase = {
      kind: 'maintenance',
      abort: new AbortController(),
      lastTurn: this.phase.lastTurn,
      wakeRequested: false,
    }
    this.setPhase(maintenance)
    this.activityDone = done.promise
    return (async () => {
      try {
        return await job(maintenance.abort.signal)
      } finally {
        this.setPhase({ kind: 'idle', lastTurn: maintenance.lastTurn })
        // 维护期间收到过唤醒且收件箱仍有内容：回到 idle 后补一次唤醒。
        if (maintenance.wakeRequested && this.inbox.hasPending) this.wakeDriver()
        done.resolve()
      }
    })()
  }

  /**
   * Start one driver, or latch its wake behind maintenance or an aborted
   * activity. A wake sent while idle always opens its turn boundary, even
   * when its message was cleared; only a latched replay is suppressed when
   * the queue no longer holds the wake.
   * @param wakeAfterAbort - the {@link send} classification, captured before
   *   the inbox insertion so a reentrant cancel cannot reclassify it.
   */
  // 唤醒驱动器：idle 时启动一个 running 驱动器；否则把唤醒闩锁下来，等当前活动收敛后再播放。
  private wakeDriver(wakeAfterAbort = false): void {
    if (this.phase.kind !== 'idle') {
      // Maintenance and aborted drivers cannot deliver the wake: latch it for
      // replay at convergence. Live drivers claim queued work themselves;
      // disposal never latches, so teardown waits on no model turn.
      // 维护/已中止的驱动器无法当场投递唤醒：先闩锁待收敛后重放；存活驱动器会自己领取队列工作；
      // “已处置（disposed）”的取消绝不闩锁，保证拆除流程不会等待模型轮次。
      const reason = this.phase.abort.signal.reason as AgentCancelCause | undefined
      if (reason?.kind !== 'disposed' && (this.phase.kind === 'maintenance' || wakeAfterAbort)) {
        this.phase.wakeRequested = true
      }
      return
    }
    // idle：真正启动驱动器，从 lastTurn 接着开轮。
    const driver = Promise.withResolvers<void>()
    this.activityDone = driver.promise
    this.setPhase({
      kind: 'running',
      abort: new AbortController(),
      turn: this.phase.lastTurn,
      step: 0,
      wakeRequested: false,
    })
    // 驱动器在“本 agent 为发起者”的边界内跑，使工具执行能归属到该 agent。
    this.loopCtx.agents.withInitiator(this, () => this.kick()).then(driver.resolve, driver.reject)
  }

  // 等待整机活动收敛：若等待期间又启动了新活动，则继续等新的完成承诺（活动替换感知）。
  async whenIdle(): Promise<void> {
    let activity: Promise<void>
    do {
      await (activity = this.activityDone)
    } while (activity !== this.activityDone)
  }

  /** Report one failure at its live boundary, then preserve it for driver containment. */
  // 在“活的边界”上报一次失败（agent/error 事件），再原样抛出交给驱动器兜底。
  private throwError(error: unknown): never {
    const turn = this.phase.kind === 'running' ? this.phase.turn : this.phase.lastTurn
    const step = this.phase.kind === 'running' ? this.phase.step : 0
    this.dispatch.emit('agent/error', { turn, step, error })
    throw error
  }

  // 驱动器主循环：能开轮就开轮；turn() 返回 false 表示收件箱已空，循环结束。
  private async kick(): Promise<void> {
    try {
      while (await this.turn()) {}
    } catch (_error) {
      // Reported failures and cancellation are contained at the driver boundary.
      // 已上报的失败与取消在驱动器边界被吞掉（事件已发，不再向上冒泡）。
    } finally {
      /* v8 ignore next -- kick owns a running phase until this driver boundary */
      if (this.phase.kind === 'running') {
        const { turn, wakeRequested } = this.phase
        this.setPhase({ kind: 'idle', lastTurn: turn })
        // 驱动器退出前收到过唤醒且队列非空：补一次唤醒续跑。
        if (wakeRequested && this.inbox.hasPending) this.wakeDriver()
      }
    }
  }

  // 一步的准备工作：领取输入 → 组装系统提示词 → 投影运行时上下文 → 走 agent/pre-step 瀑布（可拒绝或改写消息）。
  private async preStep(target: InboxTarget, position: { turn: number; step: number }): Promise<PreparedStep> {
    /* v8 ignore next -- private callers establish the running phase before proposing a step */
    if (this.phase.kind !== 'running') throw new Error(`agent "${this.id}": pre-step outside running phase`)
    const signal = this.phase.abort.signal
    const claimed = this.inbox.claim(target, position.turn)
    const assembly = await this.loopCtx.systemPrompt.assemble(assembleContextFor(this, signal))
    signal.throwIfAborted()
    const sections = renderContextSections(assembly)
    // 动态运行时上下文：与上次比较，有变化则生成一条快照消息追加进本步输入。
    const context = this.runtimeContext.project(joinContextSections(sections), sections)
    const decision = await this.dispatch.waterfall(
      'agent/pre-step', { messages: claimed, ...position, signal },
      (): Promise<PreStepDecision> => Promise.resolve<PreStepDecision>({
        kind: 'enter',
        messages: context === undefined ? claimed : [...claimed, context],
      }),
    )
    signal.throwIfAborted()
    // reject 原样返回；enter 则把组装好的提示词一并带回（供 step 渲染系统提示词）。
    return decision.kind === 'reject' ? decision : { ...decision, assembly }
  }

  /** Open one turn before claiming its first proposed step. */
  // 开一个轮次并驱动其内部步骤循环；返回是否还有工作要开下一轮。
  private async turn(): Promise<boolean> {
    if (this.phase.kind !== 'running') {
      this.throwError(new Error(`agent "${this.id}": turn without driver reservation`))
    }
    const phase = this.phase
    const { signal } = phase.abort
    signal.throwIfAborted()
    const turn = phase.turn + 1
    try {
      // 轮次边界：先写 turn/start 事件（持久化），再推进内存相位。
      this.session.append('turn/start', { turn })
    } catch (error: unknown) {
      this.throwError(error)
    }
    phase.turn = turn
    // turnEnds：本轮的最终结束原因（开始时未知，退出循环前必定赋值）。
    let turnEnds: TurnEndReason | null = null
    // target：本步从哪个边界领取输入；首步领 next-turn，之后领 next-step。
    let target: InboxTarget = 'next-turn'
    try {
      while (true) {
        signal.throwIfAborted()
        const step = phase.step + 1
        const decision = await this.preStep(target, { turn, step })
        if (decision.kind === 'reject') {
          // 预步被拒：本轮以 blocked 收尾，不再调用模型。
          turnEnds = { kind: 'blocked' }
          return false
        }
        // 已有结束原因且本步无消息：直接收尾（不产生空步骤）。
        if (turnEnds && decision.messages.length === 0) break
        // A removed waking message or an enter decision rewritten to empty
        // still owns the initial turn boundary, but it spends no model call.
        // 首步消息被移除或改写为空：仍算完成了一轮（拥有轮次边界），但不花费模型调用。
        if (phase.step === 0 && decision.messages.length === 0) {
          turnEnds = { kind: 'completed' }
          return false
        }
        signal.throwIfAborted()
        // 步骤边界：写 step/start，再把本步消息逐条落盘为 user/message。
        this.session.append('step/start', { turn, step })
        phase.step = step
        try {
          for (const message of decision.messages) {
            this.session.append('user/message', message, { surfaceOp: 'append' })
          }
          // max-tokens is sticky: once any step hits the ceiling, later steps
          // that complete normally must not downgrade the turn outcome.
          // max-tokens 具有粘性：一旦某步撞上限，后续正常完成的步骤不得把轮次结论降级。
          const stepEnd = await this.step(decision.assembly)
          // max-tokens stays sticky: a later completed step must not
          // downgrade the turn outcome.
          // 再次强调粘性：后完成的步骤不得降级轮次结论。
          if (turnEnds === null || turnEnds.kind !== 'max-tokens') turnEnds = stepEnd
        } finally {
          this.session.append('step/end', { turn, step })
        }
        signal.throwIfAborted()
        // 轮次要收尾时（步骤已给出结论且无新转向输入），先让 agent/turn-stopping 观察者表态。
        if (turnEnds && this.inbox.nextStep.length === 0) {
          await this.dispatch.serial('agent/turn-stopping', { turn, signal })
          signal.throwIfAborted()
        }
        // 观察者可能 steer 了新输入：无结论或还有 next-step 就继续下一轮步骤。
        if (turnEnds && this.inbox.nextStep.length === 0) break
        target = 'next-step'
      }
    } catch (error: unknown) {
      if (signal.aborted) {
        // 中止：结束原因记为 aborted（带取消原因），错误继续向上抛由驱动器兜底。
        turnEnds = { kind: 'aborted', reason: signal.reason as AgentCancelCause }
        throw error
      }
      // Every failure is structured: an `LlmError` keeps its facts, anything
      // else flattens to `errorChain` text under the `UNKNOWN` code.
      // 一切失败都要结构化：LlmError 保留原事实，其它错误扁平化为 errorChain 文本 + UNKNOWN 码。
      turnEnds = {
        kind: 'error',
        error: error instanceof LlmError
          ? error.failure
          : { message: errorChain(error), code: 'UNKNOWN' },
      }
      this.throwError(error)
    } finally {
      try {
        // 无论正常/中止/失败，退出前都必须写 turn/end 收尾轮次。
        // oxlint-disable-next-line typescript/no-non-null-assertion -- every exit assigns a turn ending
        this.session.append('turn/end', { turn, reason: turnEnds! })
      } catch (error: unknown) {
        this.throwError(error)
      }
    }
    // 队列中还有工作：换新 AbortController 继续下一轮（旧控制器上闩锁的唤醒已失效，活驱动器自己领队列）。
    if (!this.inbox.hasPending) return false
    phase.abort = new AbortController()
    // A fresh controller makes a latch set on the old one stale: the live driver claims the queue itself.
    phase.wakeRequested = false
    phase.step = 0
    return true
  }

  // 单步执行：组装请求 → 流式接收模型输出 → 处理错误/撞限 → 执行工具调用，直到步骤有结论。
  private async step(assembly: PromptAssembly): Promise<StepEndReason | null> {
    /* v8 ignore next -- private callers establish the running phase before executing a step */
    if (this.phase.kind !== 'running') throw new Error(`agent "${this.id}": step outside running phase`)
    const { turn, step, abort: { signal } } = this.phase
    signal.throwIfAborted()
    // 渲染系统提示词（含变量替换后的最终文本）。
    const system = renderPrompt(assembly)

    while (true) {
      // 组装并冻结请求（提供方/模型/工具/消息/会话 id）。
      const { request, preparedCall } = await this.buildRequest(
        turn, step, assembly.tools, system, this.session.deriveMessages(), signal,
      )
      const assembler = new BlockAssembler()
      // chunkSeqs：本步所有 assistant/chunk 的序号，供最终 assistant/message 引用溯源。
      const chunkSeqs: number[] = []
      try {
        // 流式拉取模型输出：有 preparedCall 用适配器的流，否则走 llm 服务的默认流。
        const stream = preparedCall?.stream(request) ?? this.loopCtx.llm.stream(request)
        signal.throwIfAborted()
        for await (const chunk of stream) {
          signal.throwIfAborted()
          chunkSeqs.push(this.session.append('assistant/chunk', { turn, step, chunk }).seq)
          assembler.push(chunk)
        }
        signal.throwIfAborted()
      } catch (error: unknown) {
        if (signal.aborted) {
          // 中止时已收到的块若能组成消息：补写一条 interrupted 的 assistant/message，保留部分产物。
          const content = assembler.interruptedBlocks()
          if (content.length > 0) {
            this.session.append('assistant/message', {
              turn,
              step,
              message: createAssistantMessage({
                content,
                source: { provider: request.provider, model: request.model },
              }),
              interrupted: true,
              ...assembler.usage === undefined ? {} : { usage: assembler.usage },
            }, { surfaceOp: 'append', sourceEventSeqs: chunkSeqs })
          }
        }
        throw error
      }
      const finish = assembler.finish
      if (finish.kind === 'error' || finish.kind === 'aborted') {
        // 请求失败：走 agent/request-error 瀑布——监听器可返回 retry 让本步骤重试，否则抛出 LlmError。
        const action = await this.dispatch.waterfall(
          'agent/request-error', {
            turn,
            step,
            provider: request.provider,
            failure: finish.failure,
            retryPolicy: preparedCall?.retryPolicy,
            signal,
          },
          () => Promise.resolve<RequestErrorAction>(undefined),
        )
        signal.throwIfAborted()
        if (action?.kind !== 'retry') {
          throw new LlmError(finish.failure.message, finish.failure.code, finish.failure)
        }
        continue
      }

      // 组装完整助手消息（含重放状态与用量），落盘为 assistant/message。
      const message = createAssistantMessage({
        content: assembler.blocks(),
        source: {
          provider: request.provider,
          model: request.model,
          ...assembler.replayState !== undefined ? { replayState: assembler.replayState } : {},
        },
      })
      this.session.append(
        'assistant/message',
        {
          turn,
          step,
          message,
          ...assembler.usage === undefined ? {} : { usage: assembler.usage },
        },
        { surfaceOp: 'append', sourceEventSeqs: chunkSeqs },
      )
      // 撞上输出上限：步骤以 max-tokens 收尾（粘性结论由 turn() 维护）。
      if (finish.kind === 'max-tokens') return { kind: 'max-tokens' }

      // 无工具调用：步骤正常完成。
      const toolCalls = message.content.filter(block => block.type === 'tool-call')
      if (toolCalls.length === 0) return { kind: 'completed' }
      // 有工具调用：交给调度器执行；工具返回的附加上下文经 acceptContext 塞回 next-step 收件箱供下步使用。
      const { concluded } = await executeToolCalls(
        this.loopCtx, turn, step, toolCalls, signal,
        context => this.inbox.splice('next-step', this.inbox.nextStep.length, 0, [context]),
      )
      // 某工具结果声明 concludesTurn：步骤完成；否则继续循环（再向模型发一轮）。
      return concluded ? { kind: 'completed' } : null
    }
  }

  /**
   * Compose one frozen request and bind it to the adapter registration that
   * resolved its exact-model defaults.
   */
  // 组装一次请求：解析路由与持久化默认值 → 走 agent/request 瀑布 → 绑定适配器 → 冻结并落盘请求头。
  private async buildRequest(
    turn: number,
    step: number,
    tools: GenerateOptions['tools'] & object,
    system: string,
    boundaryMessages: Message[],
    signal: AbortSignal,
  ): Promise<{ request: GenerateOptions; preparedCall?: PreparedLlmCall }> {
    const { session } = this

    // A loop instance starts from its declared route, restoring only an explicit
    // effort owned by that exact model. Later steps re-resolve marked defaults.
    // 路由恢复：从声明的 provider/model 起步；只有“恰好属于该模型”的显式 effort 才恢复，
    // 之后每一步都会重新解析被标记的适配器默认值（见 requestProposal）。
    const persistedHeader = session.requestHeader()
    const persistedConfig = persistedHeader?.config
    const route = { provider: this.options.provider ?? '', model: this.options.model ?? '' }
    const reasoningEffort = persistedConfig?.provider === route.provider
      && persistedConfig.model === route.model
      && persistedHeader?.adapterDefaults?.reasoningEffort !== true
      ? persistedConfig.reasoningEffort
      : undefined
    const maxTokens = this.options.maxTokens
    // 种子配置：首次请求用 route + 恢复的 effort/maxTokens；之后从上一个请求头派生（去掉适配器派生字段）。
    const seedConfig = deepFreeze(structuredClone(
      this.requestHeaderLogged
        // oxlint-disable-next-line typescript/no-non-null-assertion -- the instance logged the header it now folds
        ? requestProposal(persistedHeader!)
        : {
          ...route,
          ...reasoningEffort === undefined ? {} : { reasoningEffort },
          ...maxTokens === undefined ? {} : { maxTokens },
        },
    ))
    // agent/request 瀑布：监听器可替换最终请求配置（但不得改动消息等模型可见内容）。
    const proposedConfig = await this.dispatch.waterfall(
      'agent/request', { turn, step, signal },
      () => Promise.resolve(seedConfig),
    )
    signal.throwIfAborted()
    // 路由缺失是硬错误：必须由 AgentOptions 或 agent/request 瀑布给出 provider/model。
    if (!proposedConfig.provider || !proposedConfig.model) {
      throw new Error(`agent "${this.id}" has no provider/model: set AgentOptions.provider and AgentOptions.model or supply both via the agent/request waterfall`)
    }
    let config: LlmCallConfig
    let preparedCall: PreparedLlmCall | undefined
    try {
      // 绑定适配器：prepareCall 会解析出该模型的确切默认值并返回可复用的流。
      preparedCall = await this.loopCtx.llm.prepareCall(proposedConfig, signal)
      config = preparedCall.config
    } catch (error: unknown) {
      // Middleware may serve an unregistered route; terminal dispatch still requires an adapter.
      // 中间件可能服务未注册的路由：只有 NO_ADAPTER 才允许退回原配置继续，其余错误照抛。
      if (!(error instanceof LlmError) || error.code !== 'NO_ADAPTER') throw error
      config = proposedConfig
    }
    signal.throwIfAborted()

    // 请求头：把配置/适配器默认值/系统提示词/工具折叠成可比较的规范形态并落盘（request/header）。
    const header = canonicalHeader({
      config,
      ...preparedCall === undefined ? {} : { adapterDefaults: preparedCall.adapterDefaults },
      ...system ? { system } : {},
      ...tools.length > 0 ? { tools } : {},
    })
    const baseline = this.session.requestHeader()
    if (!this.requestHeaderLogged) {
      // 首次（或 resume 恢复后第一次）：写“initial/resume”锚点。
      this.session.append('request/header', { header, reason: baseline === undefined ? 'initial' : 'resume' })
      this.requestHeaderLogged = true
    } else if (baseline === undefined || !headerEquals(baseline, header)) {
      // 配置有变化：写“change”请求头（模型可见的配置变化必须可追溯）。
      this.session.append('request/header', { header, reason: 'change' })
    }

    // 请求上下文（provider/model/上下文窗口）：有变化才落盘 request/context。
    const contextWindow = preparedCall?.context?.contextWindow
    const requestContext: RequestContext = {
      provider: config.provider,
      model: config.model,
      ...contextWindow === undefined ? {} : { contextWindow },
    }
    const previousContext = session.requestContext()
    if (previousContext?.provider !== requestContext.provider
      || previousContext.model !== requestContext.model
      || previousContext.contextWindow !== requestContext.contextWindow) {
      session.append('request/context', requestContext)
    }
    signal.throwIfAborted()

    // 冻结请求：打上 agent-loop 标记（供不变量检查识别），整体深度冻结，交给 llm 服务执行。
    const request = markAgentLoopRequest(deepFreeze({
      ...header.config,
      messages: boundaryMessages,
      ...header.system !== undefined ? { system: header.system } : {},
      ...header.tools !== undefined ? { tools: header.tools } : {},
      sessionId: this.session.id,
      signal,
    }))
    return { request, ...preparedCall === undefined ? {} : { preparedCall } }
  }
}
