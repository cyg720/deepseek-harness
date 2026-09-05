/**
 * Session-visible workspace instruction state and dynamic reconciliation.
 *
 * @module @deepseek-ai/dsh-agent-instructions/state
 */

/*
 * 【文件职责】维护会话可见的工作区指令状态，按持久生产者及文件事实协调动态指令变化。
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Message } from '@deepseek-ai/dsh-llm'
import type { Session, UserMessage } from '@deepseek-ai/dsh-session'
import type { FileSystem, FsVersion } from '@deepseek-ai/dsh-fs'
import type { ResolvedConfig } from './config.ts'
import { instructionContentSha1, trimmedInstructionDigest } from './digest.ts'
import {
  ancestorChain,
  descendantDirsBetween,
  findProjectRoot,
  probeScopeInstruction,
  readScopeInstruction,
  relativeDisplay,
  /** 中文说明：类型或类 LoadedInstructionFile 约束上下文或压缩数据职责。 */
  type LoadedInstructionFile,
} from './files.ts'
import {
  candidateScopeKey,
  decodeScopeKey,
  instructionScopeKey,
  renderInstructionChanges,
  USER_GLOBAL_DIRECTORY,
  USER_GLOBAL_FILE,
  /** 中文说明：类型或类 ChangeRenderItem 约束上下文或压缩数据职责。 */
  type ChangeRenderItem,
  /** 中文说明：类型或类 AgentInstructionChange 约束上下文或压缩数据职责。 */
  type AgentInstructionChange,
} from './render.ts'

/** 中文说明：上下文局部值 name，由紧邻初始化决定。 */
export const name = 'agent-instructions'

/** Durable producer, file, and reconciliation facts for one workspace context. */
/* 中文说明：类型或类 AgentInstructionSource 约束上下文或压缩数据职责。 */
export interface AgentInstructionSource {
  kind: 'agent-instructions'
  /** Every workspace context carries instructions read out of a file (the `instructions` context form). */
  form: 'instructions'
  /** Marks the complete startup/resume baseline rather than a later delta. */
  baseline?: true
  /** Discovery, precedence, and budget identity used to validate a resumed baseline. */
  baselineIdentity?: string
  changes: AgentInstructionChange[]
}

declare module '@deepseek-ai/dsh-llm' {
  /** 中文说明：类型或类 MessageSourceMap 约束上下文或压缩数据职责。 */
  interface MessageSourceMap {
    'agent-instructions': AgentInstructionSource
  }
}

/** Per-scope metadata cache; instruction prose is deliberately not retained. */
/* 中文说明：类型或类 InstructionVersionState 约束上下文或压缩数据职责。 */
export interface InstructionVersionState {
  path: string
  version: FsVersion
  digest: string
  /**
   * Trimmed-content identity ({@link trimmedInstructionDigest}) used to suppress
   * per-directory duplicates on the metadata fast path without re-reading a sibling.
   */
  trimmedDigest: string
}

/** Session-isolated fast-path state keyed by logical instruction scope. */
/* 中文说明：类型或类 InstructionVersionCache 约束上下文或压缩数据职责。 */
export type InstructionVersionCache = WeakMap<Session, Map<string, InstructionVersionState>>

/** A metadata-cache transition associated with one rendered instruction change. */
/* 中文说明：类型或类 InstructionVersionUpdate 约束上下文或压缩数据职责。 */
export interface InstructionVersionUpdate {
  change: AgentInstructionChange
  state?: InstructionVersionState
}

/** Rendered reconciliation plus its metadata-cache transitions. */
/* 中文说明：类型或类 ReconciledInstructionContext 约束上下文或压缩数据职责。 */
export interface ReconciledInstructionContext {
  context: UserMessage
  versionUpdates: InstructionVersionUpdate[]
}

/** 中文说明：函数 workspaceContextHook 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function workspaceContextHook(text: string, changes: AgentInstructionChange[]): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'agent-instructions', form: 'instructions', changes },
  })
}

/**
 * Build the user-role message for a rendered baseline.
 * @param text - complete plugin-owned system-reminder text.
 * @returns a user-role prefix message.
 */
/*
 * 中文说明：函数 workspaceContextMessage 的参数见签名，返回结果供相邻流程使用；示例见本文件。
 * @param text 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function workspaceContextMessage(text: string): Message {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: name },
  })
}

/** 中文说明：函数 isWorkspaceContextSource 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function isWorkspaceContextSource(
  source: unknown,
): source is { kind: 'agent-instructions'; changes: unknown[] } {
  return typeof source === 'object' && source !== null
    && 'kind' in source && source.kind === 'agent-instructions'
    && 'changes' in source && Array.isArray(source.changes)
}

/** 中文说明：函数 isRecord 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 中文说明：函数 workspaceInstructionChanges 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function workspaceInstructionChanges(source: { changes: unknown[] }): AgentInstructionChange[] {
  /** 中文说明：上下文局部值 changes，由紧邻初始化决定。 */
  const changes: AgentInstructionChange[] = []
  /** 中文说明：上下文局部值 value，由紧邻初始化决定。 */
  for (const value of source.changes) {
    if (!isRecord(value)) continue
    if (value.action !== 'set' && value.action !== 'replace' && value.action !== 'remove') continue
    if (typeof value.scope !== 'string' || typeof value.path !== 'string') continue
    if (value.digest !== undefined && typeof value.digest !== 'string') continue
    changes.push({
      action: value.action,
      scope: value.scope,
      path: value.path,
      ...value.digest !== undefined ? { digest: value.digest } : {},
    })
  }
  return changes
}

/** 中文说明：函数 sameInstructionChange 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function sameInstructionChange(a: AgentInstructionChange, b: AgentInstructionChange): boolean {
  return a.action === b.action
    && a.scope === b.scope
    && a.path === b.path
    && a.digest === b.digest
}

/** 中文说明：函数 visibleInstructionChanges 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function visibleInstructionChanges(
  agent: Agent,
  authorityMessages: readonly UserMessage[],
): Map<string, AgentInstructionChange> {
  const visible = new Map<string, AgentInstructionChange>()
  for (const seq of agent.session.surface.nodes) {
    const event = agent.session.eventAt(seq)
    if (event?.type !== 'user/message' || !isWorkspaceContextSource(event.data.source)) continue
    const changes = workspaceInstructionChanges(event.data.source)
    /** 中文说明：上下文局部值 change，由紧邻初始化决定。 */
    for (const change of changes) {
      visible.set(change.scope, change)
    }
  }
  /** 中文说明：上下文局部值 message，由紧邻初始化决定。 */
  for (const message of authorityMessages) {
    if (!isWorkspaceContextSource(message.source)) continue
    /** 中文说明：上下文局部值 change，由紧邻初始化决定。 */
    for (const change of workspaceInstructionChanges(message.source)) {
      visible.set(change.scope, change)
    }
  }
  return visible
}

/**
 * Convert retained baseline files into comparison and metadata-cache state.
 * @param files - baseline files that survived rendering.
 * @returns latest baseline changes and provider versions keyed by logical scope.
 */
/*
 * 中文说明：函数 baselineInstructionState 的参数见签名，返回结果供相邻流程使用；示例见本文件。
 * @param files 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function baselineInstructionState(files: LoadedInstructionFile[]): {
  changes: Map<string, AgentInstructionChange>
  versions: Map<string, InstructionVersionState>
} {
  /** 中文说明：上下文局部值 changes，由紧邻初始化决定。 */
  const changes = new Map<string, AgentInstructionChange>()
  /** 中文说明：上下文局部值 versions，由紧邻初始化决定。 */
  const versions = new Map<string, InstructionVersionState>()
  /** 中文说明：上下文局部值 file，由紧邻初始化决定。 */
  for (const file of files) {
    /** 中文说明：上下文局部值 digest，由紧邻初始化决定。 */
    const digest = instructionContentSha1(file.content)
    /** 中文说明：上下文局部值 change，由紧邻初始化决定。 */
    const change: AgentInstructionChange = {
      action: 'set',
      scope: instructionScopeKey(file.displayPath),
      path: file.displayPath,
      digest,
    }
    changes.set(change.scope, change)
    if (file.version !== undefined) {
      versions.set(change.scope, {
        path: file.displayPath,
        version: file.version,
        digest,
        trimmedDigest: trimmedInstructionDigest(file.content),
      })
    }
  }
  return { changes, versions }
}

/** 中文说明：函数 versionStatesFor 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function versionStatesFor(session: Session, cache: InstructionVersionCache): Map<string, InstructionVersionState> {
  /** 中文说明：上下文局部值 states，由紧邻初始化决定。 */
  let states = cache.get(session)
  if (states === undefined) {
    states = new Map()
    cache.set(session, states)
  }
  return states
}

/**
 * Keep only cache updates represented by rendered changes.
 * @param updates - proposed updates from one or more reconciliations.
 * @param renderedChanges - transitions retained by the renderer.
 * @returns updates represented by an exact retained transition.
 */
/*
 * 中文说明：函数 retainedInstructionVersionUpdates 的参数见签名，返回结果供相邻流程使用；示例见本文件。
 * @param updates 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param renderedChanges 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function retainedInstructionVersionUpdates(
  updates: readonly InstructionVersionUpdate[],
  renderedChanges: readonly AgentInstructionChange[],
): InstructionVersionUpdate[] {
  return updates.filter(update => renderedChanges.some(change => sameInstructionChange(update.change, change)))
}

/**
 * Apply metadata-cache transitions without retaining instruction prose.
 * @param session - owning session.
 * @param updates - ordered set/delete transitions.
 * @param cache - session-isolated metadata cache.
 */
/*
 * 中文说明：函数 applyInstructionVersionUpdates 的参数见签名，返回结果供相邻流程使用；示例见本文件。
 * @param session 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param updates 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param cache 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 */
export function applyInstructionVersionUpdates(
  session: Session,
  updates: readonly InstructionVersionUpdate[],
  cache: InstructionVersionCache,
): void {
  if (updates.length === 0) return
  /** 中文说明：上下文局部值 states，由紧邻初始化决定。 */
  const states = versionStatesFor(session, cache)
  /** 中文说明：上下文局部值 update，由紧邻初始化决定。 */
  for (const update of updates) {
    if (update.state === undefined) states.delete(update.change.scope)
    else states.set(update.change.scope, update.state)
  }
  if (states.size === 0) cache.delete(session)
}

/** 中文说明：函数 relativeScope 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function relativeScope(projectRoot: string, dir: string): string {
  /** 中文说明：上下文局部值 scope，由紧邻初始化决定。 */
  const scope = relativeDisplay(projectRoot, dir)
  return scope.length === 0 ? '.' : scope
}

/**
 * Compare visible state with provider-visible files and render transitions.
 * @param agent - session owner whose visible surface supplies durable state.
 * @param resolved - normalized plugin configuration.
 * @param versionCache - per-session scope metadata used to skip unchanged reads.
 * @param fileSystem - provider used for current file probes.
 * @param options - authoritative claimed context, pending scope hints, touched paths, and baseline participation.
 * @returns rendered context plus deferred cache updates, or undefined when unchanged/unavailable.
 */
/*
 * 中文说明：函数 reconcileInstructionContext 的参数见签名，返回结果供相邻流程使用；示例见本文件。
 * @param agent 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param resolved 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param versionCache 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param fileSystem 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param options 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export async function reconcileInstructionContext(
  agent: Agent,
  resolved: ResolvedConfig,
  versionCache: InstructionVersionCache,
  fileSystem: FileSystem,
  options: {
    authorityMessages: readonly UserMessage[]
    scopeMessages: readonly UserMessage[]
    touchedPaths: readonly string[]
    includeBaselineScopes: boolean
    excludedBaselineScopes?: ReadonlySet<string>
    projectRoot?: string
    signal?: AbortSignal
  },
): Promise<ReconciledInstructionContext | undefined> {
  /** 中文说明：上下文局部值 session，由紧邻初始化决定。 */
  const session = agent.session
  /** 中文说明：上下文局部值 effective，由紧邻初始化决定。 */
  const effective = visibleInstructionChanges(agent, options.authorityMessages)
  /** 中文说明：上下文局部值 cwd，由紧邻初始化决定。 */
  /* v8 ignore next -- normal agents carry an absolute session cwd. */
  const cwd = session.header.cwd ?? process.cwd()
  // TODO(frozen-project-root): retain the baseline root for the loop instance;
  // recomputing it after marker edits reinterprets the existing relative scope keys.
  /** 中文说明：上下文局部值 projectRoot，由紧邻初始化决定。 */
  const projectRoot = options.projectRoot
    ?? await findProjectRoot(cwd, resolved.projectRootMarkers, fileSystem, options.signal)
  /** 中文说明：上下文局部值 scopes，由紧邻初始化决定。 */
  const scopes = new Set<string>()
  /** 中文说明：上下文局部值 baselineScopes，由紧邻初始化决定。 */
  const baselineScopes = new Set<string>()
  /** 中文说明：上下文局部值 addDirScopes，由紧邻初始化决定。 */
  const addDirScopes = (target: Set<string>, directory: string): void => {
    /** 中文说明：上下文局部值 candidate，由紧邻初始化决定。 */
    for (const candidate of resolved.instructionFileCandidates) target.add(candidateScopeKey(directory, candidate))
    /** 中文说明：上下文局部值 candidate，由紧邻初始化决定。 */
    for (const candidate of resolved.localInstructionFileCandidates) target.add(candidateScopeKey(directory, candidate))
  }
  /** 中文说明：上下文局部值 addProjectScopes，由紧邻初始化决定。 */
  const addProjectScopes = (target: Set<string>, dir: string): void => {
    addDirScopes(target, relativeScope(projectRoot, dir))
  }
  baselineScopes.add(candidateScopeKey(USER_GLOBAL_DIRECTORY, USER_GLOBAL_FILE))
  /** 中文说明：上下文局部值 dir，由紧邻初始化决定。 */
  for (const dir of ancestorChain(projectRoot, cwd)) addProjectScopes(baselineScopes, dir)
  if (options.includeBaselineScopes) {
    /** 中文说明：上下文局部值 scope，由紧邻初始化决定。 */
    for (const scope of baselineScopes) scopes.add(scope)
  }
  /** 中文说明：上下文局部值 message，由紧邻初始化决定。 */
  for (const message of options.scopeMessages) {
    /* v8 ignore next -- the plugin passes its workspace-only pending projection. */
    if (!isWorkspaceContextSource(message.source)) continue
    /** 中文说明：上下文局部值 change，由紧邻初始化决定。 */
    for (const change of workspaceInstructionChanges(message.source)) {
      if (!options.includeBaselineScopes && baselineScopes.has(change.scope)) continue
      scopes.add(change.scope)
    }
  }
  /** 中文说明：上下文局部值 scope，由紧邻初始化决定。 */
  for (const scope of effective.keys()) {
    if (!options.includeBaselineScopes && baselineScopes.has(scope)) continue
    /** 中文说明：上下文局部值 { directory }，由紧邻初始化决定。 */
    const { directory } = decodeScopeKey(scope)
    if (directory === USER_GLOBAL_DIRECTORY) scopes.add(candidateScopeKey(USER_GLOBAL_DIRECTORY, USER_GLOBAL_FILE))
    else addDirScopes(scopes, directory)
  }
  /** 中文说明：上下文局部值 touchedPath，由紧邻初始化决定。 */
  for (const touchedPath of options.touchedPaths) {
    /** 中文说明：上下文局部值 dir，由紧邻初始化决定。 */
    for (const dir of descendantDirsBetween(cwd, touchedPath)) addProjectScopes(scopes, dir)
  }

  /** 中文说明：上下文局部值 versions，由紧邻初始化决定。 */
  const versions = versionStatesFor(session, versionCache)
  /** 中文说明：上下文局部值 seenAbsolutePaths，由紧邻初始化决定。 */
  const seenAbsolutePaths = new Set<string>()
  // Per-directory trimmed-content identities kept so far this pass, iterated in
  // candidate order (base before local); a later sibling matching an earlier one
  // is a duplicate and is dropped or removed rather than rendered twice.
  /** 中文说明：上下文局部值 keptTrimmedByDir，由紧邻初始化决定。 */
  const keptTrimmedByDir = new Map<string, Set<string>>()
  /** 中文说明：上下文局部值 registerKeptTrimmed，由紧邻初始化决定。 */
  const registerKeptTrimmed = (directory: string, digest: string): boolean => {
    /** 中文说明：上下文局部值 digests，由紧邻初始化决定。 */
    let digests = keptTrimmedByDir.get(directory)
    if (digests === undefined) {
      digests = new Set()
      keptTrimmedByDir.set(directory, digests)
    }
    if (digests.has(digest)) return true
    digests.add(digest)
    return false
  }
  /** 中文说明：上下文局部值 items，由紧邻初始化决定。 */
  const items: ChangeRenderItem[] = []
  /** 中文说明：上下文局部值 versionUpdates，由紧邻初始化决定。 */
  const versionUpdates: InstructionVersionUpdate[] = []
  /** 中文说明：上下文局部值 pushRemoval，由紧邻初始化决定。 */
  const pushRemoval = (scope: string, path: string): void => {
    /** 中文说明：上下文局部值 change，由紧邻初始化决定。 */
    const change: AgentInstructionChange = { action: 'remove', scope, path }
    items.push({ change, file: { absolutePath: `removed:${scope}`, displayPath: path, content: '' } })
    versionUpdates.push({ change })
  }
  /** 中文说明：上下文局部值 scopesByDirectory，由紧邻初始化决定。 */
  const scopesByDirectory = new Map<string, string[]>()
  /** 中文说明：上下文局部值 scope，由紧邻初始化决定。 */
  for (const scope of scopes) {
    /** 中文说明：上下文局部值 { directory }，由紧邻初始化决定。 */
    const { directory } = decodeScopeKey(scope)
    /** 中文说明：上下文局部值 directoryScopes，由紧邻初始化决定。 */
    const directoryScopes = scopesByDirectory.get(directory)
    if (directoryScopes === undefined) scopesByDirectory.set(directory, [scope])
    else directoryScopes.push(scope)
  }
  /** 中文说明：上下文局部值 [directory，由紧邻初始化决定。 */
  for (const [directory, directoryScopes] of scopesByDirectory) {
    /** 中文说明：上下文局部值 probedScopes，由紧邻初始化决定。 */
    const probedScopes: string[] = []
    /** 中文说明：上下文局部值 scope，由紧邻初始化决定。 */
    for (const scope of directoryScopes) {
      if (options.excludedBaselineScopes !== undefined
        && baselineScopes.has(scope)
        && options.excludedBaselineScopes.has(scope)) {
        /** 中文说明：上下文局部值 previous，由紧邻初始化决定。 */
        const previous = effective.get(scope)
        if (previous === undefined || previous.action === 'remove') versions.delete(scope)
        else pushRemoval(scope, previous.path)
      } else {
        probedScopes.push(scope)
      }
    }
    /** 中文说明：上下文局部值 itemStart，由紧邻初始化决定。 */
    const itemStart = items.length
    /** 中文说明：上下文局部值 versionUpdateStart，由紧邻初始化决定。 */
    const versionUpdateStart = versionUpdates.length
    /** 中文说明：上下文局部值 addedAbsolutePaths，由紧邻初始化决定。 */
    const addedAbsolutePaths: string[] = []
    /** 中文说明：上下文局部值 priorVersions，由紧邻初始化决定。 */
    const priorVersions = new Map(probedScopes.map(scope => [scope, versions.get(scope)]))
    /** 中文说明：上下文局部值 scope，由紧邻初始化决定。 */
    for (const scope of probedScopes) {
      /** 中文说明：上下文局部值 previous，由紧邻初始化决定。 */
      const previous = effective.get(scope)
      /** 中文说明：上下文局部值 probe，由紧邻初始化决定。 */
      const probe = await probeScopeInstruction(scope, projectRoot, resolved, fileSystem, options.signal)
      if (probe.kind === 'unavailable') {
        if (previous === undefined || previous.action === 'remove') continue
        // Same-directory candidates form one deduplicated authority group. If an
        // active member cannot be observed, preserve the entire last-good group;
        // cache warmth must never decide whether a sibling transition is emitted.
        items.splice(itemStart)
        versionUpdates.splice(versionUpdateStart)
        /** 中文说明：上下文局部值 [candidateScope，由紧邻初始化决定。 */
        for (const [candidateScope, prior] of priorVersions) {
          if (prior === undefined) versions.delete(candidateScope)
          else versions.set(candidateScope, prior)
        }
        /** 中文说明：上下文局部值 absolutePath，由紧邻初始化决定。 */
        for (const absolutePath of addedAbsolutePaths) seenAbsolutePaths.delete(absolutePath)
        keptTrimmedByDir.delete(directory)
        break
      }
      if (probe.kind === 'absent') {
        if (previous === undefined || previous.action === 'remove') versions.delete(scope)
        else pushRemoval(scope, previous.path)
        continue
      }
      /** 中文说明：上下文局部值 { file，由紧邻初始化决定。 */
      const { file: probedFile } = probe
      if (seenAbsolutePaths.has(probedFile.absolutePath)) continue
      seenAbsolutePaths.add(probedFile.absolutePath)
      addedAbsolutePaths.push(probedFile.absolutePath)
      /** 中文说明：上下文局部值 cached，由紧邻初始化决定。 */
      const cached = versions.get(scope)
      if (
        cached !== undefined
        && cached.path === probedFile.displayPath
        && cached.version === probedFile.version
        && previous !== undefined
        && previous.action !== 'remove'
        && previous.path === cached.path
        && previous.digest === cached.digest
      ) {
        // Unchanged and previously rendered: keep it, but an earlier sibling that
        // now matches its trimmed content makes this the duplicate to remove.
        if (registerKeptTrimmed(directory, cached.trimmedDigest)) pushRemoval(scope, previous.path)
        continue
      }

      /** 中文说明：上下文局部值 file，由紧邻初始化决定。 */
      const file = await readScopeInstruction(probedFile, resolved.maxSourceBytes, fileSystem, options.signal)
      if (file === undefined) continue
      /** 中文说明：上下文局部值 currentDigest，由紧邻初始化决定。 */
      const currentDigest = instructionContentSha1(file.content)
      /** 中文说明：上下文局部值 trimmedDigest，由紧邻初始化决定。 */
      const trimmedDigest = trimmedInstructionDigest(file.content)
      if (registerKeptTrimmed(directory, trimmedDigest)) {
        // A distinct file whose trimmed content already appeared earlier in this
        // directory: drop it, removing any copy that was previously rendered.
        if (previous !== undefined && previous.action !== 'remove') pushRemoval(scope, previous.path)
        else versions.delete(scope)
        continue
      }
      /** 中文说明：上下文局部值 nextVersion，由紧邻初始化决定。 */
      const nextVersion: InstructionVersionState = {
        path: file.displayPath,
        version: probedFile.version,
        digest: currentDigest,
        trimmedDigest,
      }
      if (previous !== undefined && previous.action !== 'remove' && previous.path === file.displayPath && previous.digest === currentDigest) {
        versions.set(scope, nextVersion)
        continue
      }
      /** 中文说明：上下文局部值 action，由紧邻初始化决定。 */
      const action = previous === undefined || previous.action === 'remove' ? 'set' : 'replace'
      /** 中文说明：上下文局部值 change，由紧邻初始化决定。 */
      const change: AgentInstructionChange = {
        action,
        scope,
        path: file.displayPath,
        digest: currentDigest,
      }
      items.push({ change, file })
      versionUpdates.push({ change, state: nextVersion })
    }
  }
  if (items.length === 0) return undefined
  /** 中文说明：上下文局部值 rendered，由紧邻初始化决定。 */
  const rendered = renderInstructionChanges(items, resolved.maxBytes)
  // When no transition survived rendering (tiny budgets render notice-only
  // text), emit nothing and commit nothing — the uncommitted versions make the
  // next pass retry instead of spamming notice-only contexts.
  if (rendered.text.length === 0 || rendered.changes.length === 0) return undefined
  return {
    context: workspaceContextHook(rendered.text, rendered.changes),
    versionUpdates: retainedInstructionVersionUpdates(versionUpdates, rendered.changes),
  }
}
