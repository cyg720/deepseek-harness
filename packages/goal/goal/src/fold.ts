/** Pure replay fold and strict decoder for durable goal changes. */
/*
 * 文件职责：实现目标管理的 fold.ts 模块。
 * 技术维度：TypeScript、Cordis、会话事件、路径策略、判别联合和 Vitest。
 * 产品维度：保证目标管理操作可预测、可审计并在失败时保持一致。
 * 逻辑维度：校验输入，更新领域状态并记录事件或注册能力。
 * 关键边界：文件路径必须经过策略检查；目标引用含版本，过期修改必须拒绝。
 * 新手阅读建议：先读类型与测试夹具，再按校验、执行、事件折叠和错误流程阅读。
 */

import type { MessageSource } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { GOAL_CHANGE_VERSION, GoalId } from './runtime.ts'
import type { GoalBlockReason, GoalPhase, GoalRef, GoalSnapshot } from './types.ts'
import type {
  FoldedGoal,
  GoalChangeMeta,
  GoalClearChangeMeta,
  GoalMessageSource,
  GoalOperation,
  GoalSnapshotChangeMeta,
} from './domain.ts'

/** 中文说明：领域局部值 SNAPSHOT_OPERATIONS，由紧邻初始化决定。 */
const SNAPSHOT_OPERATIONS: ReadonlySet<Exclude<GoalOperation, 'clear'>> = new Set([
  'create',
  'edit',
  'pause',
  'resume',
  'complete',
  'block',
])
/** 中文说明：领域局部值 PHASES，由紧邻初始化决定。 */
const PHASES: ReadonlySet<GoalPhase> = new Set(['active', 'paused', 'blocked', 'complete'])

/** Mutable accumulator kept private to the pure fold. */
/* 中文说明：类型或类 GoalFoldState 约束文件或目标数据职责。 */
export interface GoalFoldState {
  goal: GoalSnapshot | undefined
  roundsStarted: number
  createdAt: number | undefined
  updatedAt: number | undefined
  lastRef: GoalRef | undefined
  seenGoalIds: Set<GoalSnapshot['id']>
}

/**
 * Build an empty replay accumulator.
 * @returns mutable state with no current goal or prior ref.
 */
/*
 * 中文说明：函数 emptyGoalFoldState 的参数见签名，返回结果供相邻流程使用；示例见本文件。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function emptyGoalFoldState(): GoalFoldState {
  return {
    goal: undefined,
    roundsStarted: 0,
    createdAt: undefined,
    updatedAt: undefined,
    lastRef: undefined,
    seenGoalIds: new Set(),
  }
}

/** Whether a value is a JSON record rather than an array. */
/* 中文说明：函数 isRecord 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Require one positive safe integer. */
/* 中文说明：函数 positiveInteger 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function positiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`goal change ${field} must be a positive safe integer`)
  }
  return value
}

/** Require one non-negative safe integer. */
/* 中文说明：函数 nonNegativeInteger 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function nonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`goal change ${field} must be a non-negative safe integer`)
  }
  return value
}

/** Decode one canonical blocker explanation. */
/* 中文说明：函数 decodeBlockReason 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function decodeBlockReason(value: unknown): GoalBlockReason {
  if (!isRecord(value) || Object.keys(value).sort().join(',') !== 'code,message') {
    throw new Error('goal change goal.blockedReason must have exactly code and message fields')
  }
  if (typeof value['code'] !== 'string' || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value['code'])) {
    throw new Error('goal change goal.blockedReason.code must be lower-kebab-case')
  }
  if (typeof value['message'] !== 'string' || value['message'].trim().length === 0
    || value['message'] !== value['message'].trim()) {
    throw new Error('goal change goal.blockedReason.message must be non-empty and normalized')
  }
  return { code: value['code'], message: value['message'] }
}

/** Decode and validate one snapshot. */
/* 中文说明：函数 decodeSnapshot 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function decodeSnapshot(value: unknown): GoalSnapshot {
  if (!isRecord(value)) throw new Error('goal change goal must be a record')
  if (typeof value['id'] !== 'string' || value['id'].length === 0) {
    throw new Error('goal change goal.id must be a non-empty string')
  }
  if (typeof value['objective'] !== 'string' || value['objective'].trim().length === 0
    || value['objective'] !== value['objective'].trim()) {
    throw new Error('goal change goal.objective must be non-empty and normalized')
  }
  if (typeof value['phase'] !== 'string' || !PHASES.has(value['phase'] as GoalPhase)) {
    throw new Error('goal change goal.phase is invalid')
  }
  /** 中文说明：领域局部值 phase，由紧邻初始化决定。 */
  const phase = value['phase'] as GoalPhase
  /** 中文说明：领域局部值 expectedKeys，由紧邻初始化决定。 */
  const expectedKeys = phase === 'blocked'
    ? 'blockedReason,id,maxGoalRounds,objective,phase,revision'
    : 'id,maxGoalRounds,objective,phase,revision'
  if (Object.keys(value).sort().join(',') !== expectedKeys) {
    throw new Error(`goal change goal for phase ${phase} must have exactly ${expectedKeys} fields`)
  }
  return {
    id: GoalId(value['id']),
    revision: positiveInteger(value['revision'], 'goal.revision'),
    objective: value['objective'],
    phase,
    maxGoalRounds: positiveInteger(value['maxGoalRounds'], 'goal.maxGoalRounds'),
    ...phase === 'blocked' ? { blockedReason: decodeBlockReason(value['blockedReason']) } : {},
  }
}

/** Decode and validate one ref. */
/* 中文说明：函数 decodeRef 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function decodeRef(value: unknown): GoalRef {
  if (!isRecord(value) || Object.keys(value).sort().join(',') !== 'id,revision') {
    throw new Error('goal clear tombstone must have exactly id and revision fields')
  }
  if (typeof value['id'] !== 'string' || value['id'].length === 0) {
    throw new Error('goal clear tombstone id must be a non-empty string')
  }
  return { id: GoalId(value['id']), revision: positiveInteger(value['revision'], 'cleared.revision') }
}

/**
 * Decode a value that declares itself as a goal change. Unrelated values
 * return `undefined`; malformed goal changes fail replay loudly.
 * @param value - candidate source change.
 * @returns validated goal change or `undefined` for another value kind.
 */
/*
 * 中文说明：函数 decodeGoalChange 的参数见签名，返回结果供相邻流程使用；示例见本文件。
 * @param value 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function decodeGoalChange(value: unknown): GoalChangeMeta | undefined {
  if (!isRecord(value) || value['kind'] !== 'goal/change') return undefined
  if (value['version'] !== GOAL_CHANGE_VERSION) {
    throw new Error(`unsupported goal change version ${String(value['version'])}`)
  }
  if (value['operation'] === 'clear') {
    /** 中文说明：领域局部值 allowed，由紧邻初始化决定。 */
    const allowed = ['cleared', 'clearedAt', 'kind', 'operation', 'version']
    if (Object.keys(value).sort().join(',') !== allowed.sort().join(',')) {
      throw new Error(`goal clear change must have exactly ${allowed.sort().join(',')} fields`)
    }
    return {
      kind: 'goal/change',
      version: GOAL_CHANGE_VERSION,
      operation: 'clear',
      cleared: decodeRef(value['cleared']),
      clearedAt: nonNegativeInteger(value['clearedAt'], 'clearedAt'),
    } satisfies GoalClearChangeMeta
  }
  if (typeof value['operation'] !== 'string'
    || !SNAPSHOT_OPERATIONS.has(value['operation'] as Exclude<GoalOperation, 'clear'>)) {
    throw new Error('goal change operation is invalid')
  }
  /** 中文说明：领域局部值 allowed，由紧邻初始化决定。 */
  const allowed = ['createdAt', 'goal', 'kind', 'operation', 'roundsStarted', 'updatedAt', 'version']
  if (Object.keys(value).sort().join(',') !== allowed.sort().join(',')) {
    throw new Error(`goal snapshot change must have exactly ${allowed.sort().join(',')} fields`)
  }
  /** 中文说明：领域局部值 createdAt，由紧邻初始化决定。 */
  const createdAt = nonNegativeInteger(value['createdAt'], 'createdAt')
  /** 中文说明：领域局部值 updatedAt，由紧邻初始化决定。 */
  const updatedAt = nonNegativeInteger(value['updatedAt'], 'updatedAt')
  if (updatedAt < createdAt) throw new Error('goal change updatedAt cannot precede createdAt')
  return {
    kind: 'goal/change',
    version: GOAL_CHANGE_VERSION,
    operation: value['operation'] as Exclude<GoalOperation, 'clear'>,
    goal: decodeSnapshot(value['goal']),
    roundsStarted: nonNegativeInteger(value['roundsStarted'], 'roundsStarted'),
    createdAt,
    updatedAt,
  } satisfies GoalSnapshotChangeMeta
}

/** Narrow model attribution to a valid goal source. */
/* 中文说明：函数 goalSource 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function goalSource(source: MessageSource): GoalMessageSource | undefined {
  if (source.kind !== 'goal') return undefined
  if (typeof source.goalId !== 'string' || source.goalId.length === 0
    || !Number.isSafeInteger(source.revision) || source.revision < 1
    || !Number.isSafeInteger(source.round) || source.round < 1) {
    throw new Error('goal message source is invalid')
  }
  return source
}

/** Require two snapshots to retain fields that only `edit` may replace. */
/* 中文说明：函数 requireSameDefinition 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function requireSameDefinition(current: GoalSnapshot, next: GoalSnapshot, operation: GoalOperation): void {
  if (next.objective !== current.objective || next.maxGoalRounds !== current.maxGoalRounds) {
    throw new Error(`goal ${operation} cannot change objective or maxGoalRounds`)
  }
}

/** Require one exact next revision of the current goal. */
/* 中文说明：函数 requireNextRevision 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function requireNextRevision(current: GoalSnapshot, next: GoalRef, operation: GoalOperation): void {
  if (next.id !== current.id || next.revision !== current.revision + 1) {
    throw new Error(`goal ${operation} must advance the current goal by one revision`)
  }
}

/** Validate one non-create snapshot operation against the preceding projection. */
/* 中文说明：函数 validateSnapshotTransition 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function validateSnapshotTransition(
  state: GoalFoldState,
  change: GoalSnapshotChangeMeta,
  current: GoalSnapshot,
): void {
  /** 中文说明：领域局部值 next，由紧邻初始化决定。 */
  const next = change.goal
  requireNextRevision(current, next, change.operation)
  /* v8 ignore next -- a current goal established by this fold always has an updatedAt */
  if (state.updatedAt === undefined) throw new Error('current goal fold lacks updatedAt')
  if (change.createdAt !== state.createdAt
    || change.updatedAt < state.updatedAt
    || change.roundsStarted !== state.roundsStarted) {
    throw new Error(`goal ${change.operation} does not preserve the current counters and timestamps`)
  }
  switch (change.operation) {
    case 'edit':
      if (next.phase !== current.phase
        || JSON.stringify(next.blockedReason) !== JSON.stringify(current.blockedReason)) {
        throw new Error('goal edit cannot change phase or blocked reason')
      }
      break
    case 'pause':
      requireSameDefinition(current, next, change.operation)
      if (current.phase !== 'active' || next.phase !== 'paused') throw new Error('goal pause has an invalid phase transition')
      break
    case 'resume': {
      requireSameDefinition(current, next, change.operation)
      /** 中文说明：领域局部值 resumable，由紧邻初始化决定。 */
      const resumable: ReadonlySet<GoalPhase> = new Set([
        'active',
        'paused',
        'blocked',
      ])
      if (!resumable.has(current.phase) || next.phase !== 'active' || state.roundsStarted >= next.maxGoalRounds) {
        throw new Error('goal resume has an invalid phase transition or exhausted round budget')
      }
      break
    }
    case 'complete':
      requireSameDefinition(current, next, change.operation)
      if (current.phase === 'complete' || next.phase !== 'complete') throw new Error('goal complete has an invalid phase transition')
      break
    case 'block':
      requireSameDefinition(current, next, change.operation)
      if (current.phase !== 'active' || next.phase !== 'blocked') throw new Error('goal block has an invalid phase transition')
      break
    /* v8 ignore start -- the caller excludes create and GoalOperation is closed; these arms retain fail-loud exhaustiveness */
    case 'create':
      throw new Error('goal create cannot be validated as a current-goal transition')
    default:
      change.operation satisfies never
      throw new Error('unknown goal snapshot operation')
    /* v8 ignore stop */
  }
}

/**
 * Return the revision identity carried by a snapshot or tombstone.
 * @param change - decoded goal mutation.
 * @returns stable identity used to reconcile a deferred change with its log event.
 */
/*
 * 中文说明：函数 goalChangeRef 的参数见签名，返回结果供相邻流程使用；示例见本文件。
 * @param change 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function goalChangeRef(change: GoalChangeMeta): GoalRef {
  return change.operation === 'clear'
    ? change.cleared
    : { id: change.goal.id, revision: change.goal.revision }
}

/**
 * Validate and apply one decoded change to a mutable accumulator.
 * @param state - preceding durable goal projection.
 * @param change - decoded full snapshot or clear tombstone.
 */
/*
 * 中文说明：函数 applyGoalChange 的参数见签名，返回结果供相邻流程使用；示例见本文件。
 * @param state 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param change 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 */
export function applyGoalChange(state: GoalFoldState, change: GoalChangeMeta): void {
  /** 中文说明：领域局部值 ref，由紧邻初始化决定。 */
  const ref = goalChangeRef(change)
  if (change.operation === 'clear') {
    /** 中文说明：领域局部值 current，由紧邻初始化决定。 */
    const current = state.goal
    if (current === undefined) throw new Error('goal clear requires a current goal')
    requireNextRevision(current, change.cleared, change.operation)
    /* v8 ignore next -- a current goal established by this fold always has an updatedAt */
    if (state.updatedAt === undefined) throw new Error('current goal fold lacks updatedAt')
    if (change.clearedAt < state.updatedAt) {
      throw new Error('goal clear timestamp cannot precede the current goal update')
    }
    state.goal = undefined
    state.roundsStarted = 0
    state.createdAt = undefined
    state.updatedAt = undefined
    state.lastRef = ref
    return
  }
  if (change.operation === 'create') {
    if (change.goal.revision !== 1 || change.goal.phase !== 'active' || change.roundsStarted !== 0
      || (state.goal !== undefined && state.goal.phase !== 'complete')
      || state.seenGoalIds.has(change.goal.id)) {
      throw new Error('goal create requires a fresh active revision-one goal with zero rounds')
    }
    state.seenGoalIds.add(change.goal.id)
  } else {
    /** 中文说明：领域局部值 current，由紧邻初始化决定。 */
    const current = state.goal
    if (current === undefined) throw new Error(`goal ${change.operation} requires a current goal`)
    validateSnapshotTransition(state, change, current)
  }
  state.goal = change.goal
  state.roundsStarted = change.roundsStarted
  state.createdAt = change.createdAt
  state.updatedAt = change.updatedAt
  state.lastRef = ref
}

/**
 * Apply one session event to the strict durable goal fold.
 * @param state - mutable fold accumulator.
 * @param event - next event in sequence order.
 */
/*
 * 中文说明：函数 applyGoalEvent 的参数见签名，返回结果供相邻流程使用；示例见本文件。
 * @param state 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param event 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 */
export function applyGoalEvent(state: GoalFoldState, event: SessionEvent): void {
  if (event.type === 'goal/change') {
    /** 中文说明：领域局部值 change，由紧邻初始化决定。 */
    const change = decodeGoalChange(event.data)
    /* v8 ignore next -- the event's declared payload always identifies itself as a goal change. */
    if (change === undefined) throw new Error(`goal change at session event ${event.seq} has an invalid kind`)
    applyGoalChange(state, change)
    return
  }
  if (event.type === 'user/message') {
    /** 中文说明：领域局部值 source，由紧邻初始化决定。 */
    const source = goalSource(event.data.source)
    if (source === undefined) return
    /** 中文说明：领域局部值 current，由紧邻初始化决定。 */
    const current = state.goal
    if (current === undefined || current.phase !== 'active' || source.goalId !== current.id
      || source.revision !== current.revision || source.round !== state.roundsStarted + 1
      || source.round > current.maxGoalRounds) {
      throw new Error(`goal round at session event ${event.seq} is not the next admitted round of the active goal`)
    }
    state.roundsStarted = source.round
  }
}

/**
 * Fold current goal state from a contiguous session event log.
 * @param events - session events in sequence order.
 * @returns a fresh durable projection; activation is deliberately absent.
 */
/*
 * 中文说明：函数 foldGoal 的参数见签名，返回结果供相邻流程使用；示例见本文件。
 * @param events 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function foldGoal(events: readonly SessionEvent[]): FoldedGoal {
  /** 中文说明：领域局部值 state，由紧邻初始化决定。 */
  const state = emptyGoalFoldState()
  /** 中文说明：领域局部值 event，由紧邻初始化决定。 */
  for (const event of events) applyGoalEvent(state, event)
  return {
    ...state.goal === undefined ? {} : { goal: { ...state.goal } },
    roundsStarted: state.roundsStarted,
    ...state.createdAt === undefined ? {} : { createdAt: state.createdAt },
    ...state.updatedAt === undefined ? {} : { updatedAt: state.updatedAt },
    ...state.lastRef === undefined ? {} : { lastRef: { ...state.lastRef } },
  }
}
