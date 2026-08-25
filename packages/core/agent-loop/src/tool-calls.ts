/*
 * ================================ 文件注释 ================================
 * 【文件职责】调度一个 assistant 步骤中的工具调用：互斥（exclusive）调用形成屏障串行执行，并行调用用有上限的滚动池并发执行，并把结果按模型顺序回写会话日志。
 * 【技术维度】基于 dsh-tools 的 scheduler 三阶段（prepare/dispatch/finalize）；结果与上下文按模型顺序提交；中止时给未启动调用补写合成错误结果以保持重放有效。
 * 【产品维度】决定工具执行是“一个接一个”还是“多个同时跑”，以及中止/失败时日志如何收尾，直接影响用户体验与回放（replay）一致性。
 * 【逻辑维度】PlannedCall/Slot/GroupOutcome 类型 → executeToolCalls 入口（按模式分组）→ runGroup（滚动池 + 提交）
 * → appendToolCall/appendToolResult/appendSkippedToolCall 日志助手。
 * 【关键边界】并行上限读自 ctx.agentLoop.config（可配置）；调度器内部失败不伪造结果，但中止会补合成结果；提交必须按模型顺序推进，不允许乱序。
 * 【新手阅读建议】先读 executeToolCalls 看分组逻辑，再读 runGroup 的 fillPool/commitReady 两个核心循环；最后看中止路径 appendSkippedToolCall。
 * ==========================================================================
 */
/**
 * Schedules one assistant step's tool calls. Exclusive calls form barriers;
 * parallel calls use a bounded rolling pool and are reclassified before start.
 * Dispatch may overlap, while policy, results, and result context remain
 * model-ordered. Abort or an internal scheduler failure stops replenishment
 * and drains started calls.
 *
 * Abort records synthetic error results for skipped calls so replay stays
 * valid. A terminal scheduler failure preserves already-recorded `tool/call`
 * events without fabricating results.
 * @module dsh-agent-loop/tool-calls
 */

import type { Context } from '@deepseek-ai/cordis'
import { assertNever, createToolResultMessage, type ToolCallBlock } from '@deepseek-ai/dsh-llm'
import type { Session, UserMessage } from '@deepseek-ai/dsh-session'
import { TOOL_ABORTED_BEFORE_DISPATCH, TOOL_RUNTIME_SCHEDULER, type ToolExecutionInput, type ToolExecutionMode, type ToolExecutionResult, type ToolRunContext } from '@deepseek-ai/dsh-tools'

/** One tool call after argument parsing, ready to schedule. */
// 一条“已解析好参数、待调度”的工具调用：block 是模型输出的原始调用块，exec 是执行器需要的输入。
interface PlannedCall {
  block: ToolCallBlock
  exec: ToolExecutionInput
}

/** Settled dispatch awaiting model-order finalization. */
// 一个已完成的调度槽位：dispatch 已返回结果，等待按模型顺序执行 finalize/finish 并提交日志。
interface Slot {
  exec: ToolRunContext
  result: ToolExecutionResult
  needsPost: boolean
}

/** One scheduler group outcome, including a drained cancellation. */
// 一个调度组（一批连续并行调用或一个互斥屏障）的结局：消费了多少、是否中止、是否有调用声明“结束本轮”。
interface GroupOutcome {
  consumed: number
  aborted: boolean
  /** Whether any committed result carried {@link ToolExecutionResult.concludesTurn}. */
  // 是否有已提交的结果携带 concludesTurn（某个工具结果要求本轮就此收尾）。
  concluded: boolean
}

/**
 * Schedule one assistant step's tool calls by their live concurrency mode.
 * Ordinary completion and abort commit started-call results in order. Abort
 * drains them, records synthetic results for unstarted calls, and returns with
 * the signal still aborted after accepting started-call context through the
 * caller-supplied acceptor (the machine stages it in its next-step inbox for the
 * step boundary). An internal scheduler failure stops new dispatches, drains
 * already-started dispatches, and rejects with the first failure without
 * fabricating tool results.
 * The committed step's AgentLoop driver boundary supplies the initiating Agent
 * that becomes each explicit {@link ToolExecutionInput.agent}.
 *
 * @param ctx - loop context that owns the tool registry and carries the initiating Agent.
 * @param turn - current turn number.
 * @param step - current step number.
 * @param toolCalls - assistant calls in model order.
 * @param signal - abort signal shared by the step.
 * @param acceptContext - accepts committed result context for the next step boundary.
 */
// 入口：把一批工具调用按“当前模式”分组逐个执行。mode 取第一个未调度调用的实时执行模式，
// parallel 组整段并行、exclusive 单条串行；组与组之间天然形成屏障。
export async function executeToolCalls(
  ctx: Context,
  turn: number,
  step: number,
  toolCalls: ToolCallBlock[],
  signal: AbortSignal,
  acceptContext: (context: UserMessage) => void,
): Promise<{ concluded: boolean }> {
  // 发起者 agent：当前步骤的驱动边界负责提供它；执行器包装可能替换 exec.signal，故输入与调用块分开存放。
  const agent = ctx.agents.requireInitiator()
  const { session } = agent

  // Inputs are distinct because tools/execute wrappers may replace `exec.signal`.
  // 预解析参数并组装每个调用的执行输入（保持模型给出的原始顺序）。
  const planned: PlannedCall[] = toolCalls.map(block => ({
    block,
    exec: {
      callId: block.id,
      name: block.name,
      arguments: parseArguments(block.arguments),
      agent,
      signal,
    },
  }))

  let next = 0
  let concluded = false
  while (next < planned.length) {
    // Commit before classifying again so registry changes affect unstarted calls.
    // 每次分组前先提交上一组，再取当前调用的实时模式——注册表的变化只影响尚未开始的调用。
    // oxlint-disable-next-line typescript/no-non-null-assertion -- bounded by the loop condition
    const first = planned[next]!
    const mode = ctx.tools.executionMode(first.exec).kind
    const group = mode === 'parallel' ? planned.slice(next) : [first]
    const outcome = await runGroup(
      ctx, turn, step, group, mode, signal, acceptContext,
    )
    next += outcome.consumed
    concluded ||= outcome.concluded
    if (outcome.aborted) {
      // 中止：剩余未调度的调用补写合成错误结果，保证回放（replay）日志完整。
      for (const call of planned.slice(next)) appendSkippedToolCall(session, turn, step, call.block)
      return { concluded }
    }
  }
  return { concluded }
}

/** Parse model arguments, preserving invalid JSON as text and mapping empty input to `{}`. */
// 解析模型给的参数：空串当空对象；JSON 非法时原样保留文本，让工具自己决定怎么处理。
function parseArguments(raw: string): unknown {
  try {
    return raw ? JSON.parse(raw) : {}
  } catch {
    return raw
  }
}

/**
 * Run one exclusive barrier or parallel pool. Later calls are reclassified
 * before start; an exclusive reclassification waits for the current pool to
 * drain and remains for the caller's next barrier. Results and contexts commit
 * in model order. Abort stops starts, drains and commits started calls, accepts
 * their contexts into the owning batch, records results for skipped calls, and
 * returns an aborted outcome. Scheduler failure drains dispatches without
 * committing synthetic recovery results.
 */
// 运行一个组：并行组用有上限的滚动池（fillPool）启动新调用，互斥组单条执行；
// 结果经 commitReady 按模型顺序提交；中止/失败都有明确的收尾路径。
async function runGroup(
  ctx: Context,
  turn: number,
  step: number,
  group: PlannedCall[],
  mode: ToolExecutionMode['kind'],
  signal: AbortSignal,
  acceptContext: (context: UserMessage) => void,
): Promise<GroupOutcome> {
  const { session } = ctx.agents.requireInitiator()
  // 并行上限：从 agentLoop 配置实时读取（每个组开始时解构一次，配置变更影响下一组）。
  const { maxParallelToolCalls } = ctx.agentLoop.config
  // slots：按模型顺序存放已完成的槽位（保持下标对应，commit 时才能按序推进）。
  const slots: (Slot | undefined)[] = group.map(() => undefined)
  // Started slots retain their `tool/call` seq so the result can cite it.
  // callSeqs：每个调用对应的 tool/call 事件序号，提交结果时引用它建立关联。
  const callSeqs: number[] = group.map(() => -1)
  let nextToStart = 0
  // committed：已按模型顺序提交的调用数（只能越过连续已完成的槽位前进）。
  let committed = 0
  let started = 0
  let aborted: boolean = signal.aborted
  let concluded = false
  // schedulerFailure：调度器（dispatch）内部失败；存在即停止启动新调用并在收尾时抛出首个错误。
  let schedulerFailure: { error: unknown } | undefined
  const throwSchedulerFailure = (): void => {
    if (schedulerFailure !== undefined) throw schedulerFailure.error
  }

  // `committed` advances only across contiguous model-order slots.
  // 按模型顺序提交：只有前一个槽位就绪才能推进 committed；每个结果 finalize/finish 后写日志并转发附加上下文。
  const commitReady = async (): Promise<void> => {
    while (committed < group.length) {
      const slot = slots[committed]
      if (slot === undefined) break
      const call = group[committed]
      const result = slot.needsPost
        ? await ctx.tools[TOOL_RUNTIME_SCHEDULER].finalize(slot.exec, slot.result)
        : ctx.tools[TOOL_RUNTIME_SCHEDULER].finish(slot.exec, slot.result)
      // oxlint-disable-next-line typescript/no-non-null-assertion -- bounded index
      appendToolResult(session, turn, step, call!.block, result, callSeqs[committed]!)
      for (const context of result.additionalContexts ?? []) acceptContext(context)
      concluded ||= result.concludesTurn === true
      committed++
    }
  }

  // inFlight：正在执行的 dispatch 承诺表（index → promise）；Promise.race 取最先完成的槽位。
  const inFlight = new Map<number, Promise<number>>()

  // startCall：启动一个调用——先写 tool/call 事件拿到 seq，再走 scheduler 的 prepare 三态分发。
  const startCall = async (index: number): Promise<void> => {
    // oxlint-disable-next-line typescript/no-non-null-assertion -- bounded index
    const call = group[index]!
    callSeqs[index] = appendToolCall(session, turn, step, call.block)
    started++
    const prepared = await ctx.tools[TOOL_RUNTIME_SCHEDULER].prepare(call.exec)
    throwSchedulerFailure()
    switch (prepared.kind) {
      case 'dispatch': {
        // dispatch：真正的异步执行；结果到达后写入槽位，失败则记录为调度器失败。
        const promise = ctx.tools[TOOL_RUNTIME_SCHEDULER].dispatch(prepared.exec).then(
          (outcome) => {
            slots[index] = { exec: prepared.exec, result: outcome.result, needsPost: outcome.kind === 'post-result' }
            return index
          },
          (error: unknown) => {
            schedulerFailure ??= { error }
            return index
          },
        )
        inFlight.set(index, promise)
        break
      }
      case 'post-result':
        // prepare 已同步给出结果但需要 finalize：直接占槽，等待按序提交。
        slots[index] = { exec: prepared.exec, result: prepared.result, needsPost: true }
        break
      case 'final-result':
        // prepare 已给出最终结果：直接占槽，无需再 finalize。
        slots[index] = { exec: prepared.exec, result: prepared.result, needsPost: false }
        break
      /* v8 ignore next -- closed-union exhaustiveness guard */
      default:
        assertNever(prepared, 'tool-call scheduler prepare result')
    }
  }

  // fillPool：在不超过并行上限的前提下持续启动；并行组里若遇到被重新归类为 exclusive 的调用则停手，
  // 留到调用方下一轮屏障处理；每次启动后立即尝试按序提交。
  const fillPool = async (): Promise<void> => {
    while (!aborted && nextToStart < group.length && inFlight.size < maxParallelToolCalls) {
      // Re-read later modes after ordered commits so registry changes can create a barrier.
      // oxlint-disable-next-line typescript/no-non-null-assertion -- bounded by the loop condition
      const nextCall = group[nextToStart]!
      if (nextToStart > 0 && mode === 'parallel'
        && ctx.tools.executionMode(nextCall.exec).kind !== 'parallel') break
      await startCall(nextToStart)
      nextToStart++
      throwSchedulerFailure()
      await commitReady()
      throwSchedulerFailure()
      // Abort may arrive while pre-execute awaits.
      // 预执行（prepare）期间的 await 可能迎来中止信号，此刻捕获它。
      if (signal.aborted) aborted = true
    }
  }

  // Ordered pre-execute may await; only dispatch/body overlaps. A scheduler
  // failure stops new dispatches and reaches the turn boundary after every
  // already-started dispatch settles.
  // 主循环：先填满池，再在 inFlight 中等待最先完成者并提交，周而复始。
  try {
    await fillPool()
    while (inFlight.size > 0) {
      const settledIndex = await Promise.race(inFlight.values())
      inFlight.delete(settledIndex)
      throwSchedulerFailure()
      await commitReady()
      throwSchedulerFailure()
      // Abort may arrive while a tool or ordered commit awaits.
      // 工具执行或顺序提交的 await 期间也可能中止，同样在此捕获。

      if (signal.aborted) aborted = true
      await fillPool()
    }
  } catch (error: unknown) {
    // 调度器失败：等所有已开始的 dispatch 落定，然后抛出首个错误（不伪造任何工具结果）。
    schedulerFailure ??= { error }
    await Promise.allSettled(inFlight.values())
    throw schedulerFailure.error
  }

  if (aborted) {
    // Started calls and accepted context settle first; every remaining model
    // call then receives an ordered synthetic result before the turn aborts.
    // 中止收尾：先让已开始调用及上下文落定，再给剩余每个模型调用补一条有序的合成错误结果。
    for (const call of group.slice(started)) appendSkippedToolCall(session, turn, step, call.block)
    return { consumed: group.length, aborted: true, concluded }
  }
  /* v8 ignore next -- unreachable: a non-aborted group commits every started call */
  if (committed !== started) throw new Error('tool-call scheduler: uncommitted settled calls')
  return { consumed: started, aborted: false, concluded }
}

/** Append the durable call/result pair for a model call skipped after cancellation. */
// 给“取消后未启动”的调用补写一对 call/result 日志：结果固定为“dispatch 前已中止”的合成错误。
function appendSkippedToolCall(session: Session, turn: number, step: number, block: ToolCallBlock): void {
  const callSeq = appendToolCall(session, turn, step, block)
  appendToolResult(session, turn, step, block, {
    content: [{ type: 'text', text: 'Error: tool call aborted before dispatch' }],
    isError: true,
    error: {
      message: 'tool call aborted before dispatch',
      info: { name: 'AbortError', code: TOOL_ABORTED_BEFORE_DISPATCH },
    },
  }, callSeq)
}

/** Append a started call and return the event seq that its result must cite. */
// 写入一条 tool/call 事件并返回其序号：结果是按模型顺序提交的，必须引用这个 seq 建立 call→result 关联。
function appendToolCall(session: Session, turn: number, step: number, block: ToolCallBlock): number {
  const event = session.append('tool/call', { turn, step, callId: block.id, name: block.name, arguments: block.arguments })
  return event.seq
}

/** Append a model-ordered result linked to its call event. */
// 写入一条 tool/result 事件：把工具结果转成用户消息形态并关联到其 tool/call 的 seq。
function appendToolResult(
  session: Session,
  turn: number,
  step: number,
  block: ToolCallBlock,
  result: ToolExecutionResult,
  callSeq: number,
): void {
  const message = createToolResultMessage({
    callId: block.id,
    content: result.content,
    isError: result.isError,
  })
  session.append('tool/result', {
    turn, step,
    message,
    ...result.error?.info ? { error: result.error.info } : {},
    // The tool's private presentation payload (e.g. a result-time diff),
    // persisted so a UI bridge reproduces the card on replay.
    // meta 是工具私有的呈现载荷（如结果时刻的 diff），持久化后 UI 桥可在回放时原样重绘卡片。
    ...result.meta !== undefined ? { meta: result.meta } : {},
  }, { surfaceOp: 'append', sourceEventSeqs: [callSeq] })
}
