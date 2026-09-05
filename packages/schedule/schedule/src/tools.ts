/**
 * Agent-scoped Schedule management tools over the durable session fold.
 * @module @deepseek-ai/dsh-schedule
 */

/*
 * 【文件职责】提供作用域内的提醒管理工具，读取和修改均通过持久会话折叠及相应刷新屏障确认。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import {
  allocateScheduleId,
  createAfterScheduleRecord,
  createAtScheduleRecord,
  createEveryScheduleRecord,
  foldScheduleEvents,
  MIN_EVERY_INTERVAL_SECONDS,
  ScheduleId,
  ScheduleInputError,
  ScheduleLogError,
  scheduleView,
} from './domain.ts'
import { flushSchedulePersistence } from './persistence.ts'
import { runScheduleTransaction } from './transaction.ts'
import type {
  AtInput,
  PersistenceUncertainError,
  ScheduleCreateValue,
  ScheduleDeleteValue,
  ScheduleId as ScheduleIdType,
  InternalScheduleError,
  ScheduleListValue,
  SchedulePersistenceOperation,
  ScheduleRecord,
  ScheduleToolError,
} from './types.ts'

/** 中文说明：常量 SHARED_VIEW_PROPERTIES 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const SHARED_VIEW_PROPERTIES = {
  id: { type: 'string', required: true },
  prompt: { type: 'string', required: true },
  scheduledAt: { type: 'string', required: true },
  state: { type: 'string', required: true, enum: ['scheduled', 'overdue'] },
  deliveryMode: { type: 'string', required: true, const: 'session-local' },
} as const

/** 中文说明：常量 AFTER_VIEW_SCHEMA 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const AFTER_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ...SHARED_VIEW_PROPERTIES,
    kind: { type: 'string', required: true, const: 'after' },
    afterSeconds: { type: 'integer', required: true },
  },
} as const

/** 中文说明：常量 AT_VIEW_SCHEMA 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const AT_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ...SHARED_VIEW_PROPERTIES,
    kind: { type: 'string', required: true, const: 'at' },
  },
} as const

/** 中文说明：常量 EVERY_VIEW_SCHEMA 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const EVERY_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ...SHARED_VIEW_PROPERTIES,
    kind: { type: 'string', required: true, const: 'every' },
    everySeconds: { type: 'integer', required: true },
  },
} as const

/** 中文说明：常量 VIEW_SCHEMA 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const VIEW_SCHEMA = { oneOf: [AFTER_VIEW_SCHEMA, AT_VIEW_SCHEMA, EVERY_VIEW_SCHEMA] } as const

/** Build one exact two-field error schema while preserving its literal code. */
/* 中文说明：函数 basicErrorSchema 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function basicErrorSchema<const C extends string>(code: C) {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      code: { type: 'string', required: true, const: code },
      message: { type: 'string', required: true },
    },
  } as const
}

/** 中文说明：常量 BASIC_ERROR_SCHEMAS 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const BASIC_ERROR_SCHEMAS = [
  basicErrorSchema('invalid_prompt'),
  basicErrorSchema('invalid_selector'),
  basicErrorSchema('invalid_rule'),
  basicErrorSchema('invalid_time_zone'),
  basicErrorSchema('not_future'),
  basicErrorSchema('time_out_of_range'),
  basicErrorSchema('frequency_too_high'),
  basicErrorSchema('corrupt_schedule_log'),
  basicErrorSchema('internal_error'),
] as const

/** 中文说明：常量 PERSISTENCE_ERROR_SCHEMA 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const PERSISTENCE_ERROR_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    code: { type: 'string', required: true, const: 'persistence_uncertain' },
    message: { type: 'string', required: true },
    operation: { type: 'string', required: true, enum: ['create', 'list', 'delete'] },
    id: { type: 'string' },
  },
} as const

/** 中文说明：常量 ERROR_SCHEMAS 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const ERROR_SCHEMAS = [
  ...BASIC_ERROR_SCHEMAS,
  PERSISTENCE_ERROR_SCHEMA,
] as const

/** 中文说明：常量 CREATE_OUTPUT_SCHEMA 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const CREATE_OUTPUT_SCHEMA = { oneOf: [VIEW_SCHEMA, ...ERROR_SCHEMAS] } as const
/** 中文说明：常量 LIST_OUTPUT_SCHEMA 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const LIST_OUTPUT_SCHEMA = {
  oneOf: [
    { type: 'array', items: VIEW_SCHEMA },
    ...ERROR_SCHEMAS,
  ],
} as const
/** 中文说明：常量 DELETE_OUTPUT_SCHEMA 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const DELETE_OUTPUT_SCHEMA = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', required: true },
        deleted: { type: 'boolean', required: true, const: true },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', required: true },
        deleted: { type: 'boolean', required: true, const: false },
        code: { type: 'string', required: true, const: 'schedule_not_found' },
      },
    },
    ...ERROR_SCHEMAS,
  ],
} as const

/** 中文说明：常量 CREATE_DESCRIPTION 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const CREATE_DESCRIPTION =
  'Create one reminder in the current session. Supply a non-empty prompt and exactly one selector: '
  + 'a positive safe-integer after_seconds delay, at as a strict offset date-time or local '
  + `date/time object, or safe-integer every_seconds of at least ${MIN_EVERY_INTERVAL_SECONDS}. `
  + 'Fixed-rate reminders stay creation-aligned, skip missed occurrences, and batch one latest '
  + 'occurrence per overdue rule. '
  + 'Delivery is session-local: the reminder runs on time only while this session '
  + 'is live and otherwise becomes overdue until the session is resumed.'

/** 中文说明：常量 LIST_DESCRIPTION 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const LIST_DESCRIPTION =
  'List every active reminder in the current session in creation order, including its exact id, '
  + 'UTC target, scheduled or overdue state, and session-local delivery mode.'

/** 中文说明：常量 DELETE_DESCRIPTION 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const DELETE_DESCRIPTION =
  'Delete one active reminder in the current session by the exact id returned by schedule_create '
  + 'or schedule_list. Unknown or already-finished ids return deleted false.'

/** Deterministic model content for every canonical Schedule value. */
/* 中文说明：函数 renderValue 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function renderValue(_args: unknown, value: unknown): ContentBlock[] {
  // The ToolRuntime has already validated the value against the lossless-JSON output schema.
  /** 中文说明：变量 text 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const text = JSON.stringify(value)
  return [{ type: 'text', text }]
}

/** Pure generic pending card. */
/* 中文说明：函数 present 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function present(title: string, kind: 'read' | 'other', rawInput?: unknown): GenericCallView {
  return { card: 'generic', title, kind, ...rawInput === undefined ? {} : { rawInput } }
}

/** Stable error for failures not safe to expose. */
/* 中文说明：函数 internalError 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function internalError(): InternalScheduleError {
  return { code: 'internal_error', message: 'The schedule operation failed.' }
}

/** Placeholder the registry replaces with its canonical ABORTED result after body quiescence. */
/* 中文说明：函数 cancellationPlaceholder 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function cancellationPlaceholder(signal: AbortSignal): InternalScheduleError | undefined {
  return signal.aborted ? internalError() : undefined
}

/** Serialize one operation, stopping a body whose caller cancelled before its FIFO turn. */
/* 中文说明：函数 runCancellableScheduleTransaction 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function runCancellableScheduleTransaction<T>(
  agent: Agent,
  signal: AbortSignal,
  task: () => Promise<T>,
): Promise<T | InternalScheduleError> {
  return runScheduleTransaction(agent, async () => {
    /** 中文说明：变量 cancelled 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cancelled = cancellationPlaceholder(signal)
    return cancelled ?? task()
  })
}

/** Stable durable-log failure. */
/* 中文说明：函数 corruptLogError 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function corruptLogError(): ScheduleToolError {
  return { code: 'corrupt_schedule_log', message: 'The session schedule log is corrupt.' }
}

/** Stable persistence uncertainty with the known operation identity. */
/* 中文说明：函数 persistenceError 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function persistenceError(
  operation: SchedulePersistenceOperation,
  id?: ScheduleIdType,
): PersistenceUncertainError {
  return {
    code: 'persistence_uncertain',
    message: 'Schedule persistence is uncertain; retry with schedule_list before relying on this result.',
    operation,
    ...id === undefined ? {} : { id },
  }
}

/** Translate one contained input failure to the closed tool union. */
/* 中文说明：函数 inputError 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function inputError(error: ScheduleInputError): ScheduleToolError {
  return { code: error.code, message: error.message }
}

/** Fold only after a successful preflight, mapping corruption to a stable value. */
/* 中文说明：函数 foldForTool 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function foldForTool(agent: Agent): ReturnType<typeof foldScheduleEvents> | ScheduleToolError {
  try {
    return foldScheduleEvents(agent.session.ownEvents())
  } catch (error: unknown) {
    return error instanceof ScheduleLogError ? corruptLogError() : internalError()
  }
}

/** Whether a fold attempt produced an error rather than replay state. */
/* 中文说明：函数 isToolError 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function isToolError(
  value: ReturnType<typeof foldScheduleEvents> | ScheduleToolError,
): value is ScheduleToolError {
  return 'code' in value
}

/** Require one persistence checkpoint without leaking the backend failure. */
/* 中文说明：函数 preflight 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
async function preflight(
  rootCtx: Context,
  agent: Agent,
  operation: SchedulePersistenceOperation,
  id?: ScheduleIdType,
): Promise<PersistenceUncertainError | undefined> {
  try {
    await flushSchedulePersistence(rootCtx, agent.session)
    return undefined
  } catch {
    return persistenceError(operation, id)
  }
}

/** Validate the v1 selector constraints that the open parameter root cannot express. */
/* 中文说明：函数 validateCreateArgs 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function validateCreateArgs(args: {
  prompt: string
  after_seconds?: number
  at?: AtInput
  every_seconds?: number
}): ScheduleToolError | undefined {
  /** 中文说明：变量 keys 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const keys = Object.keys(args as unknown as Record<string, unknown>)
  if (keys.some(key => key !== 'prompt'
    && key !== 'after_seconds'
    && key !== 'at'
    && key !== 'every_seconds')
    || Number(args.after_seconds !== undefined)
    + Number(args.at !== undefined)
    + Number(args.every_seconds !== undefined) !== 1) {
    return {
      code: 'invalid_selector',
      message: 'schedule_create accepts exactly one of after_seconds, at, or every_seconds.',
    }
  }
  if (args.prompt.trim().length === 0) {
    return { code: 'invalid_prompt', message: 'prompt must be non-empty after trimming.' }
  }
  if (args.after_seconds !== undefined
    && (!Number.isSafeInteger(args.after_seconds) || args.after_seconds <= 0)) {
    return { code: 'invalid_rule', message: 'after_seconds must be a positive safe integer.' }
  }
  if (args.every_seconds !== undefined && !Number.isSafeInteger(args.every_seconds)) {
    return { code: 'invalid_rule', message: 'every_seconds must be a safe integer.' }
  }
  if (args.every_seconds !== undefined && args.every_seconds < MIN_EVERY_INTERVAL_SECONDS) {
    return {
      code: 'frequency_too_high',
      message: `every_seconds must be at least ${MIN_EVERY_INTERVAL_SECONDS}.`,
    }
  }
  return undefined
}

/**
 * Register all three Schedule tools in one exact agent scope.
 * @param rootCtx - Global service context owning sessions and durability.
 * @param toolCtx - Exact agent-scoped context receiving the definitions.
 * @param agent - Exact live owner whose session the tools mutate.
 * @param onDurableChange - Called after every successful preflight and again after a create or actual delete barrier succeeds.
 * @returns Idempotent aggregate disposer for the three registrations.
 */
/*
 * 中文说明：函数 registerScheduleTools 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param rootCtx 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param toolCtx 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param agent 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param onDurableChange 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function registerScheduleTools(
  rootCtx: Context,
  toolCtx: Context,
  agent: Agent,
  onDurableChange: () => void,
): () => void {
  /** 中文说明：函数值 disposers 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const disposers: Array<() => void> = []

  /** A projection observer cannot reverse a completed durability barrier. */
  /* 中文说明：函数值 notifyDurableChange 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const notifyDurableChange = (): void => {
    try {
      onDurableChange()
    } catch (error: unknown) {
      rootCtx.logger.warn(`schedule: durable-change observer failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  try {
    disposers.push(toolCtx.tools.register(defineTool({
      name: 'schedule_create',
      description: CREATE_DESCRIPTION,
      parameters: {
        prompt: {
          type: 'string',
          required: true,
          description: 'Reminder content to present when the target becomes due.',
        },
        after_seconds: {
          type: 'number',
          description: 'Positive safe-integer delay in seconds.',
        },
        every_seconds: {
          type: 'number',
          description: `Fixed-rate safe-integer interval in seconds, at least ${MIN_EVERY_INTERVAL_SECONDS}.`,
        },
        at: {
          description: 'Absolute target as strict offset RFC 3339 or local date/time with an explicit IANA zone.',
          oneOf: [
            { type: 'string' },
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                date: { type: 'string', required: true },
                time: { type: 'string', required: true },
                time_zone: { type: 'string', required: true },
              },
            },
          ],
        },
      },
      output: { schema: CREATE_OUTPUT_SCHEMA, render: renderValue },
      async execute(args, exec): Promise<ScheduleCreateValue> {
        if (exec.agent !== agent) return internalError()
        /** 中文说明：变量 invalid 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const invalid = validateCreateArgs(args)
        if (invalid !== undefined) return invalid
        return runCancellableScheduleTransaction(agent, exec.signal, async () => {
          /** 中文说明：变量 uncertain 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const uncertain = await preflight(rootCtx, agent, 'create')
          if (uncertain !== undefined) return uncertain
          notifyDurableChange()
          /** 中文说明：变量 folded 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const folded = foldForTool(agent)
          if (isToolError(folded)) return folded
          /** 中文说明：变量 id 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const id = allocateScheduleId(folded)
          /** 中文说明：变量 record 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          let record: ScheduleRecord
          try {
            if (args.at !== undefined) {
              record = createAtScheduleRecord(id, args.prompt, args.at, Date.now())
            } else if (args.after_seconds !== undefined) {
              record = createAfterScheduleRecord(id, args.prompt, args.after_seconds, Date.now())
            } else {
              record = createEveryScheduleRecord(
                id,
                args.prompt,
                args.every_seconds as number,
                Date.now(),
              )
            }
          } catch (error: unknown) {
            return error instanceof ScheduleInputError ? inputError(error) : internalError()
          }
          /** 中文说明：变量 cancelledBeforeAppend 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const cancelledBeforeAppend = cancellationPlaceholder(exec.signal)
          if (cancelledBeforeAppend !== undefined) return cancelledBeforeAppend
          try {
            agent.session.append('schedule/change', {
              version: 1,
              operation: 'create',
              schedule: record,
            })
          } catch {
            return internalError()
          }
          /** 中文说明：变量 barrier 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const barrier = await preflight(rootCtx, agent, 'create', id)
          if (barrier !== undefined) return barrier
          notifyDurableChange()
          return scheduleView(record, Date.now())
        })
      },
      presentCall: args => present('Create reminder', 'other', args.prompt),
    })))

    disposers.push(toolCtx.tools.register(defineTool({
      name: 'schedule_list',
      description: LIST_DESCRIPTION,
      parameters: {},
      output: { schema: LIST_OUTPUT_SCHEMA, render: renderValue },
      async execute(_args, exec): Promise<ScheduleListValue> {
        if (exec.agent !== agent) return internalError()
        return runCancellableScheduleTransaction(agent, exec.signal, async () => {
          /** 中文说明：变量 uncertain 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const uncertain = await preflight(rootCtx, agent, 'list')
          if (uncertain !== undefined) return uncertain
          notifyDurableChange()
          /** 中文说明：变量 folded 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const folded = foldForTool(agent)
          if (isToolError(folded)) return folded
          /** 中文说明：变量 now 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const now = Date.now()
          return folded.active.map(record => scheduleView(record, now))
        })
      },
      presentCall: () => present('List reminders', 'read'),
    })))

    disposers.push(toolCtx.tools.register(defineTool({
      name: 'schedule_delete',
      description: DELETE_DESCRIPTION,
      parameters: {
        id: { type: 'string', required: true, description: 'Exact session-local schedule id.' },
      },
      output: { schema: DELETE_OUTPUT_SCHEMA, render: renderValue },
      async execute(args, exec): Promise<ScheduleDeleteValue> {
        if (args.id.length === 0 || args.id.trim() !== args.id) {
          return { code: 'invalid_rule', message: 'schedule_delete id must be non-empty without surrounding whitespace.' }
        }
        /** 中文说明：变量 id 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const id = ScheduleId(args.id)
        if (exec.agent !== agent) return internalError()
        return runCancellableScheduleTransaction(agent, exec.signal, async () => {
          /** 中文说明：变量 uncertain 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const uncertain = await preflight(rootCtx, agent, 'delete', id)
          if (uncertain !== undefined) return uncertain
          notifyDurableChange()
          /** 中文说明：变量 folded 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const folded = foldForTool(agent)
          if (isToolError(folded)) return folded
          if (!folded.active.some(record => record.id === id)) {
            return { id, deleted: false, code: 'schedule_not_found' }
          }
          /** 中文说明：变量 cancelledBeforeAppend 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const cancelledBeforeAppend = cancellationPlaceholder(exec.signal)
          if (cancelledBeforeAppend !== undefined) return cancelledBeforeAppend
          try {
            agent.session.append('schedule/change', { version: 1, operation: 'delete', id })
          } catch {
            return internalError()
          }
          /** 中文说明：变量 barrier 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const barrier = await preflight(rootCtx, agent, 'delete', id)
          if (barrier !== undefined) return barrier
          notifyDurableChange()
          return { id, deleted: true }
        })
      },
      presentCall: args => present('Delete reminder', 'other', args.id),
    })))
  } catch (error) {
    /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
    for (const dispose of disposers.reverse()) dispose()
    throw error
  }

  /** 中文说明：变量 active 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let active = true
  return () => {
    if (!active) return
    active = false
    /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
    for (const dispose of disposers.reverse()) dispose()
  }
}
