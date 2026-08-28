/** Session commands whose activation policy is explicit at each Remote method.
 * @remarks 文件说明：文件职责：实现 api/session-controller 中 commands 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * api/session-controller 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, ModelSelection as AgentModelSelection } from '@deepseek-ai/dsh-agent'
import { PresetMountError, UnknownPresetError } from '@deepseek-ai/dsh-agent-presets'
import { AttachmentError, admitEncodedImages } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import {
  ReasoningEffortId, createUserMessage, freezeMessage,
} from '@deepseek-ai/dsh-llm'
import type { ContentBlock, MessageSource } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader, UserMessage } from '@deepseek-ai/dsh-session'
import { SessionQueryError, type SessionObservation } from '@deepseek-ai/dsh-session-query'
import { SessionTitleInvalidError } from '@deepseek-ai/dsh-session-title'
import { TypertRemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import {
  ApiSessionAgentController,
  ApiSessionCwdConflict,
  ApiSessionNotFound,
  ApiSessionPresetConflict,
  ApiSessionSubagentOwnership,
  apiSessionSubagentOwnershipError,
  hasApiSessionSubagentOwner,
  inspectApiSession,
} from './agent.ts'
import type {
  SessionAttachmentRequest,
  SessionAttachmentValue,
  SessionCancelRequest,
  SessionCancelValue,
  SessionCreateRequest,
  SessionCreateValue,
  SessionForkRequest,
  SessionForkValue,
  SessionPromptRequest,
  SessionPromptValue,
  SessionRenameRequest,
  SessionRenameValue,
  SessionSelectModelRequest,
  SessionSelectModelValue,
  SessionUpdateQueueRequest,
  SessionUpdateQueueValue,
} from './types.ts'

interface SessionReadState {
  readonly id: SessionId
  readonly header: SessionHeader
  readonly events: SessionEvent[]
}

/** Implements Session business commands delegated by the Session Controller Remote service.
 * @remarks 中文说明：类说明：SessionCommandController 用于集中封装 处理
 * SessionCommandController 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；
 * 使用场景：由 api/session-controller 在对应插件或业务生命周期内创建和调用。 */
export class SessionCommandController {
  /**
   * @param ctx - Host context carrying Agent, model, attachment, title, and Workspace services.
   * @param agents - sole owner of create, resume, and Session-local model selection.
   * @param defaultCwd - project directory used when create names neither a Workspace nor a cwd.
   * @remarks 中文说明：功能说明：处理 SessionCommandController 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；
   * 参数说明：agents（ApiSessionAgentController）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：defaultCwd（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：当前类实例；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：通过 new SessionCommandController(ctx,
   * agents, defaultCwd) 创建实例，并在所属生命周期内使用。
   */
  constructor(
    private readonly ctx: Context,
    private readonly agents: ApiSessionAgentController,
    private readonly defaultCwd: string,
  ) {}

  /**
   * Create or idempotently adopt one ordinary Session.
   * @param request - requested identity, location, and Agent preset.
   * @returns the Session identity and resolved preset when configured.
   * @remarks 中文说明：功能说明：创建 create 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：request（SessionCreateRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<SessionCreateValue>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 create(request)，并按返回类型处理结果。
   */
  async create(request: SessionCreateRequest): Promise<SessionCreateValue> {
    if (request.workspaceId !== undefined && request.cwd !== undefined) {
      reject('bad-request', 'session.create accepts workspaceId or cwd, not both', {})
    }
    /**
     * 常量说明：sessionId 用于处理 sessionId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const sessionId = request.sessionId ?? SessionId(`session-${randomUUID()}`)
    /**
     * 变量说明：workspace 用于处理 workspace 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let workspace: Workspace | undefined
    if (request.workspaceId !== undefined) {
      workspace = this.ctx.workspaceRegistry.get(request.workspaceId)
      if (workspace === undefined) {
        reject('workspace-not-found', `workspace "${request.workspaceId}" not found`, {
          workspaceId: request.workspaceId,
        })
      }
    }
    /**
     * 常量说明：cwd 用于处理 cwd 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const cwd = workspace?.path ?? request.cwd ?? this.defaultCwd
    /**
     * 变量说明：adopted 用于处理 adopted 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let adopted: Agent
    try {
      adopted = await this.agents.ensureSession(
        sessionId,
        cwd,
        request.sessionId !== undefined,
        request.agentPreset,
      )
    } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error) {
      this.rejectCreation(sessionId, error)
    }
    if (workspace !== undefined) {
      try {
        await workspace.attachSession(sessionId)
      } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error) {
        reject(
          'workspace-attach-failed',
          `session "${sessionId}" was created but could not attach to workspace "${workspace.id}": ${String(error)}`,
          { sessionId, workspaceId: workspace.id },
        )
      }
    }
    /**
     * 常量说明：agentPreset 用于处理 agentPreset 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const agentPreset = this.agents.presetForSession(adopted.session)
    return { sessionId, ...(agentPreset === undefined ? {} : { agentPreset }) }
  }

  /**
   * Validate and install one Session-local model selection.
   * @param request - Session identity and requested model selection.
   * @returns the normalized selection installed for the Session.
   * @remarks 中文说明：功能说明：处理 selectModel 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：request（SessionSelectModelRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<SessionSelectModelValue>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 selectModel(request)，并按返回类型处理结果。
   */
  async selectModel(request: SessionSelectModelRequest): Promise<SessionSelectModelValue> {
    /**
     * 常量说明：agent 用于处理 agent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const agent = await this.resolveAgent(request.sessionId)
    return this.agents.serializeImageAdmission(agent, /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        try {
        /**
         * 常量说明：resolved 用于处理 resolved 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
          const resolved = await this.ctx.llm.resolveCallConfig({
            provider: request.provider,
            model: request.model,
            ...(request.reasoningEffort === undefined
              ? {}
              : { reasoningEffort: ReasoningEffortId(request.reasoningEffort) }),
          })
          /**
         * 常量说明：selected 用于处理 selected 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
          const selected: AgentModelSelection = {
            provider: resolved.provider,
            model: resolved.model,
            ...(resolved.reasoningEffort === undefined
              ? {}
              : { reasoningEffort: resolved.reasoningEffort }),
          }
          this.agents.selectForNextRequest(agent, selected)
          try {
            await this.ctx.agentDefaultModel.saveSelection(selected)
          } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error) {
            this.ctx.logger.warn(
              `session-controller: model selection changed for the Session but the default was not saved: ${String(error)}`,
            )
          }
          return { selected: { ...selected } }
        } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error) {
          if (error instanceof TypertRemoteFailure) throw error
          reject(
            'model-unavailable',
            error instanceof Error ? error.message : String(error),
            { provider: request.provider, model: request.model },
          )
        }
      })
  }

  /**
   * Normalize and append a user-owned Session title.
   * @param request - Session identity and proposed title.
   * @returns the accepted title and durable event sequence.
   * @remarks 中文说明：功能说明：处理 rename 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：request（SessionRenameRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<SessionRenameValue>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 rename(request)，并按返回类型处理结果。
   */
  async rename(request: SessionRenameRequest): Promise<SessionRenameValue> {
    /**
     * 常量说明：agent 用于处理 agent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const agent = await this.resolveAgent(request.sessionId)
    /**
     * 常量说明：titles 用于处理 titles 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const titles = this.ctx.get('sessionTitle')
    if (titles === undefined) {
      reject('internal', 'renaming is unavailable: this deployment mounts no session-title service', {})
    }
    try {
      /**
       * 常量说明：accepted 用于处理 accepted 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const accepted = titles.rename(agent.session, request.title)
      return { title: accepted.title, seq: accepted.eventSeq }
    } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error) {
      if (error instanceof SessionTitleInvalidError) {
        reject('title-invalid', error.message, { sessionId: request.sessionId })
      }
      reject(
        'internal',
        `failed to rename session "${request.sessionId}": ${String(error)}`,
        {},
      )
    }
  }

  /**
   * Create a new ordinary Session from one completed-turn prefix.
   * @param request - source Session and optional event anchor.
   * @returns the new Session identity.
   * @remarks 中文说明：功能说明：处理 fork 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：request（SessionForkRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<SessionForkValue>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 fork(request)，并按返回类型处理结果。
   */
  async fork(request: SessionForkRequest): Promise<SessionForkValue> {
    if (request.atSeq !== undefined
      && (!Number.isInteger(request.atSeq) || request.atSeq < 0)) {
      reject('bad-request', 'atSeq must be a non-negative integer', {})
    }
    /**
     * 变量说明：observed 用于处理 observed 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let observed: SessionObservation
    try {
      observed = await this.ctx.sessionQuery.observeSession(request.sessionId)
    } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error) {
      if (error instanceof SessionQueryError
        && error.code === 'SESSION_QUERY_SESSION_NOT_FOUND') {
        reject('session-not-found', `session "${request.sessionId}" not found`, {
          sessionId: request.sessionId,
        })
      }
      reject(
        'internal',
        `fork source unavailable for session "${request.sessionId}": ${String(error)}`,
        {},
      )
    }
    /**
     * 变量说明：source 用于处理 source 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    using source = observed
    /**
     * 常量说明：lastSeq 用于处理 lastSeq 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const lastSeq = source.events.at(-1)?.seq ?? -1
    /**
     * 常量说明：atSeq 用于处理 atSeq 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const atSeq = request.atSeq
    /**
     * 常量说明：anchoredBoundary 用于处理 anchoredBoundary 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const anchoredBoundary = atSeq === undefined
      ? undefined
      : source.events.find(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
 * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
 */ event => event.type === 'turn/end' && event.seq >= atSeq)
    /**
     * 常量说明：boundary 用于处理 boundary 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const boundary = anchoredBoundary
      ?? (atSeq === undefined || atSeq > lastSeq
        ? source.events.findLast(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
 * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
 */ event => event.type === 'turn/end')
        : undefined)
    if (boundary === undefined) {
      reject(
        'fork-unavailable',
        atSeq !== undefined && atSeq <= lastSeq
          ? `session "${request.sessionId}" has not completed the turn containing event ${String(atSeq)}`
          : `session "${request.sessionId}" has no completed turn to fork from`,
        { sessionId: request.sessionId },
      )
    }
    /**
     * 变量说明：cut 用于处理 cut 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let cut = boundary.seq + 1
    while (cut < source.events.length && source.events[cut]?.type !== 'turn/start') cut++
    /**
     * 变量说明：workspace 用于处理 workspace 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let workspace: Workspace | undefined
    try {
      workspace = await this.forkWorkspace(source.header)
    } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error) {
      reject(
        'internal',
        `failed to resolve fork workspace for session "${request.sessionId}": ${String(error)}`,
        {},
      )
    }
    /**
     * 常量说明：childId 用于处理 childId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const childId = SessionId(`session-${randomUUID()}`)
    /**
     * 常量说明：composition 用于处理 composition 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const composition = await this.agents.composeAgent(this.agents.presetForObservation(source))
    try {
      /**
       * 常量说明：provider、model 用于处理 provider、model 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const { provider, model } = this.ctx.agentDefaultModel.currentSelection()
      await this.ctx.agents.create({
        sessionId: childId,
        seed: source.events.slice(0, cut),
        meta: {
          ...(source.header.cwd === undefined ? {} : { cwd: source.header.cwd }),
          parentSession: source.header.id,
          seedLength: cut,
          ...(composition.agentPreset === undefined
            ? {}
            : { agentPreset: composition.agentPreset }),
        },
        agentOptions: { provider, model },
        setup: composition.setup,
      })
    } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error) {
      reject(
        'internal',
        `failed to fork session "${request.sessionId}": ${String(error)}`,
        {},
      )
    }
    if (workspace !== undefined) {
      try {
        await workspace.attachSession(childId)
      } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error) {
        reject(
          'workspace-attach-failed',
          `session "${childId}" was forked but could not attach to workspace "${workspace.id}": ${String(error)}`,
          { sessionId: childId, workspaceId: workspace.id },
        )
      }
    }
    return { sessionId: childId }
  }

  /**
   * Admit one browser prompt after explicit Agent resume and image validation.
   * @param request - Session identity, prompt content, source metadata, and delivery mode.
   * @returns acknowledgement that the Agent accepted the prompt.
   * @remarks 中文说明：功能说明：处理 prompt 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：request（SessionPromptRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<SessionPromptValue>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 prompt(request)，并按返回类型处理结果。
   */
  async prompt(request: SessionPromptRequest): Promise<SessionPromptValue> {
    /**
     * 常量说明：clientTimeZone 用于处理 clientTimeZone 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const clientTimeZone = request.clientTimeZone === undefined
      ? undefined
      : canonicalClientTimeZone(request.clientTimeZone)
    if (request.clientTimeZone !== undefined && clientTimeZone === undefined) {
      reject(
        'invalid-time-zone',
        'clientTimeZone must be UTC or a valid IANA Area/Location name',
        { value: request.clientTimeZone },
      )
    }
    /**
     * 常量说明：agent 用于处理 agent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const agent = await this.resolveAgent(request.sessionId)
    /**
     * 常量说明：selection 用于处理 selection 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const selection = this.agents.selectionFor(agent).current
    if (!routeServed(this.ctx, selection.provider)) {
      reject(
        'model-unavailable',
        `no adapter serves provider "${selection.provider}"; select a model for this session`,
        { provider: selection.provider, model: selection.model },
      )
    }
    /**
     * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const source: MessageSource = {
      kind: 'user',
      rpcId: request.requestId,
      ...(clientTimeZone === undefined ? {} : { clientTimeZone }),
    }
    /**
     * 常量说明：hasImage 用于判断是否包含 Image 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const hasImage = request.content.some(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：part（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(part)，并按返回类型处理结果。
 */ part => part.type === 'image')
    /**
     * 常量说明：admit 用于处理 admit 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：处理 admit 相关流程；使用场景由所在模块及调用位置决定。
     * @returns Promise<SessionPromptValue>；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 admit()，并按返回类型处理结果。
     */
    const admit = async (): Promise<SessionPromptValue> => {
      try {
        if (hasImage) {
          /**
           * 常量说明：current 用于处理 current 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
           */
          const current = this.agents.selectionFor(agent).current
          /**
           * 常量说明：model 用于处理 model 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
           */
          const model = await this.ctx.llm.resolveModelInfo(current.provider, current.model)
          if (model.inputModalities !== undefined && !model.inputModalities.includes('image')) {
            reject(
              'attachment-error',
              `Model "${current.model}" does not support image input.`,
              { reason: 'MODEL_DOES_NOT_SUPPORT_IMAGES' },
            )
          }
        }
        /**
         * 常量说明：content 用于处理 content 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const content = await durablePromptContent(this.ctx, request.content)
        /**
         * 常量说明：message 用于处理 message 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const message: UserMessage = createUserMessage({ content, source })
        if (request.mode === 'steer') agent.steer(message)
        else agent.followup(message)
      } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error) {
        if (error instanceof TypertRemoteFailure) throw error
        if (error instanceof AttachmentError) {
          reject('attachment-error', error.message, { reason: error.code })
        }
        reject('agent-busy', 'prompt rejected', { reason: String(error) })
      }
      return { accepted: true }
    }
    return hasImage ? this.agents.serializeImageAdmission(agent, admit) : admit()
  }

  /**
   * Read one durable image after proving the Session log references it.
   * @param request - Session and attachment identities used for authorization.
   * @returns the durable attachment reference and base64-encoded bytes.
   * @remarks 中文说明：功能说明：处理 attachment 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：request（SessionAttachmentRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<SessionAttachmentValue>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 attachment(request)，并按返回类型处理结果。
   */
  async attachment(request: SessionAttachmentRequest): Promise<SessionAttachmentValue> {
    /**
     * 变量说明：source 用于处理 source 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let source: SessionReadState
    try {
      source = await this.readSessionState(request.sessionId)
    } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error) {
      if (error instanceof ApiSessionNotFound) {
        reject('session-not-found', error.message, { sessionId: request.sessionId })
      }
      reject(
        'internal',
        `attachment authorization unavailable for session "${request.sessionId}": ${String(error)}`,
        {},
      )
    }
    /**
     * 常量说明：ref 用于处理 ref 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ref = referencedImage(source.events, String(request.attachmentId))
    if (ref === undefined) {
      reject(
        'attachment-error',
        'Image is not referenced by this session.',
        { reason: 'ATTACHMENT_NOT_REFERENCED' },
      )
    }
    try {
      /**
       * 常量说明：stored 用于处理 stored 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const stored = await this.ctx.attachments.readImage(ref)
      return {
        attachment: stored.ref,
        data: Buffer.from(stored.data).toString('base64'),
      }
    } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error) {
      if (error instanceof AttachmentError) {
        reject('attachment-error', error.message, { reason: error.code })
      }
      reject('internal', 'Unable to read image attachment.', {})
    }
  }

  /**
   * Mutate one still-pending queue occurrence without resuming a cold Agent.
   * @param request - Session, queue item, and requested mutation.
   * @returns acknowledgement that the queue mutation was applied.
   * @remarks 中文说明：功能说明：更新 Queue 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：request（SessionUpdateQueueRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；
   * 返回值：SessionUpdateQueueValue；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 updateQueue(request)，并按返回类型处理结果。
   */
  updateQueue(request: SessionUpdateQueueRequest): SessionUpdateQueueValue {
    if (request.action.kind === 'edit'
      && request.action.content.some(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：block（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(block)，并按返回类型处理结果。
 */ block => block.type !== 'text')) {
      reject(
        'attachment-error',
        'queue edits accept text content only',
        { reason: 'QUEUE_EDIT_NON_TEXT' },
      )
    }
    /**
     * 常量说明：agent 用于处理 agent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const agent = this.ctx.agents.get(request.sessionId)
    if (agent !== undefined && hasApiSessionSubagentOwner(this.ctx, agent.session, agent)) {
      rejectFailure(apiSessionSubagentOwnershipError(request.sessionId))
    }
    if (agent === undefined) {
      reject('queue-item-not-found', 'queued item is no longer pending', { itemId: request.itemId })
    }
    /**
     * 常量说明：nextTurn 用于处理 nextTurn 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const nextTurn = agent.inbox.nextTurn.find(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：message（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(message)，并按返回类型处理结果。
 */ message => message.id === request.itemId)
    /**
     * 常量说明：nextStep 用于处理 nextStep 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const nextStep = agent.inbox.nextStep.find(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：message（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(message)，并按返回类型处理结果。
 */ message => message.id === request.itemId)
    /**
     * 常量说明：located 用于处理 located 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const located = nextTurn === undefined
      ? nextStep === undefined ? undefined : { target: 'next-step' as const, message: nextStep }
      : { target: 'next-turn' as const, message: nextTurn }
    if (located === undefined) {
      reject('queue-item-not-found', 'queued item is no longer pending', { itemId: request.itemId })
    }
    /**
     * 常量说明：target、message 用于处理 target、message 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const { target, message } = located
    if (request.action.kind === 'steer' && (target !== 'next-turn' || agent.status !== 'running')) {
      reject('steer-unavailable', 'current turn no longer accepts steering', { itemId: request.itemId })
    }
    if (request.action.kind === 'edit') {
      agent.inbox.replace(request.itemId, freezeMessage<UserMessage>({
        ...message,
        content: [...request.action.content],
      }))
    } else {
      agent.inbox.remove(request.itemId)
      if (request.action.kind === 'steer') agent.steer(message)
    }
    return { accepted: true }
  }

  /**
   * Cancel one live ordinary Agent while retaining pending inbox work.
   * @param request - Session whose active Agent turn is cancelled.
   * @returns acknowledgement that cancellation was requested.
   * @remarks 中文说明：功能说明：处理 cancel 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：request（SessionCancelRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；
   * 返回值：SessionCancelValue；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * cancel(request)，并按返回类型处理结果。
   */
  cancel(request: SessionCancelRequest): SessionCancelValue {
    /**
     * 常量说明：agent 用于处理 agent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const agent = this.ctx.agents.get(request.sessionId)
    if (agent === undefined) {
      reject(
        'session-not-found',
        `session "${request.sessionId}" not found (not attached)`,
        { sessionId: request.sessionId },
      )
    }
    if (hasApiSessionSubagentOwner(this.ctx, agent.session, agent)) {
      rejectFailure(apiSessionSubagentOwnershipError(request.sessionId))
    }
    agent.cancel({ kind: 'user' }, { keepInbox: true })
    return { accepted: true }
  }

  /**
   * 功能说明：解析 Agent 相关流程；使用场景由所在模块及调用位置决定。
   * @param sessionId （SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<Agent>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 resolveAgent(sessionId)，并按返回类型处理结果。
   */
  private async resolveAgent(sessionId: SessionId): Promise<Agent> {
    /**
     * 常量说明：found 用于处理 found 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const found = await this.agents.resolveAgent(sessionId)
    if ('error' in found) rejectFailure(found.error)
    return found.agent
  }

  /**
   * 功能说明：处理 rejectCreation 相关流程；使用场景由所在模块及调用位置决定。
   * @param sessionId （SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param error （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns never；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 rejectCreation(sessionId, error)，并按返回类型处理结果。
   */
  private rejectCreation(sessionId: SessionId, error: unknown): never {
    if (error instanceof ApiSessionPresetConflict) {
      reject('agent-preset-conflict', error.message, {
        sessionId: error.sessionId,
        requestedPreset: error.requestedPreset,
        ...(error.existingPreset === undefined ? {} : { existingPreset: error.existingPreset }),
      })
    }
    if (error instanceof UnknownPresetError) {
      reject('agent-preset-not-found', error.message, {
        agentPreset: error.presetId,
        available: [...error.available],
      })
    }
    if (error instanceof PresetMountError) {
      reject('agent-preset-invalid', error.message, {
        agentPreset: error.presetId,
        reason: error.reason,
      })
    }
    if (error instanceof ApiSessionCwdConflict) {
      reject('session-conflict', error.message, {
        sessionId: error.sessionId,
        requestedCwd: error.requestedCwd,
        ...(error.existingCwd === undefined ? {} : { existingCwd: error.existingCwd }),
      })
    }
    if (error instanceof ApiSessionSubagentOwnership) {
      rejectFailure(apiSessionSubagentOwnershipError(error.sessionId))
    }
    reject('internal', `failed to create session "${sessionId}": ${String(error)}`, {})
  }

  /**
   * 功能说明：读取 Session State 相关流程；使用场景由所在模块及调用位置决定。
   * @param sessionId （SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<SessionReadState>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 readSessionState(sessionId)，并按返回类型处理结果。
   */
  private async readSessionState(sessionId: SessionId): Promise<SessionReadState> {
    /**
     * 常量说明：attached 用于处理 attached 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const attached = this.ctx.sessions.get(sessionId)
    if (attached !== undefined) {
      return { id: attached.id, header: attached.header, events: [...attached.events] }
    }
    /**
     * 常量说明：inspected 用于处理 inspected 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const inspected = await inspectApiSession(this.ctx, sessionId)
    return { id: inspected.meta.id, header: inspected.meta, events: inspected.events }
  }

  /**
   * 功能说明：处理 forkWorkspace 相关流程；使用场景由所在模块及调用位置决定。
   * @param source （SessionHeader）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<Workspace | undefined>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 forkWorkspace(source)，并按返回类型处理结果。
   */
  private async forkWorkspace(source: SessionHeader): Promise<Workspace | undefined> {
    /**
     * 常量说明：workspaces 用于处理 workspaces 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const workspaces = this.ctx.workspaceRegistry.list()
    /**
     * 常量说明：direct 用于处理 direct 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const direct = workspaces.find(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：workspace（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(workspace)，并按返回类型处理结果。
 */ workspace => workspace.sessionIds.includes(source.id))
    if (direct !== undefined || source.origin !== 'subagent') return direct
    /**
     * 常量说明：lineage 用于处理 lineage 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const lineage = await this.ctx.sessionQuery.traceSession(source.id)
    for (const /*
     * 变量说明：ancestor 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */ ancestor of lineage.ancestors) {
      /**
       * 常量说明：workspace 用于处理 workspace 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const workspace = workspaces.find(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：candidate（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(candidate)，并按返回类型处理结果。
 */ candidate => candidate.sessionIds.includes(ancestor.header.id))
      if (workspace !== undefined) return workspace
    }
    return undefined
  }
}

/**
 * 功能说明：处理 rejectFailure 相关流程；使用场景由所在模块及调用位置决定。
 * @param error （{ readonly code: string; readonly message: string;
 * readonly…）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns never；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 rejectFailure(error)，并按返回类型处理结果。
 */
function rejectFailure(error: { readonly code: string; readonly message: string; readonly details: object }): never {
  throw new TypertRemoteFailure(error)
}

/**
 * 功能说明：处理 reject 相关流程；使用场景由所在模块及调用位置决定。
 * @param code （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param message （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param details （object）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns never；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 reject(code, message, details)，并按返回类型处理结果。
 */
function reject(code: string, message: string, details: object): never {
  throw new TypertRemoteFailure({ code, message, details })
}

/**
 * 功能说明：处理 durablePromptContent 相关流程；使用场景由所在模块及调用位置决定。
 * @param ctx （Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。
 * @param content （readonly SessionPromptRequest['content'][number][]）：提供本次
 * 调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Promise<ContentBlock[]>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 durablePromptContent(ctx, content)，并按返回类型处理结果。
 */
async function durablePromptContent(
  ctx: Context,
  content: readonly SessionPromptRequest['content'][number][],
): Promise<ContentBlock[]> {
  if (content.every(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：part（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(part)，并按返回类型处理结果。
 */ part => part.type === 'text')) {
    return content.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：part（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(part)，并按返回类型处理结果。
 */ part => ({ type: 'text', text: part.text }))
  }
  /**
   * 常量说明：refs 用于处理 refs 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const refs = await admitEncodedImages(ctx.attachments, content.filter(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：part（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(part)，并按返回类型处理结果。
 */ part => part.type === 'image'))
  /**
   * 变量说明：next 用于处理 next 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let next = 0
  return content.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：part（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(part)，并按返回类型处理结果。
 */ part => part.type === 'text'
      ? { type: 'text', text: part.text }
    // admitEncodedImages returns one reference per image part in order.
      : { type: 'image', attachment: refs[next++] as ImageAttachmentRef })
}

/**
 * 功能说明：处理 imageBlockIn 相关流程；使用场景由所在模块及调用位置决定。
 * @param content （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param match （(ref: ImageAttachmentRef) => boolean）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @returns ImageAttachmentRef | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 imageBlockIn(content, match)，并按返回类型处理结果。
 */
function imageBlockIn(
  content: unknown,
  match: (ref: ImageAttachmentRef) => boolean,
): ImageAttachmentRef | undefined {
  if (!Array.isArray(content)) return undefined
  for (const /*
   * 变量说明：value 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */ value of content) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue
    /**
     * 常量说明：block 用于处理 block 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const block = value as { readonly type?: unknown; readonly attachment?: unknown; readonly content?: unknown }
    if (block.type === 'image' && typeof block.attachment === 'object' && block.attachment !== null) {
      /**
       * 常量说明：ref 用于处理 ref 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const ref = block.attachment as ImageAttachmentRef
      if (match(ref)) return ref
    }
    if (block.type === 'tool-result') {
      /**
       * 常量说明：nested 用于处理 nested 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const nested = imageBlockIn(block.content, match)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

/**
 * 功能说明：处理 imageInEvent 相关流程；使用场景由所在模块及调用位置决定。
 * @param event （SessionEvent）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。
 * @param match （(ref: ImageAttachmentRef) => boolean）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @returns ImageAttachmentRef | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 imageInEvent(event, match)，并按返回类型处理结果。
 */
function imageInEvent(
  event: SessionEvent,
  match: (ref: ImageAttachmentRef) => boolean,
): ImageAttachmentRef | undefined {
  /**
   * 常量说明：data 用于处理 data 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const data = event.data as {
    readonly content?: unknown
    readonly message?: { readonly content?: unknown }
    readonly inserted?: readonly { readonly content?: unknown }[]
    readonly chunk?: { readonly type?: unknown; readonly block?: unknown }
  }
  /**
   * 常量说明：direct 用于处理 direct 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const direct = imageBlockIn(data.content, match)
  if (direct !== undefined) return direct
  /**
   * 常量说明：message 用于处理 message 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const message = imageBlockIn(data.message?.content, match)
  if (message !== undefined) return message
  for (const /*
   * 变量说明：inserted 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */ inserted of data.inserted ?? []) {
    /**
     * 常量说明：found 用于处理 found 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const found = imageBlockIn(inserted.content, match)
    if (found !== undefined) return found
  }
  return event.type === 'assistant/chunk' && data.chunk?.type === 'block-end'
    ? imageBlockIn([data.chunk.block], match)
    : undefined
}

/**
 * 功能说明：处理 referencedImage 相关流程；使用场景由所在模块及调用位置决定。
 * @param events （readonly SessionEvent[]）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。
 * @param attachmentId （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns ImageAttachmentRef | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 referencedImage(events, attachmentId)，并按返回类型处理结果。
 */
function referencedImage(
  events: readonly SessionEvent[],
  attachmentId: string,
): ImageAttachmentRef | undefined {
  for (const /*
   * 变量说明：event 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */ event of events) {
    /**
     * 常量说明：found 用于处理 found 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const found = imageInEvent(event, /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：ref（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(ref)，并按返回类型处理结果。
 */ ref => String(ref.attachmentId) === attachmentId)
    if (found !== undefined) return found
  }
  return undefined
}

/**
 * 常量说明：IANA_TIME_ZONE 用于处理 IANA_TIME_ZONE 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const IANA_TIME_ZONE = /^[A-Za-z][A-Za-z0-9_+.-]*(?:\/[A-Za-z0-9_+.-]+)+$/

/**
 * 功能说明：处理 canonicalClientTimeZone 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 canonicalClientTimeZone(value)，并按返回类型处理结果。
 */
function canonicalClientTimeZone(value: string): string | undefined {
  if (value.length === 0 || value.trim() !== value
    || (value !== 'UTC' && !IANA_TIME_ZONE.test(value))) return undefined
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone
  } catch {
    return undefined
  }
}

/**
 * 功能说明：处理 routeServed 相关流程；使用场景由所在模块及调用位置决定。
 * @param ctx （Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。
 * @param provider （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 routeServed(ctx, provider)，并按返回类型处理结果。
 */
function routeServed(ctx: Context, provider: string): boolean {
  return ctx.llm.listProviders().some(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：entry（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(entry)，并按返回类型处理结果。
 */ entry => entry.id === provider)
}
