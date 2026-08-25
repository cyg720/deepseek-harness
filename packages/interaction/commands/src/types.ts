/**
 * Durable command event vocabulary and the registry's Cordis event
 * declaration, shared with type-only consumers. Client-safe: nothing here
 * reaches a Host-only symbol, so a Client compilation face reads the same
 * `commands/change` signature the Host emits.
 *
 * @module @deepseek-ai/dsh-commands/types
 */

/*
 * ================================ 文件注释 ================================
 * 【文件职责】dsh-commands 的"持久化命令事件词汇 + 注册表事件声明"，供纯类型消费方共享：
 *   命令的不可变描述（CommandDescriptor）、执行结果（CommandResult）、输入描述等。
 * 【技术维度】declaration merging 扩展 Cordis Events 与 dsh-session 的 SessionEventMap；
 *   CommandSourceMap 是"可合并扩展"的和类型，镜像 MessageSourceMap 的形状。
 * 【产品维度】command/run 与 command/done 事件按 commandId 配对，记录一次命令执行的完整
 *   生命周期——对应工具调用的 tool/call ↔ tool/result 配对，供投影单元与富命令卡片消费。
 * 【逻辑维度】输入描述 → 结果联合 → 执行对象 → 命令描述 → 来源映射 → 注册表事件 →
 *   会话生命周期事件对。
 * 【关键边界】command/run 只记录不送模型（log-only）；args 携带的是 parseCommand 的原始切分
 *   （名字 + 原样 rawInput，含分隔空白），消费方不得重新解析一行。
 * 【新手阅读建议】对照 index.ts 的 execute 方法理解两个生命周期事件如何产生与配对。
 * ==========================================================================
 */

import type { CommandId } from './brand.ts'

// 命令可选自由输入的元数据：hint 是输入框占位文案；images 声明是否允许随调用附带图片附件。
/** Immutable metadata for a command's optional unstructured input. */
export interface CommandInputDescriptor {
  /** Placeholder shown before the user supplies free-form input. */
  readonly hint: string
  /**
   * Whether composer image attachments may accompany an invocation. Absent or
   * false = the executor rejects an invocation carrying images and capable
   * composers refuse the submission before dispatch. A declaring command's
   * handler receives the admitted durable blocks and owns every further
   * grammar decision, including rejecting sub-commands that cannot use them.
   */
  readonly images?: boolean
}

// 命令预期结果：success（可带文本与更权威域事件的序号，供 UI 做富展示）或 error（必带非空文本）。
/** Expected command outcome rendered directly by the dispatching UI. */
export type CommandResult =
  | {
    readonly kind: 'success'
    readonly text?: string
    /** Earlier authoritative domain event that owns a richer presentation. */
    readonly sourceEventSeq?: number
  }
  | { readonly kind: 'error'; readonly text: string }

/**
 * One settled command execution: the handler's normalized result plus the
 * lifecycle pairing id minted for its `command/run`/`command/done` records,
 * so a dispatching surface can correlate the Remote acknowledgment with the
 * flow node those events produce.
 */
// 一次已结算的执行：handler 的规范化结果 + 本次生命周期事件的配对 id，UI 借此把远端确认与事件流节点对上。
export interface CommandExecution {
  /** Pairing id carried by this execution's lifecycle events. */
  readonly commandId: CommandId
  /** The handler's normalized outcome. */
  readonly result: CommandResult
}

// 不含 handler 的不可变命令视图，供发现类 UI（命令列表/帮助）使用。
/** Handler-free immutable command view returned to UI adapters. */
export interface CommandDescriptor {
  /** Lowercase command name without the leading slash. */
  readonly name: string
  /** Human-readable summary used in discovery UI. */
  readonly description: string
  /** Optional free-form input hint advertised to capable clients. */
  readonly input?: CommandInputDescriptor
}

/**
 * Producer record for one command invocation (the `command/run` event's
 * source slot). Merge-extensible sum type mirroring `MessageSourceMap`'s
 * shape; minimal today because every executor caller is a human-facing UI
 * surface dispatching a human-typed line, so the sole variant is `user`.
 */
// 命令发起者的来源映射（可扩展和类型）：目前只有 user——所有执行器调用方都是人在 UI 上敲的命令行。
export interface CommandSourceMap {
  user: { kind: 'user' }
}

// 来源联合：一次命令行是谁发出的。
/** The union over {@link CommandSourceMap} — who issued a command line. */
export type CommandSource = CommandSourceMap[keyof CommandSourceMap]

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A command was registered or unregistered. This is an unfiltered registry
     * notification because a global or scoped change may affect any UI view.
     * Observer failures are contained and cannot veto the registry mutation.
     * @mode emit
     */
    'commands/change'(): void
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * A resolved slash command entered its handler. Log-only (never model
     * surface); paired with `command/done` by `commandId`, mirroring the
     * `tool/call`↔`tool/result` pairing. The payload is structured — `name`
     * and `args` are `parseCommand`'s own split (name and verbatim rawInput,
     * separator whitespace included), so a consumer (a projection unit
     * folding its own command records, a rich command card) never re-parses
     * a line. `args` is absent when the definition sets `recordInput: false`
     * because an authoritative domain event owns the input payload.
     */
    'command/run': { commandId: CommandId; name: string; args?: string; source: CommandSource }
    /**
     * The paired command settled. `kind`/`text` carry the handler's verbatim
     * outcome (a thrown/aborted handler settles as `kind: 'error'` with the
     * rendered failure). A successful command may identify the earlier
     * authoritative domain event for a richer client-computed presentation.
     */
    'command/done': {
      commandId: CommandId
      kind: 'success' | 'error'
      text?: string
      sourceEventSeq?: number
    }
  }
}
