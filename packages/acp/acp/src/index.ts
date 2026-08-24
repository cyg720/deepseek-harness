/**
 * Automation-only Agent Client Protocol server over JSON-RPC stdio.
 *
 * The bridge exposes fresh harness sessions to trusted programmatic clients. It
 * carries prompt text/images, committed assistant text/images, cancellation,
 * and one-shot permission decisions; presentation and human-interaction
 * features stay with the harness's UI modules.
 *
 * @module @deepseek-ai/dsh-acp
 */
/**
 * 文件职责：把 Harness 代理会话通过标准输入输出上的 ACP JSON-RPC 暴露给可信自动化客户端。
 * 技术维度：使用 Cordis 插件生命周期、Agent Client Protocol SDK、异步结算门和会话事件流桥接代理运行时。
 * 产品维度：支持自动化工具创建独立会话、发送文本或图片、接收已提交输出、取消任务并回答一次性权限请求。
 * 逻辑维度：挂载连接与事件监听，维护每会话状态，实现 ACP 方法，关联提示与轮次，最后按顺序排空并释放资源。
 * 关键边界：仅支持单一绝对工作区且不接收 MCP 配置；每会话同时只有一个提示；桥接层只发送已提交内容。
 * 新手阅读建议：先看 SessionRecord 状态字段，再看 makeAgent 的协议方法，随后理解事件关联，最后阅读 quiesce 清理顺序。
 */

import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { Readable, Writable } from 'node:stream'
import Schema from '@deepseek-ai/schemastery'
import { createUserMessage, errorChain } from '@deepseek-ai/dsh-llm'
import {
  AgentSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  RequestError,
  type Agent as AcpAgent,
  type AuthenticateRequest,
  type CancelNotification,
  type InitializeRequest,
  type InitializeResponse,
  type NewSessionRequest,
  type NewSessionResponse,
  type PromptRequest,
  type PromptResponse,
  type SessionNotification,
  type StopReason,
  type Stream,
} from '@agentclientprotocol/sdk'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId, type SessionEvent, type TurnEndReason } from '@deepseek-ai/dsh-session'
// Side-effect type import: declaration-merges the approval waterfall answered below.
import type {} from '@deepseek-ai/dsh-user-approval'
import { AcpContentError, admitAcpPrompt, assistantBlockToAcp, supportsAcpImagePrompts } from './content.ts'
import { turnEndToStopReason } from './codec.ts'

// Cordis 插件注册名称。
export const name = 'acp'
/** The bridge creates and owns agents; every other concern is carried by the agent composition. */
/** 桥接层只强制依赖代理工厂，其余能力由创建出的代理组合提供。 */
export const inject = ['agents']

/**
 * The single continuable-subagent teardown the bridge needs. Declared
 * structurally so this package does not depend on the subagent seam for one
 * shutdown hook; an absent service means nothing continuable was materialized.
 */
interface ContinuableDrain {
  /**
   * Close admission below exact host-owned parents, then dispose only their
   * continuable descendants child-first.
   */
  /**
   * 关闭指定父代理下的新准入，并按子节点优先顺序释放可继续子代理。
   * @param parents ACP 桥接层精确拥有的顶层代理。
   * @returns 所有相关后代释放完成后的 Promise。
   * @example await drain.drainContinuableDescendants(records.map(record => record.agent))
   */
  drainContinuableDescendants(parents: readonly Agent[]): Promise<void>
}

/** Preserve invalid-parameter detail in the SDK wire error message. */
/**
 * 构造保留安全详情的 ACP 参数错误。
 * @param detail 可返回客户端的参数问题说明。
 * @returns SDK 的 invalid params 错误对象。
 * @example invalidParams('unknown session')
 */
function invalidParams(detail: string): RequestError {
  return RequestError.invalidParams(undefined, detail)
}

/** Preserve failed-turn detail; plain handler errors become a generic wire internal error. */
/**
 * 构造保留安全详情的 ACP 内部错误。
 * @param detail 不含敏感数据的失败说明。
 * @returns SDK 的 internal error 对象。
 * @example internalError('turn failed')
 */
function internalError(detail: string): RequestError {
  return RequestError.internalError(undefined, detail)
}

/** Plugin config: the provider/model selection used for each ACP-created agent. */
/** ACP 插件配置，决定新建代理使用的模型路由和可选测试传输层。 */
export interface AcpConfig {
  /** Provider route for created agents. */
  /** 新建代理使用的提供方路由；省略时交给代理默认配置。 */
  provider?: string
  /** Model name for created agents. */
  /** 新建代理使用的精确模型名称；省略时交给代理默认配置。 */
  model?: string
  /** Runtime-only transport override; production uses stdio. */
  /** 仅运行时使用的传输覆盖，生产环境默认使用标准输入输出。 */
  stream?: Stream
}

// Cordis 对可持久配置字段的运行时校验模式；stream 不属于部署配置。
export const Config: Schema<AcpConfig> = Schema.object({
  provider: Schema.string(),
  model: Schema.string(),
})

/** Per-session protocol state. */
/** 单个 ACP 会话的代理所有权、输出顺序和当前提示生命周期状态。 */
interface SessionRecord {
  /** 由桥接层创建并精确拥有的 Harness 代理。 */
  agent: Agent
  /** Exact owned-agent disposer; resolves after registry, loop, and session teardown. */
  /** 精确代理释放器，在注册表、循环和会话清理完成后解决。 */
  dispose: () => Promise<void>
  /** Ordered assistant-output delivery; every task contains its own failure. */
  /** 串行的助手输出交付链，每个任务自行容纳失败。 */
  outputTail: Promise<void>
  /** In-flight admission/turn/output lifecycle for exact settlement. */
  /** 当前唯一提示的准入、轮次、输出和取消状态；空值表示可接收新提示。 */
  inflight: {
    /** 以 ACP 停止原因成功完成提示请求。 */
    resolve: (reason: StopReason) => void
    /** 以协议错误拒绝提示请求。 */
    reject: (error: Error) => void
    /** Set only after rich-content admission succeeds and the message is built. */
    /** 富内容准入成功并创建用户消息后才设置的消息标识。 */
    messageId: string | undefined
    /** Whether this prompt has entered the Agent's durable inbox interval. */
    /** 提示是否已经进入代理的持久收件箱区间。 */
    messageQueued: boolean
    /** 收件箱认领后关联到的轮次编号。 */
    turn: number | undefined
    /** The correlated turn's ending, set at turn/end and settled at whole-agent idle. */
    /** 关联轮次的结束原因，在整个代理空闲后才用于结算。 */
    endReason: TurnEndReason | undefined
    /** Admission quiescence gate, including any attachment write already in progress. */
    /** 包含进行中附件写入的准入静止门。 */
    admissionDone: Promise<void>
    /** 标记准入阶段已经结束的解决函数。 */
    finishAdmission: () => void
    /** 用于在取消或释放时中止富内容准入的控制器。 */
    admissionController: AbortController
    /** 客户端或桥接释放是否已经请求取消。 */
    cancelRequested: boolean
    /** 是否已经启动唯一的异步结算任务。 */
    settlementStarted: boolean
    /** Conversion failure for committed output owned by this prompt's turn. */
    /** 当前提示轮次的已提交输出转换失败。 */
    outputError: Error | undefined
    /** Interval-wide failure outside the correlated turn. */
    /** 关联轮次之外、但发生在本提示活动区间内的代理失败。 */
    agentError: Error | undefined
  } | undefined
}

/**
 * Mount the automation-only ACP server.
 * @param ctx - Cordis context carrying the agent factory and session events.
 * @param config - Initial provider/model selection and optional test transport.
 */
/**
 * 挂载自动化专用 ACP 服务及其会话生命周期监听。
 * @param ctx 提供代理工厂、日志、事件和可选能力服务的 Cordis 上下文。
 * @param config 初始模型路由及可选测试传输配置。
 * @returns 无返回值；连接和清理由 Cordis effect 生命周期管理。
 * @example apply(ctx, { provider: 'deepseek', model: 'deepseek-chat' })
 */
export function apply(ctx: Context, config: AcpConfig): void {
  // ACP handlers execute outside this plugin's injection scope, so capture the
  // injected service during apply rather than reading it lazily in a callback.
  // 当前插件作用域内捕获的代理工厂，供协议回调安全使用。
  const agents = ctx.agents
  // 记录传输、转换和清理失败的插件日志器。
  const logger = ctx.logger
  // 会话标识到桥接层精确拥有状态的映射。
  const sessions = new Map<SessionId, SessionRecord>()
  // 连接是否已经进入关闭阶段，关闭后拒绝新会话和提示。
  let closed = false
  // SDK 代理侧连接；makeAgent 初始化时赋值，事件处理器通过它发送通知。
  let conn: AgentSideConnection
  // 初始化时计算并向客户端公布的图片提示能力。
  let imagePromptEnabled = false

  /** Return the bridge-owned record for an agent, rejecting same-id impostors. */
  /** 根据代理对象身份返回精确拥有记录，同标识的其他对象不会被接受。 */
  const ownedRecord = (agent: Agent): SessionRecord | undefined => {
    // 使用会话标识初步查找的候选记录。
    const record = sessions.get(agent.session.id)
    return record?.agent === agent ? record : undefined
  }

  /** 确认桥接仍可接收新操作，否则抛出协议内部错误。 */
  const assertOpen = (): void => {
    if (closed) throw internalError('the ACP bridge has been disposed')
  }

  /** 根据会话标识取得必需记录，未知会话转换为参数错误。 */
  const requireSession = (sessionId: SessionId): SessionRecord => {
    // 会话映射中的目标记录。
    const record = sessions.get(sessionId)
    if (record === undefined) throw invalidParams(`unknown session: ${sessionId}`)
    return record
  }

  /** Send one ordered protocol update while containing transport-only failure. */
  /** 发送一个有序协议更新，并把仅传输层失败限制为日志警告。 */
  const notify = async (notification: SessionNotification): Promise<void> => {
    try {
      await conn.sessionUpdate(notification)
    /* v8 ignore start -- the ACP SDK contains notification-handler failures; only a transport write failure reaches this guard. */
    } catch (error: unknown) {
      logger.warn(`acp: session/update failed: ${String(error)}`)
    }
    /* v8 ignore stop */
  }

  /** 把核心错误轮次原因转换为 ACP 内部错误并拒绝当前提示。 */
  const rejectFromError = (
    inflight: NonNullable<SessionRecord['inflight']>,
    reason: Extract<TurnEndReason, { kind: 'error' }>,
  ): void => {
    inflight.reject(internalError(`turn failed: ${reason.error.message}`))
  }

  /**
   * Settle one exact prompt only after admission, agent activity, and ordered
   * assistant delivery have all reached quiescence.
   */
  /** 在准入、代理活动和有序输出全部静止后结算精确提示。 */
  const settleAfterQuiescence = (
    record: SessionRecord,
    inflight: NonNullable<SessionRecord['inflight']>,
  ): void => {
    if (inflight.settlementStarted) return
    inflight.settlementStarted = true
    void (async () => {
      await inflight.admissionDone
      if (inflight.messageQueued) {
        await record.agent.whenIdle()
        // session/event enqueues synchronously before the agent becomes idle;
        // reading the live tail here includes every committed output task.
        await record.outputTail
      }
      /* v8 ignore next -- this prompt owns the slot until this exact settlement clears it. */
      if (record.inflight !== inflight) return
      record.inflight = undefined
      if (inflight.cancelRequested) {
        inflight.resolve('cancelled')
        return
      }
      if (inflight.outputError !== undefined) {
        inflight.reject(internalError(`assistant output delivery failed: ${inflight.outputError.message}`))
        return
      }
      if (inflight.agentError !== undefined) {
        inflight.reject(internalError(`turn failed: ${inflight.agentError.message}`))
        return
      }
      // 已关联轮次的最终结束原因；缺失通常表示取消发生在轮次建立前。
      const end = inflight.endReason
      if (end === undefined) {
        inflight.resolve('cancelled')
      } else if (end.kind === 'error') {
        rejectFromError(inflight, end)
      } else {
        // Token-limit and other non-terminal endings are not prompt-level stop
        // reasons; ordinary quiescence reports end_turn.
        inflight.resolve(end.kind === 'max-tokens' ? 'end_turn' : turnEndToStopReason(end))
      }
    })()
    /* v8 ignore start -- admissionDone only resolves, and the queued path's idle/output gates contain their own failures. */
      .catch((error: unknown) => {
        if (record.inflight !== inflight) return
        record.inflight = undefined
        inflight.reject(internalError(`prompt settlement failed: ${errorChain(error)}`))
      })
    /* v8 ignore stop */
  }

  // Emit only committed assistant text/images. Raw chunks, reasoning, tools,
  // plans, titles, and retry markers are presentation or trace data and stay
  // off the automation wire. One per-session chain preserves block/message
  // order across asynchronous attachment reads.
  // 只投影已提交助手内容，并通过每会话 Promise 链保持异步图片读取后的顺序。
  ctx.on('session/event', (session, event: SessionEvent) => {
    // 与事件会话标识对应的桥接记录。
    const record = sessions.get(session.header.id)
    if (record === undefined || record.agent.session !== session) return
    try {
      if (event.type === 'assistant/message') {
        // 只有轮次匹配时，输出转换失败才归属于当前提示。
        const inflight = record.inflight?.turn === event.data.turn ? record.inflight : undefined
        // 当前输出任务开始前必须等待的前一任务。
        const previous = record.outputTail
        // 依次转换并发送本条助手消息内容块的交付任务。
        const delivery = previous.then(async () => {
          for (const block of event.data.message.content) {
            // 可发送到 ACP 的内容；推理或空文本等块返回 undefined。
            const content = await assistantBlockToAcp(ctx, block)
            if (content === undefined) continue
            await notify({
              sessionId: record.agent.session.id,
              update: { sessionUpdate: 'agent_message_chunk', content },
            })
          }
        })
        record.outputTail = delivery.catch((error: unknown) => {
          // assistantBlockToAcp owns conversion failures and always throws Error.
          // 转换函数保证抛出 Error，因此这里可安全保存到会话状态。
          const failure = error as Error
          if (inflight !== undefined) inflight.outputError ??= failure
          logger.warn(`acp: assistant output conversion failed: ${errorChain(error)}`)
        })
      }
    } finally {
      // 事件处理完成时再次读取当前提示，避免使用已经替换的旧引用。
      const inflight = record.inflight
      if (inflight !== undefined && event.type === 'turn/end' && inflight.turn === event.data.turn) {
        inflight.endReason = event.data.reason
      }
    }
  })

  ctx.on('agent/inbox/claimed', ({ agent, message, turn }) => {
    // 仅接受由桥接层精确拥有的代理记录。
    const record = ownedRecord(agent)
    // 该代理当前可能正在准入或运行的提示状态。
    const inflight = record?.inflight
    if (inflight !== undefined && inflight.messageId === message.id) inflight.turn = turn
  })

  ctx.on('agent/error', ({ agent, turn, error }) => {
    // 发生错误的代理对应的精确会话记录。
    const record = ownedRecord(agent)
    // 该会话当前唯一提示的生命周期状态。
    const inflight = record?.inflight
    if (record === undefined || inflight === undefined || !inflight.messageQueued || inflight.turn === turn) return
    inflight.agentError = new Error(errorChain(error))
    settleAfterQuiescence(record, inflight)
  })

  // Permission requests are a machine policy channel for ACP clients such as
  // dsh-subagent-acp. The bridge offers one-shot choices only and never infers a
  // durable grant from an unknown client response.
  // ACP 权限通道只提供本次允许或本次拒绝，不把未知客户端回复推断为持久授权。
  ctx.on('approval/request', (request, next) => {
    // 只有桥接层拥有的代理才能把权限请求发往此 ACP 连接。
    const record = ownedRecord(request.agent)
    if (record === undefined || request.callId === undefined) return next()
    return conn.requestPermission({
      sessionId: record.agent.session.id,
      toolCall: { toolCallId: request.callId },
      options: [
        { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
      ],
    }).then(({ outcome }) => {
      if (outcome.outcome === 'cancelled') return 'cancelled'
      return outcome.optionId === 'allow-once' ? 'allowed-once' : 'rejected'
    })
  })

  /**
   * 创建实现 ACP 方法的代理端处理对象。
   * @param connection SDK 建立的代理侧连接。
   * @returns 处理初始化、鉴权、会话、提示和取消的方法集合。
   * @example new AgentSideConnection(makeAgent, stream)
   */
  const makeAgent = (connection: AgentSideConnection): AcpAgent => {
    conn = connection
    return {
      async initialize(_params: InitializeRequest): Promise<InitializeResponse> {
        // Single-version agent: the spec's "same version if supported, else
        // the latest supported" both resolve to this server's one version.
        // 按部署服务和精确模型能力计算能否如实声明内联图片支持。
        imagePromptEnabled = await supportsAcpImagePrompts(ctx, config.provider, config.model)
        return {
          protocolVersion: PROTOCOL_VERSION,
          agentInfo: { name: 'deepseek-harness-acp', version: '0.0.1' },
          agentCapabilities: {
            promptCapabilities: { image: imagePromptEnabled, audio: false, embeddedContext: false },
          },
          authMethods: [],
        }
      },

      authenticate(_params: AuthenticateRequest): Promise<void> {
        // 当前 ACP 传输面向可信自动化客户端，不额外执行认证握手。
        return Promise.resolve()
      },

      async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
        assertOpen()
        validateSessionParams(params)
        // 为新代理生成的不可猜测持久会话标识。
        const sessionId = SessionId(randomUUID())
        // No preset composition: the ACP bundle keeps the model-facing rows in
        // the host plane, so this agent reads them from the global layer. A
        // deployment that configures a roster has to join one here first
        // (@deepseek-ai/dsh-agent-presets README, "Composing a child agent").
        // 代理工厂返回的精确所有权句柄，包含实例和异步释放器。
        const handle = await agents.create({
          sessionId,
          meta: { cwd: params.cwd },
          agentOptions: agentOptions(config),
        })
        /* v8 ignore next 4 -- a real stdio close can race an in-flight create. */
        if (closed) {
          await handle.dispose()
          throw internalError('connection closed during session/new')
        }
        sessions.set(sessionId, {
          agent: handle.agent,
          dispose: () => handle.dispose(),
          outputTail: Promise.resolve(),
          inflight: undefined,
        })
        return { sessionId }
      },

      async prompt(params: PromptRequest): Promise<PromptResponse> {
        assertOpen()
        // 提示目标的桥接会话记录。
        const record = requireSession(SessionId(params.sessionId))
        if (record.inflight !== undefined) {
          throw invalidParams('a prompt is already in flight for this session')
        }
        // 最终协议停止原因的外部可解 Promise。
        const completion = Promise.withResolvers<StopReason>()
        // 富内容准入结束门，取消和关闭会等待它解决。
        const admission = Promise.withResolvers<void>()
        // 当前提示准入阶段的专用取消控制器。
        const admissionController = new AbortController()
        // 预先占用单提示槽位的完整生命周期记录。
        const inflight: NonNullable<SessionRecord['inflight']> = {
          resolve: completion.resolve,
          reject: completion.reject,
          messageId: undefined,
          messageQueued: false,
          turn: undefined,
          endReason: undefined,
          admissionDone: admission.promise,
          finishAdmission: admission.resolve,
          admissionController,
          cancelRequested: false,
          settlementStarted: false,
          outputError: undefined,
          agentError: undefined,
        }
        // Reserve the one-prompt slot before the first asynchronous route or
        // attachment operation so concurrent prompts and cancellation observe
        // admission as genuinely in flight.
        record.inflight = inflight

        // 准入或同步入队是否失败的标志。
        let admissionFailed = false
        // 准入失败的原始值，稍后按内容错误、请求错误或普通 Error 映射。
        let admissionFailure: unknown
        try {
          // Do not persist rich content for a retired destination. Re-check
          // after admission too because an agent-loop reload may race storage.
          if (ctx.agents.get(record.agent.id) !== record.agent) {
            throw internalError('prompt was not queued: the agent was disposed outside the bridge')
          }
          // 验证、持久化并按原顺序重建的核心用户内容。
          const content = await admitAcpPrompt(
            ctx,
            record.agent,
            params.prompt,
            imagePromptEnabled,
            admissionController.signal,
          )
          // No await may separate this final abort check from followup: a
          // cancellation that wins admission must never enqueue a late turn.
          admissionController.signal.throwIfAborted()
          if (ctx.agents.get(record.agent.id) !== record.agent) {
            throw internalError('prompt was not queued: the agent was disposed outside the bridge')
          }
          // 准备进入代理持久收件箱的核心用户消息。
          const message = createUserMessage({ content, source: { kind: 'user' } })
          inflight.messageId = message.id
          inflight.messageQueued = true
          try {
            record.agent.followup(message)
          } catch (error: unknown) {
            // The typed same-process seam may fail synchronously before durable
            // inbox receipt; restore the pre-operation boundary for mapping.
            inflight.messageQueued = false
            throw error
          }
        } catch (error: unknown) {
          admissionFailed = true
          admissionFailure = error
        } finally {
          inflight.finishAdmission()
        }

        if (inflight.cancelRequested) {
          settleAfterQuiescence(record, inflight)
          return { stopReason: await completion.promise }
        }
        if (admissionFailed) {
          record.inflight = undefined
          if (admissionFailure instanceof AcpContentError) {
            throw admissionFailure.kind === 'invalid'
              ? invalidParams(admissionFailure.message)
              : internalError(admissionFailure.message)
          }
          if (admissionFailure instanceof RequestError) throw admissionFailure
          // The admission codec and same-process agent seam throw Error values.
          // 未被分类异常包装的同进程错误说明。
          const detail = (admissionFailure as Error).message
          throw internalError(`prompt was not queued: ${detail}`)
        }

        settleAfterQuiescence(record, inflight)
        // 整个提示生命周期最终映射出的 ACP 停止原因。
        const stopReason = await completion.promise
        return { stopReason }
      },

      cancel(params: CancelNotification): Promise<void> {
        // 未知会话按幂等取消处理，不向客户端报错。
        const record = sessions.get(SessionId(params.sessionId))
        if (record === undefined) return Promise.resolve()
        // 当前提示可能仍在准入、排队、运行或输出排空阶段。
        const inflight = record.inflight
        if (inflight !== undefined) {
          inflight.cancelRequested = true
          inflight.admissionController.abort(new Error('ACP prompt cancelled'))
          settleAfterQuiescence(record, inflight)
        }
        // Admission is not Agent work. Preserve unrelated producers until this
        // prompt has entered the durable inbox; without a prompt, cancellation
        // continues to target autonomous work on the addressed Agent.
        if (inflight === undefined || inflight.messageQueued) record.agent.cancel({ kind: 'user' })
        return Promise.resolve()
      },
    }
  }

  /* v8 ignore next 4 -- production stdio wiring; tests inject config.stream. */
  // 运行时使用的协议流；测试可注入内存流，生产默认连接 stdio。
  const stream: Stream = config.stream ?? ndJsonStream(
    Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,
    Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>,
  )
  conn = new AgentSideConnection(makeAgent, stream)

  // 首次清理创建的共享 Promise，使重复关闭调用保持幂等。
  let quiescing: Promise<void> | undefined
  /**
   * 停止准入、取消工作、排空输出并释放桥接层拥有的代理树。
   * @returns 同一次清理过程共享的 Promise。
   * @example await quiesce()
   */
  const quiesce = (): Promise<void> => {
    if (quiescing !== undefined) return quiescing
    closed = true
    // 关闭瞬间桥接层拥有的全部会话记录快照。
    const records = [...sessions.values()]
    sessions.clear()
    // Stop the bridge's own work before any await: a descendant drain can block
    // on persistence or scoped cleanup, and the top-level agents must not keep
    // running model and tool calls for its whole duration.
    for (const record of records) {
      // 当前记录尚未结算的提示状态。
      const inflight = record.inflight
      if (inflight !== undefined) {
        inflight.cancelRequested = true
        inflight.admissionController.abort(new Error('ACP bridge disposed'))
        settleAfterQuiescence(record, inflight)
      }
      record.agent.cancel({ kind: 'user' })
    }
    quiescing = (async () => {
      // Preserve the same prompt boundary during connection teardown: a rich
      // admission already writing must stop before its slot settles, and every
      // committed output conversion must drain while attachment services remain
      // available. session/event enqueues output synchronously before idle.
      await Promise.all(records.map(async (record) => {
        await record.inflight?.admissionDone
        await record.agent.whenIdle()
        await record.outputTail
      }))
      // Continuable subagents outlive the turn that started them, and their
      // Activations own descendant teardown. Drain only these sessions' forests
      // child-first BEFORE disposing the top-level agents, so no descendant is
      // left holding a runtime its owner already released and another frontend
      // sharing this Context remains live.
      // Read the one teardown method structurally: the bridge needs no other
      // part of the subagent seam, so it does not depend on that package.
      // 结构化读取的可选子代理清理服务。
      const subagents = ctx.get('subagents') as ContinuableDrain | undefined
      if (subagents !== undefined) {
        try {
          await subagents.drainContinuableDescendants(records.map(record => record.agent))
        } catch (error: unknown) {
          logger.warn(`acp: continuable subagent teardown failed: ${String(error)}`)
        }
      }
      // 所有顶层代理释放结果，全部结束后再汇总失败。
      const disposals = await Promise.allSettled(records.map(record => record.dispose()))
      // 从释放结果中收集的原始失败原因。
      const failures: unknown[] = []
      for (const result of disposals) {
        if (result.status === 'rejected') failures.push(result.reason as unknown)
      }
      if (failures.length > 0) {
        // The production consumer logs this AggregateError through `String`,
        // which renders only its message. Embed every per-session diagnostic,
        // including nested causes and aggregate members, in that message.
        // 合并每个失败的完整错误链，保证 String(AggregateError) 仍包含诊断。
        const detail = failures.map(failure => errorChain(failure)).join('; ')
        throw new AggregateError(
          failures,
          `ACP agent teardown failed for ${failures.length} session(s): ${detail}`,
        )
      }
    })()
    return quiescing
  }

  /* v8 ignore start -- production transport rejection and teardown failure. */
  void conn.closed
    .catch((error: unknown) => {
      logger.warn(`acp: connection closed with an error: ${String(error)}`)
    })
    .then(quiesce)
    .catch((error: unknown) => {
      logger.warn(`acp: connection-close teardown failed: ${String(error)}`)
    })
  /* v8 ignore stop */

  ctx.effect(() => quiesce, 'acp.connection')
}

/**
 * Build per-agent options from plugin config without assigning absent optional fields.
 * @param config - ACP provider/model configuration.
 * @returns the configured fields only.
 */
/**
 * 从插件配置构造代理选项，并避免写入值为 undefined 的可选字段。
 * @param config ACP 提供方和模型配置。
 * @returns 只包含实际配置字段的代理选项。
 * @example agentOptions({ provider: 'deepseek' })
 */
function agentOptions(config: AcpConfig): { provider?: string; model?: string } {
  return {
    ...config.provider !== undefined ? { provider: config.provider } : {},
    ...config.model !== undefined ? { model: config.model } : {},
  }
}

/** Reject session features outside the automation contract. */
/**
 * 拒绝自动化协议范围之外的会话特性。
 * @param params 客户端请求的新会话参数。
 * @returns 合法时无返回值；相对路径、额外目录或 MCP 服务会抛出参数错误。
 * @example validateSessionParams({ cwd: '/work', mcpServers: [] })
 */
function validateSessionParams(params: NewSessionRequest): void {
  if (!isAbsolute(params.cwd)) throw invalidParams(`cwd must be an absolute path: ${params.cwd}`)
  if (params.additionalDirectories !== undefined && params.additionalDirectories.length > 0) {
    throw invalidParams('additionalDirectories is not supported')
  }
  if (params.mcpServers.length > 0) throw invalidParams('mcpServers is not supported')
}
