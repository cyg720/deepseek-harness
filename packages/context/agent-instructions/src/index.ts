/**
 * Workspace instruction loader for AGENTS.md-compatible files.
 *
 * Baseline instructions enter durable context before the first request; successful fs
 * tool touches project nested, changed, and removed instructions into the inbox.
 * Plugin lifecycle reads use the optional `ctx.fs` provider, so providerless products
 * mount it as a no-op.
 *
 * @module @deepseek-ai/dsh-agent-instructions
 */
/*
 * 文件职责：实现工作区指令上下文的 index.ts 模块。
 * 技术维度：TypeScript、Cordis 插件、会话事件和严格判别联合。
 * 产品维度：控制模型请求中的工作区指令上下文信息。
 * 逻辑维度：读取日志或文件状态，计算投影并记录/注入结果。
 * 关键边界：不能静默丢失必需事件；裁剪和替换必须保持日志可重放。
 * 新手阅读建议：先读导出类型与配置，再跟踪事件和投影流程。
 */

import type { Context } from '@deepseek-ai/cordis'
import { isDeepStrictEqual } from 'node:util'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Session, UserMessage } from '@deepseek-ai/dsh-session'
import type { ToolExecution, ToolExecutionResult, ToolExecutionToken } from '@deepseek-ai/dsh-tools'
import { Config, resolveConfig, workspaceBaselineIdentity, type ResolvedConfig } from './config.ts'
import { findProjectRoot, loadBaselineInstructionSet } from './files.ts'
import {
  applyInstructionVersionUpdates,
  baselineInstructionState,
  name,
  reconcileInstructionContext,
  workspaceContextMessage,
  /** 中文说明：类型或类 InstructionVersionCache 约束上下文或压缩数据职责。 */
  type InstructionVersionCache,
  /** 中文说明：类型或类 AgentInstructionSource 约束上下文或压缩数据职责。 */
  type AgentInstructionSource,
} from './state.ts'
import type { AgentInstructionChange } from './render.ts'

export { Config, name }
export {
  discoverBaselineInstructionFiles,
  loadBaselineInstructions,
} from './files.ts'
export type {
  InstructionFile,
  LoadedInstructionFile,
} from './files.ts'
export { renderWorkspaceContext } from './render.ts'
export type { RenderedWorkspaceContext, TruncatedInstruction } from './render.ts'

/** 中文说明：函数 visibleBaselineSource 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function visibleBaselineSource(
  agent: Agent,
  authorityMessages: readonly UserMessage[],
): AgentInstructionSource | undefined {
  /** 中文说明：上下文局部值 message，由紧邻初始化决定。 */
  for (const message of authorityMessages.toReversed()) {
    if (message.source.kind === 'agent-instructions' && message.source.baseline === true) {
      return message.source
    }
  }
  /** 中文说明：上下文局部值 seq，由紧邻初始化决定。 */
  for (const seq of agent.session.surface.nodes.toReversed()) {
    /** 中文说明：上下文局部值 event，由紧邻初始化决定。 */
    const event = agent.session.events[seq]
    if (event?.type === 'user/message'
      && event.data.source.kind === 'agent-instructions'
      && event.data.source.baseline === true) return event.data.source
  }
  return undefined
}

/** 中文说明：函数 isWorkspaceContext 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function isWorkspaceContext(message: UserMessage): boolean {
  return message.source.kind === 'agent-instructions'
}

/** 中文说明：函数 sameContextPayload 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function sameContextPayload(left: UserMessage, right: UserMessage): boolean {
  return isDeepStrictEqual(left.content, right.content)
    && isDeepStrictEqual(left.source, right.source)
}

/** 中文说明：上下文局部值 FILE_TOUCH_TOOL_NAMES，由紧邻初始化决定。 */
const FILE_TOUCH_TOOL_NAMES = new Set(['read', 'write', 'edit'])

/** 中文说明：函数 filePathFromExecution 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function filePathFromExecution(exec: ToolExecution): string | undefined {
  if (!FILE_TOUCH_TOOL_NAMES.has(exec.name)) return undefined
  if (typeof exec.arguments !== 'object' || exec.arguments === null) return undefined
  if (!('file_path' in exec.arguments) || typeof exec.arguments.file_path !== 'string') return undefined
  /** 中文说明：上下文局部值 filePath，由紧邻初始化决定。 */
  const filePath = exec.arguments.file_path.trim()
  return filePath.length > 0 ? filePath : undefined
}

/** 中文说明：函数 apply 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function apply(ctx: Context, config: Config): void {
  /** 中文说明：上下文局部值 resolved，由紧邻初始化决定。 */
  const resolved: ResolvedConfig = resolveConfig(config)
  /** 中文说明：上下文局部值 instructionVersions，由紧邻初始化决定。 */
  const instructionVersions: InstructionVersionCache = new WeakMap()
  /** 中文说明：上下文局部值 baselinePreparations，由紧邻初始化决定。 */
  const baselinePreparations = new WeakMap<Session, {
    identity: string
    excludedScopes: ReadonlySet<string>
  }>()
  /** 中文说明：上下文局部值 projectionLifecycle，由紧邻初始化决定。 */
  const projectionLifecycle = new AbortController()
  /** 中文说明：类型或类 ProjectionTouch 约束上下文或压缩数据职责。 */
  type ProjectionTouch = { agent: Agent; path: string }
  /** 中文说明：上下文局部值 executionTouches，由紧邻初始化决定。 */
  const executionTouches = new Map<ToolExecutionToken, ProjectionTouch[]>()
  ctx.effect(
    () => () => {
      projectionLifecycle.abort(new Error('agent-instructions disposed'))
      executionTouches.clear()
    },
    'agent-instructions.projectionLifecycle',
  )
  // Emit listeners are not awaited, so each projection must compose against the
  // inbox produced by earlier file results for the same agent.
  /** 中文说明：上下文局部值 projectionTails，由紧邻初始化决定。 */
  const projectionTails = new WeakMap<Agent, Promise<void>>()
  // Execution ancestry and the enclosing durable step are the two commit
  // boundaries before an asynchronous projection may mutate the agent inbox.
  /** 中文说明：上下文局部值 openSteps，由紧邻初始化决定。 */
  const openSteps = new WeakMap<Session, boolean>()
  /** 中文说明：上下文局部值 stepTouches，由紧邻初始化决定。 */
  const stepTouches = new WeakMap<Session, ProjectionTouch[]>()

  /** 中文说明：上下文局部值 compose，由紧邻初始化决定。 */
  const compose = async (
    agent: Agent,
    signal: AbortSignal,
    claimed: readonly UserMessage[],
    pending: readonly UserMessage[],
    touchedPaths: readonly string[] = [],
  ): Promise<UserMessage | undefined> => {
    signal.throwIfAborted()
    if (resolved.maxBytes <= 0 || !Number.isFinite(resolved.maxBytes)) {
      return undefined
    }
    /** 中文说明：上下文局部值 fileSystem，由紧邻初始化决定。 */
    const fileSystem = ctx.get('fs')
    if (fileSystem === undefined) return undefined
    if (touchedPaths.length === 0 && pending.length > 0) return pending[0]
    /** 中文说明：上下文局部值 content，由紧邻初始化决定。 */
    const content: UserMessage['content'][number][] = []
    /** 中文说明：上下文局部值 changes，由紧邻初始化决定。 */
    const changes: AgentInstructionChange[] = []
    /** 中文说明：上下文局部值 desiredBaseline，由紧邻初始化决定。 */
    let desiredBaseline = false
    /** 中文说明：上下文局部值 authorityMessages，由紧邻初始化决定。 */
    const authorityMessages = [...claimed]
    /** 中文说明：上下文局部值 cwd，由紧邻初始化决定。 */
    /* v8 ignore next -- normal agents carry an absolute session cwd. */
    const cwd = agent.session.header.cwd ?? process.cwd()
    /** 中文说明：上下文局部值 projectRoot，由紧邻初始化决定。 */
    const projectRoot = await findProjectRoot(cwd, resolved.projectRootMarkers, fileSystem, signal)
    /** 中文说明：上下文局部值 identity，由紧邻初始化决定。 */
    const identity = workspaceBaselineIdentity(resolved, cwd, projectRoot)
    /** 中文说明：上下文局部值 visibleBaseline，由紧邻初始化决定。 */
    const visibleBaseline = visibleBaselineSource(agent, authorityMessages)
    /** 中文说明：上下文局部值 baselinePresent，由紧邻初始化决定。 */
    const baselinePresent = visibleBaseline !== undefined
    /** 中文说明：上下文局部值 keepVisibleBaseline，由紧邻初始化决定。 */
    const keepVisibleBaseline = visibleBaseline?.baselineIdentity === identity
    /** 中文说明：上下文局部值 prepared，由紧邻初始化决定。 */
    const prepared = baselinePreparations.get(agent.session)
    /** 中文说明：上下文局部值 excludedBaselineScopes，由紧邻初始化决定。 */
    let excludedBaselineScopes = keepVisibleBaseline && prepared?.identity === identity
      ? prepared.excludedScopes
      : undefined
    /** 中文说明：上下文局部值 解构结果，由紧邻初始化决定。 */
    let nextPreparation: { identity: string; excludedScopes: ReadonlySet<string> } | undefined
    if (!baselinePresent || !keepVisibleBaseline || excludedBaselineScopes === undefined) {
      /** 中文说明：上下文局部值 replacePreviousBaseline，由紧邻初始化决定。 */
      const replacePreviousBaseline = baselinePresent && !keepVisibleBaseline
      /** 中文说明：上下文局部值 instructions，由紧邻初始化决定。 */
      const instructions = await loadBaselineInstructionSet({
        cwd,
        dshHome: resolved.dshHome,
        projectRootMarkers: resolved.projectRootMarkers,
        maxBytes: resolved.maxBytes,
        maxSourceBytes: resolved.maxSourceBytes,
        instructionFileCandidates: resolved.instructionFileCandidates,
        localInstructionFileCandidates: resolved.localInstructionFileCandidates,
        projectRoot,
        replacePreviousBaseline,
        signal,
      }, fileSystem)
      /** 中文说明：上下文局部值 baseline，由紧邻初始化决定。 */
      const baseline = baselineInstructionState(instructions?.included ?? [])
      /** 中文说明：上下文局部值 observedBaseline，由紧邻初始化决定。 */
      const observedBaseline = baselineInstructionState(instructions?.observed ?? [])
      /** 中文说明：上下文局部值 excludedScopes，由紧邻初始化决定。 */
      const excludedScopes = new Set(observedBaseline.changes.keys())
      /** 中文说明：上下文局部值 scope，由紧邻初始化决定。 */
      for (const scope of baseline.changes.keys()) excludedScopes.delete(scope)
      excludedBaselineScopes = excludedScopes
      nextPreparation = { identity, excludedScopes }
      /** 中文说明：上下文局部值 versionStates，由紧邻初始化决定。 */
      let versionStates = instructionVersions.get(agent.session)
      if (versionStates === undefined && baseline.versions.size > 0) {
        versionStates = new Map()
        instructionVersions.set(agent.session, versionStates)
      }
      /** 中文说明：上下文局部值 [scope，由紧邻初始化决定。 */
      for (const [scope, state] of baseline.versions) versionStates?.set(scope, state)
      if (!keepVisibleBaseline && instructions !== undefined && instructions.rendered.text.length > 0) {
        /** 中文说明：上下文局部值 baselineContent，由紧邻初始化决定。 */
        const baselineContent = workspaceContextMessage(instructions.rendered.text).content
        content.push(...baselineContent)
        /** 中文说明：上下文局部值 replacementScopes，由紧邻初始化决定。 */
        const replacementScopes = new Set(baseline.changes.keys())
        /** 中文说明：上下文局部值 replacementRemovals，由紧邻初始化决定。 */
        const replacementRemovals = replacePreviousBaseline
          ? visibleBaseline.changes.flatMap(change => (
            change.action === 'remove' || replacementScopes.has(change.scope)
              ? []
              : [{ action: 'remove' as const, scope: change.scope, path: change.path }]
          ))
          : []
        /** 中文说明：上下文局部值 baselineChanges，由紧邻初始化决定。 */
        const baselineChanges = [...replacementRemovals, ...baseline.changes.values()]
        changes.push(...baselineChanges)
        authorityMessages.push(createUserMessage({
          content: baselineContent,
          source: {
            kind: 'agent-instructions',
            form: 'instructions',
            baseline: true,
            baselineIdentity: identity,
            changes: baselineChanges,
          },
        }))
        desiredBaseline = true
      }
    }
    /** 中文说明：上下文局部值 update，由紧邻初始化决定。 */
    const update = await reconcileInstructionContext(
      agent,
      resolved,
      instructionVersions,
      fileSystem,
      {
        authorityMessages,
        scopeMessages: pending,
        includeBaselineScopes: keepVisibleBaseline,
        ...keepVisibleBaseline ? { excludedBaselineScopes } : {},
        touchedPaths,
        projectRoot,
        signal,
      },
    )
    if (update !== undefined) {
      content.push(...update.context.content)
      /* v8 ignore next -- reconciliation constructs only agent-instructions contexts. */
      if (update.context.source.kind === 'agent-instructions') {
        changes.push(...update.context.source.changes)
      }
      applyInstructionVersionUpdates(agent.session, update.versionUpdates, instructionVersions)
    }
    if (nextPreparation !== undefined) baselinePreparations.set(agent.session, nextPreparation)
    if (content.length === 0) return undefined
    return createUserMessage({
      content,
      source: {
        kind: 'agent-instructions',
        form: 'instructions',
        ...desiredBaseline ? { baseline: true } : {},
        ...desiredBaseline ? { baselineIdentity: identity } : {},
        changes,
      },
    })
  }

  /** 中文说明：上下文局部值 syncInbox，由紧邻初始化决定。 */
  const syncInbox = (agent: Agent, claimed: readonly UserMessage[], desired: UserMessage | undefined): void => {
    /** 中文说明：上下文局部值 pending，由紧邻初始化决定。 */
    const pending = agent.inbox.nextStep.filter(isWorkspaceContext)
    /** 中文说明：上下文局部值 alreadySupplied，由紧邻初始化决定。 */
    const alreadySupplied = desired !== undefined && (
      claimed.some(message => sameContextPayload(message, desired))
      || agent.session.surface.nodes.some((seq) => {
        /** 中文说明：上下文局部值 event，由紧邻初始化决定。 */
        const event = agent.session.events[seq]
        return event?.type === 'user/message' && sameContextPayload(event.data, desired)
      })
    )
    if (desired === undefined || alreadySupplied) {
      /** 中文说明：上下文局部值 message，由紧邻初始化决定。 */
      for (const message of pending) agent.inbox.remove(message.id)
      return
    }
    /** 中文说明：上下文局部值 reusable，由紧邻初始化决定。 */
    const reusable = pending.find(message => sameContextPayload(message, desired))
    if (reusable !== undefined) {
      /** 中文说明：上下文局部值 message，由紧邻初始化决定。 */
      for (const message of pending) {
        if (message !== reusable) agent.inbox.remove(message.id)
      }
      return
    }
    /** 中文说明：上下文局部值 replaced，由紧邻初始化决定。 */
    const replaced = pending[0]
    if (replaced === undefined) agent.inbox.prepend('next-step', desired)
    else agent.inbox.replace(replaced.id, desired)
    /** 中文说明：上下文局部值 message，由紧邻初始化决定。 */
    for (const message of pending.slice(1)) agent.inbox.remove(message.id)
  }

  /** 中文说明：上下文局部值 composeAndSync，由紧邻初始化决定。 */
  const composeAndSync = async (
    agent: Agent,
    signal: AbortSignal,
    claimed: readonly UserMessage[],
    touchedPaths: readonly string[] = [],
  ): Promise<void> => {
    /** 中文说明：上下文局部值 pending，由紧邻初始化决定。 */
    const pending = agent.inbox.nextStep.filter(isWorkspaceContext)
    /** 中文说明：上下文局部值 desired，由紧邻初始化决定。 */
    const desired = await compose(agent, signal, claimed, pending, touchedPaths)
    signal.throwIfAborted()
    syncInbox(agent, claimed, desired)
  }

  /** 中文说明：上下文局部值 queueProjection，由紧邻初始化决定。 */
  const queueProjection = (
    agent: Agent,
    touchedPath: string,
  ): void => {
    /** 中文说明：上下文局部值 previous，由紧邻初始化决定。 */
    const previous = projectionTails.get(agent) ?? Promise.resolve()
    /** 中文说明：上下文局部值 current，由紧邻初始化决定。 */
    const current = previous.then(() => composeAndSync(agent, projectionLifecycle.signal, [], [touchedPath]))
      .catch((error: unknown) => {
        if (!projectionLifecycle.signal.aborted) ctx.logger.warn('workspace instruction refresh failed: %o', error)
      })
    projectionTails.set(agent, current)
    void current.then(() => {
      if (projectionTails.get(agent) === current) projectionTails.delete(agent)
    })
  }

  /** 中文说明：上下文局部值 waitForProjections，由紧邻初始化决定。 */
  const waitForProjections = async (agent: Agent): Promise<void> => {
    /** 中文说明：上下文局部值 解构结果，由紧邻初始化决定。 */
    let projection: Promise<void> | undefined
    while ((projection = projectionTails.get(agent)) !== undefined) await projection
  }

  /** 中文说明：上下文局部值 stepIsOpen，由紧邻初始化决定。 */
  const stepIsOpen = (session: Session): boolean => {
    /** 中文说明：上下文局部值 known，由紧邻初始化决定。 */
    const known = openSteps.get(session)
    if (known !== undefined) return known
    /** 中文说明：上下文局部值 open，由紧邻初始化决定。 */
    let open = false
    /** 中文说明：上下文局部值 event，由紧邻初始化决定。 */
    for (const event of session.events) {
      if (event.type === 'step/start') open = true
      else if (event.type === 'step/end' || event.type === 'turn/end') open = false
    }
    openSteps.set(session, open)
    return open
  }

  /** 中文说明：上下文局部值 projectTouch，由紧邻初始化决定。 */
  const projectTouch = (touch: ProjectionTouch): void => {
    /** 中文说明：上下文局部值 session，由紧邻初始化决定。 */
    const session = touch.agent.session
    if (!stepIsOpen(session)) {
      queueProjection(touch.agent, touch.path)
      return
    }
    /** 中文说明：上下文局部值 pending，由紧邻初始化决定。 */
    const pending = stepTouches.get(session)
    if (pending === undefined) stepTouches.set(session, [touch])
    else pending.push(touch)
  }

  ctx.on('session/event', (session, event) => {
    if (event.type === 'step/start') {
      openSteps.set(session, true)
      return
    }
    if (event.type === 'turn/end') {
      openSteps.set(session, false)
      return
    }
    if (event.type !== 'step/end') return
    openSteps.set(session, false)
    /** 中文说明：上下文局部值 pending，由紧邻初始化决定。 */
    const pending = stepTouches.get(session)
    if (pending === undefined) return
    stepTouches.delete(session)
    /** 中文说明：上下文局部值 touch，由紧邻初始化决定。 */
    for (const touch of pending) queueProjection(touch.agent, touch.path)
  })

  ctx.on('agent/pre-step', async (
    { agent, messages, step, signal },
    next,
  ): Promise<PreStepDecision> => {
    /** 中文说明：上下文局部值 decision，由紧邻初始化决定。 */
    const decision = await next()
    await waitForProjections(agent)
    /** 中文说明：上下文局部值 pending，由紧邻初始化决定。 */
    const pending = agent.inbox.nextStep.filter(isWorkspaceContext)
    /** 中文说明：上下文局部值 desired，由紧邻初始化决定。 */
    const desired = await compose(agent, signal, messages, pending)
    signal.throwIfAborted()
    // An empty first entry owns a no-step turn; keep context pending instead
    // of turning it into a standalone request. Later entries may be tool continuations.
    if (decision.kind === 'reject' || (step === 1 && decision.messages.length === 0)) {
      syncInbox(agent, messages, desired)
      return decision
    }
    // A proceeding step settles the pending context: it either enters below as
    // `desired`, or its payload is already covered by the batch, so nothing stays pending.
    /** 中文说明：上下文局部值 message，由紧邻初始化决定。 */
    for (const message of pending) agent.inbox.remove(message.id)
    if (desired === undefined || decision.messages.some(message => sameContextPayload(message, desired))) {
      return decision
    }
    // Fold the context right after the claimed batch, so the direct prompt
    // precedes it and the driver-appended runtime context follows it.
    /** 中文说明：上下文局部值 lastClaimedIndex，由紧邻初始化决定。 */
    const lastClaimedIndex = decision.messages.findLastIndex(message => messages.includes(message))
    /** 中文说明：上下文局部值 entered，由紧邻初始化决定。 */
    const entered = decision.messages.toSpliced(lastClaimedIndex + 1, 0, desired)
    return { ...decision, messages: entered }
  })

  ctx.on('tools/result', (exec: ToolExecution, result: ToolExecutionResult) => {
    /** 中文说明：上下文局部值 touches，由紧邻初始化决定。 */
    const touches = executionTouches.get(exec.token) ?? []
    executionTouches.delete(exec.token)
    if (!result.isError && exec.agent !== undefined && !exec.signal.aborted) {
      /** 中文说明：上下文局部值 ownPath，由紧邻初始化决定。 */
      const ownPath = filePathFromExecution(exec)
      if (ownPath !== undefined) touches.push({ agent: exec.agent, path: ownPath })
    }
    if (exec.parent !== undefined) {
      if (touches.length > 0) {
        /** 中文说明：上下文局部值 parentTouches，由紧邻初始化决定。 */
        const parentTouches = executionTouches.get(exec.parent)
        if (parentTouches === undefined) executionTouches.set(exec.parent, touches)
        else parentTouches.push(...touches)
      }
      return
    }
    /** 中文说明：上下文局部值 touch，由紧邻初始化决定。 */
    for (const touch of touches) projectTouch(touch)
  })
}
