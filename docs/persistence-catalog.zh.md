<!-- 英文源文件由 scripts/gen-persistence-catalog.ts 生成；本中文文件是通过双语配对维护的经评审对侧。
     更新时先运行 `pnpm run gen-persistence-catalog` 更新英文，再更新本文件并运行 `pnpm run verify-translation-pairing --write docs/persistence-catalog.md` 重新记录配对。 -->

# 会话持久化事件目录

[English](persistence-catalog.md) | 中文

会话持久事件日志中可能出现的所有事件类型：完整持久化的 `SessionEvent` 信封，以及可通过合并扩展的 `SessionEventMap` 中的每个成员，包括 `@deepseek-ai/dsh-session` 所属的词汇和本仓库中每个插件对 `@deepseek-ai/dsh-session/types` 的声明合并，并附有源 JSDoc、完整 payload 声明、surface 标记和声明位置。本文档是 [session.md](subsystems/session.zh.md)（surface 排序与 `deriveMessages()` 投影）、[persistence.md](subsystems/persistence.zh.md)（如何让日志持久化）和 [session.md](subsystems/session.zh.md#cordis-surface) 中生成区域（实时总线接线；日志事件**不是** cordis 事件，它通过唯一的 `session/event` emit 到达监听器）的补充。

英文源文件根据源码生成（`scripts/gen-persistence-catalog.ts`），并由 `pnpm run verify-persistence-catalog`（`doc-sync`（文档同步门禁）的一部分）验证新鲜度；本中文文件作为经评审对侧通过双语配对维护。声明块保留源码声明和嵌套属性的 JSDoc，只移除其所在接口／模块带来的缩进，并使用 `ts persistence-catalog` 围栏（doc-typecheck 会跳过这些围栏，因为声明引用了其所属模块中的类型）。payload 中的类型名称会链接到记录该类型的页面。参见 [persistence-log-catalog Agent Note](../.agents/notes/archived/process/2026-07-04-persistence-log-catalog.md)。

以下信封声明组合了每个事件的 `type`、单调递增的 `seq`、以 epoch 毫秒表示的 `time`、`data`、可选的未知类型跳过标记 `ignorable`，以及条件字段 `surfaceOp`／`sourceEventSeqs`。**surface** 表示 `SurfaceEventType` 成员：它会生成一条 LLM（大语言模型）消息，并声明该事件如何加入 surface 列表。**log-only** 表示其他所有事件：这类记录可持久化、可回放，但不参与派生历史。每个 payload 均可进行 JSON 序列化（在 `Session.append` 处强制执行），整个格式固定为 `SESSION_FORMAT_VERSION = 0`：这是预发布格式，不暗示任何兼容性（参见[版本立场](subsystems/persistence.zh.md)）。范围仅限本仓库中的包；下游插件可以继续合并其他事件类型，而这些类型按设计不属于本目录。

## 事件信封

```ts persistence-catalog
/** The appendable event-type keys of {@link SessionEventMap}, plugin-merged extensions included. */
/* {@link SessionEventMap} 全部可追加的事件类型键（含插件声明合并进来的扩展）。 */
export type SessionEventType = keyof SessionEventMap

/**
 * The subset of {@link SessionEventType} values whose events produce LLM
 * messages and are eligible to appear on the ordered surface. Only these
 * event types may carry {@link SurfaceOp} and {@link SessionEvent.sourceEventSeqs}.
 */
/*
 * {@link SessionEventType} 中“会产生 LLM 消息、因而有资格进入有序表面”的那部分事件类型。
 * 也只有它们可以携带 {@link SurfaceOp} 与 {@link SessionEvent.sourceEventSeqs}。
 */
export type SurfaceEventType =
  | 'user/message'
  | 'assistant/message'
  | 'tool/result'

/**
 * How a session event entered the ordered surface. Only valid on
 * {@link SurfaceEventType} events.
 *
 * - `'append'`: added to the tail — normal path for user/assistant/tool
 *   messages.
 * - `{ op: 'replace', start, end }`: replaces surface nodes from `start`
 *   (inclusive) through `end` (inclusive) with this node. Both must exist as
 *   surface nodes in the current surface. `start === end` replaces a single
 *   node. The node's {@link SessionEvent.sourceEventSeqs} must include every
 *   shadowed surface node. Used by compaction; any surface-replacing producer
 *   may use it.
 */
/*
 * 一个会话事件如何进入有序表面（仅对表面事件类型合法）：
 * - 'append'：追加到尾部——用户/助手/工具消息的正常路径；
 * - { op:'replace', start, end }：用本节点替换表面上 [start, end]（闭区间）内的既有节点，
 *   start 与 end 都必须已是当前表面上的节点；start === end 即替换单个节点；
 *   本事件的 {@link SessionEvent.sourceEventSeqs} 必须涵盖全部被遮蔽的表面节点。
 * compaction（历史压缩）使用它；任何产生表面替换的生产者也可使用。
 */
export type SurfaceOp =
  | 'append'
  | { op: 'replace'; start: number; end: number }

/**
 * One immutable entry in the session log.
 *
 * A proper discriminated union over `type` (not independent `type`/`data`
 * unions), so `switch (event.type)` narrows `event.data` without casts.
 *
 * The {@link sourceEventSeqs} and {@link surfaceOp} fields are conditional:
 * they only exist on {@link SurfaceEventType} variants (`user/message`,
 * `assistant/message`, `tool/result`).
 * Non-surface events (boundary markers, chunks, usage, errors) never carry
 * surface metadata — the compiler enforces this at `Session.append()`
 * call sites.
 */
/*
 * 会话日志中的一条不可变条目。
 * 这是按 type 划分的正规判别联合（而非独立的 type/data 两个联合），
 * 因此 switch (event.type) 无需类型断言即可收窄 event.data。
 * {@link sourceEventSeqs} 与 {@link surfaceOp} 是条件字段：只存在于三类表面事件变体上；
 * 非表面事件（边界标记、chunk、usage、错误）永不携带表面元数据——编译器在
 * Session.append() 调用点强制这一点。
 */
export type SessionEvent<T extends SessionEventType = SessionEventType> = {
  [K in SessionEventType]: {
    type: K
    /** Monotonic sequence number within the session. */
    // 会话内单调递增的序号；恒等于追加时日志的长度。
    seq: number
    /** Unix epoch milliseconds. */
    // Unix 纪元毫秒时间戳（事件写入时刻）。
    time: number
    // 事件载荷，形状由 SessionEventMap 中该类型的成员决定。
    data: SessionEventMap[K]
    /**
     * Marks an event a reader may safely skip when it does not recognize
     * `type`. Absent means required: a reader meeting an unrecognized type
     * without this marker MUST refuse to reconstruct the session instead of
     * silently dropping the event, because an unrecognized required event may
     * change how the rest of the log is interpreted. A writer sets `true` only
     * on purely informational records whose loss cannot affect reconstruction;
     * defaulting to required means a forgotten marker over-refuses (an
     * inconvenience) rather than silently resuming a gutted session.
     */
    /*
     * 标记“读者不认识该 type 时可以安全跳过”。缺省即必需：读到不认识的必需事件必须拒绝重建会话，
     * 而不是悄悄丢弃——因为不认识的必需事件可能改变日志其余部分的解读方式。写方只在纯资讯性记录上
     * 设 true（丢失它不可能影响重建）。默认必需意味着漏写标记只会导致“过度拒绝”（麻烦一点），
     * 而不是静默地续读一个被掏空的会话。
     */
    ignorable?: true
  } & (K extends SurfaceEventType ? {
    /**
     * Seq numbers of earlier events that this event cites as sources
     * (e.g. the `assistant/chunk` seqs that built an `assistant/message`,
     * or the surface nodes shadowed by a compaction replace node). An
     * `assistant/message` may carry a present empty array for a known empty
     * provider stream; when the field is absent, the event does not record which
     * earlier events produced the message.
     */
    /*
     * 本事件引用为来源的更早事件的 seq 集合（例如拼出 assistant/message 的那些
     * assistant/chunk 的 seq，或被 compaction 替换节点遮蔽的表面节点）。
     * assistant/message 可用显式空数组表示已知为空的提供方流；缺省则不记录来源。
     */
    sourceEventSeqs?: number[]
    /** How this event entered the surface; absent for non-surface events. */
    /* 本事件进入表面的方式；非表面事件缺省。 */
    surfaceOp?: SurfaceOp
  } : object)
}[T]
```

来源：[`packages/core/session/src/types.ts:340`](../packages/core/session/src/types.ts) · [`packages/core/session/src/types.ts:347`](../packages/core/session/src/types.ts) · [`packages/core/session/src/types.ts:376`](../packages/core/session/src/types.ts) · [`packages/core/session/src/types.ts:408`](../packages/core/session/src/types.ts)

## 事件

### `agent/*`

<a id="agentinboxspliced--log-only"></a>

#### `agent/inbox/spliced` — log-only

```ts persistence-catalog
/**
 * One normalized mutation of an agent's durable pending-message lists.
 * Live dispatch precedes projection mutation, so synchronous observers may
 * read the pre-splice inbox to recover the removed messages.
 */
'agent/inbox/spliced': {
  target: InboxTarget
  start: number
  removedCount?: number
  inserted: UserMessage[]
  outcome?: 'canceled'
}
```

来源：[`packages/core/agent/src/types.ts:19`](../packages/core/agent/src/types.ts)

### `agent-preset/*`

<a id="agent-presetselected--log-only"></a>

#### `agent-preset/selected` — log-only

```ts persistence-catalog
/**
 * The session's agent preset was chosen after creation, while the session
 * was still blank. Log-only: it records the composition later turns ran
 * under, so a resumed or forked session rebuilds the same one instead of
 * the header's creation-time value.
 */
/* 会话仍为空白时选择的新预设，用于之后恢复相同的代理组合。 */
'agent-preset/selected': { agentPreset: string }
```

来源：[`packages/preset/agent-presets/src/session.ts:26`](../packages/preset/agent-presets/src/session.ts)

### `approval/*`

<a id="approvalasked--log-only"></a>

#### `approval/asked` — log-only

```ts persistence-catalog
/**
 * An approval question was put to the answerer chain — log-only audit
 * (like `hook/*`; NOT a surface event, carries no `surfaceOp`). `id` pairs
 * it with the `approval/decided` that always follows; `toolName` is the
 * tool the question is about, `callId` the exact tool call when the asker
 * had one, `reason` the asker's human-readable explanation (e.g. a hook's
 * permission-decision reason).
 */
'approval/asked': {
  id: ApprovalRequestId
  toolName: string
  callId?: CallId
  reason?: string
}
```

类型：[CallId](subsystems/core.zh.md)

来源：[`packages/interaction/user-approval/src/index.ts:44`](../packages/interaction/user-approval/src/index.ts)

<a id="approvaldecided--log-only"></a>

#### `approval/decided` — log-only

```ts persistence-catalog
/**
 * The outcome of a prior `approval/asked` (same `id`) — log-only audit.
 * Exactly one per ask, appended when the outcome is known: a decision, a
 * cancellation, or the fail-closed `'unavailable'`.
 */
'approval/decided': {
  id: ApprovalRequestId
  outcome: ApprovalOutcome
}
```

来源：[`packages/interaction/user-approval/src/index.ts:55`](../packages/interaction/user-approval/src/index.ts)

<a id="approvalpolicy--log-only"></a>

#### `approval/policy` — log-only

```ts persistence-catalog
/**
 * The session's approval policy was switched — log-only, durable,
 * replayable, never in the model transcript (the model learns the policy
 * from the runtime-context snapshot and live switch notices). The LAST
 * such event is the session's override ({@link effectiveApprovalPolicy}).
 * `source: 'delegation'` marks an override seeded into a child; an absent
 * source is a runtime switch.
 */
'approval/policy': {
  policy: ApprovalPolicy
  /** Marks an override seeded into a child at delegation. */
  source?: 'delegation'
}
```

来源：[`packages/interaction/user-approval/src/index.ts:67`](../packages/interaction/user-approval/src/index.ts)

### `assistant/*`

<a id="assistantchunk--log-only"></a>

#### `assistant/chunk` — log-only

```ts persistence-catalog
/** Raw stream chunk — token-level replay fidelity. */
/* 原始流块——保证 token 级重放保真的数据。 */
'assistant/chunk': { turn: number; step: number; chunk: StreamChunk }
```

类型：[StreamChunk](subsystems/llm-streaming.zh.md)

来源：[`packages/core/session/src/types.ts:266`](../packages/core/session/src/types.ts)

<a id="assistantmessage--surface"></a>

#### `assistant/message` — surface

```ts persistence-catalog
/**
 * Assembled assistant message for one step (derived history uses this).
 * Carries the step's `usage` when the adapter reported token accounting, so
 * the model output and its accounting travel together (there is no separate
 * usage record). `usage` is absent when the adapter reported none. A turn
 * cancelled mid-stream finalizes its delivered text/reasoning prefix as this
 * event with `interrupted: true`; undispatched tool calls are absent. The
 * marker distinguishes that prefix without re-deriving interruption from turn
 * boundaries. An aborted turn with no such event streamed no visible content.
 */
/*
 * 一步组装完成的 assistant 消息（派生历史使用它）。适配器报告了 token 统计
 * 就随事件携带 usage（没有单独的用量记录，输出与账目同行）。中途取消的轮次
 * 会把已送达的文本/推理前缀以此事件落盘并标 interrupted: true，未派发的
 * 工具调用不会出现——该标记无需从轮次边界重新推断中断。被中止的轮次若没有
 * 此事件，说明没有流出任何可见内容。
 */
'assistant/message': { turn: number; step: number; message: AssistantMessage; usage?: TokenUsage; interrupted?: true }
```

类型：[TokenUsage](subsystems/llm-streaming.zh.md)

来源：[`packages/core/session/src/types.ts:277`](../packages/core/session/src/types.ts)

### `command/*`

<a id="commanddone--log-only"></a>

#### `command/done` — log-only

```ts persistence-catalog
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
```

来源：[`packages/interaction/commands/src/types.ts:103`](../packages/interaction/commands/src/types.ts)

<a id="commandrun--log-only"></a>

#### `command/run` — log-only

```ts persistence-catalog
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
```

来源：[`packages/interaction/commands/src/types.ts:96`](../packages/interaction/commands/src/types.ts)

### `compaction/*`

<a id="compactionend--log-only"></a>

#### `compaction/end` — log-only

```ts persistence-catalog
/**
 * Marks the end of a compaction — log-only, releases the lock. Its owner
 * matches `compaction/start`; `error` records an unsuccessful attempt.
 */
'compaction/end': { compactionId: CompactionId; sourceCommandId?: CommandId; turn: number | null; error?: string }
```

来源：[`packages/compaction/compaction/src/types.ts:71`](../packages/compaction/compaction/src/types.ts)

<a id="compactionprune--log-only"></a>

#### `compaction/prune` — log-only

```ts persistence-catalog
/**
 * Shadow price of one model-free prune replacement — log-only, no
 * surfaceOp. The shared shadow-price protocol: a surface `replace` event
 * is priced by the metering event immediately before it (`compaction/summary`
 * for a summarizing compaction, this event for a prune), which states the
 * heuristic token price of the exact replaced range so a pure consumer
 * can subtract it without retaining per-node prices. The replacement MUST
 * be appended synchronously right after this event.
 */
'compaction/prune': {
  /** The replaced range's first and last surface-node seqs (a surface-position span, like {@link CompactionResult.shadowedRange}). */
  shadowedRange: { start: number; end: number }
  /** The seqs of all shadowed surface nodes, in surface order. */
  shadowedSeqs: number[]
  /** Heuristic price of the shadowed content under the token-meter's fixed estimator. */
  shadowedTokenCount: number
}
```

来源：[`packages/compaction/compaction/src/types.ts:81`](../packages/compaction/compaction/src/types.ts)

<a id="compactionstart--log-only"></a>

#### `compaction/start` — log-only

```ts persistence-catalog
/**
 * Marks the start of a compaction — log-only, holds the lock until
 * `compaction/end`. A numbered owner is strictly enclosed by that open turn;
 * `null` identifies a standalone manual transaction between turns.
 */
'compaction/start': { compactionId: CompactionId; sourceCommandId?: CommandId; turn: number | null }
```

来源：[`packages/compaction/compaction/src/types.ts:23`](../packages/compaction/compaction/src/types.ts)

<a id="compactionsummary--log-only"></a>

#### `compaction/summary` — log-only

```ts persistence-catalog
/**
 * Completed summary, its inputs, and its model call facts — log-only, no surfaceOp.
 * The summary content is in `data.summary`; the actual surface replacement
 * is performed by the immediately following `user/message` event that
 * shadows the compacted range. That adjacency is contractual — the
 * shadowed pricing fields are the replacement's shadow price, so a
 * consumer may pair a replacement with the metering event directly
 * before it (`compaction/prune` documents the shared protocol).
 */
'compaction/summary': {
  compactionId: CompactionId
  sourceCommandId?: CommandId
  summary: ContentBlock[]
  shadowedRange: { start: number; end: number }
  shadowedSeqs: number[]
  shadowedTokenCount: number
  /** The provider route that wrote the summary. */
  provider: string
  /**
   * The model that wrote the summary — the summarize call's envelope,
   * reported by the backend that made the call, logged so the one-shot
   * request is reconstructable from log + code and "which model wrote
   * this summary" has a durable answer (the reconstructability Agent Note).
   */
  model: string
  /** The generation cap the summarize call sent, when one applied. */
  maxTokens?: number
  /** Provider-reported token usage for the summarization request, when emitted. */
  usage?: TokenUsage
} & (
  | {
    /** Complete provider output before the backend's safe summary projection. */
    rawOutput: ContentBlock[]
    /** Identifies exactly one call through this context's `ctx.llm.stream()`. */
    llmStreamCall: true
  }
  | {
    /** Optional complete output from an unmarked template, remote, or other summarizer. */
    rawOutput?: ContentBlock[]
    /** An unmarked summary does not identify a call through this context's LLM seam. */
    llmStreamCall?: never
  }
)
```

类型：[ContentBlock](subsystems/core.zh.md) · [TokenUsage](subsystems/llm-streaming.zh.md)

来源：[`packages/compaction/compaction/src/types.ts:33`](../packages/compaction/compaction/src/types.ts)

### `feedback/*`

<a id="feedbackrecord--log-only"></a>

#### `feedback/record` — log-only

```ts persistence-catalog
/**
 * One recorded human remark about this session. Log-only and independent
 * of its trigger; it never enters model context or derived history.
 */
'feedback/record': { text: string }
```

来源：[`packages/feedback/command-feedback/src/index.ts:62`](../packages/feedback/command-feedback/src/index.ts)

### `goal/*`

<a id="goalchange--log-only"></a>

#### `goal/change` — log-only

```ts persistence-catalog
/**
 * Complete post-mutation goal state or clear tombstone.
 */
'goal/change': GoalChangeMeta
```

来源：[`packages/goal/goal/src/domain.ts:66`](../packages/goal/goal/src/domain.ts)

### `hook/*`

<a id="hookinvoked--log-only"></a>

#### `hook/invoked` — log-only

```ts persistence-catalog
/**
 * A hook command was invoked at a hook point — a log-only record (like
 * `compaction/*`; NOT a {@link SurfaceEventType}, carries no `surfaceOp`).
 * `dialect` is the bridge that ran it (`claude`/`codex`), `point`
 * the hook point (`PreToolUse`, `Stop`, …), `matcher` the matcher-group
 * pattern that selected it (absent for match-all), `handlerId` a stable id
 * for the command (so an invoked/result pair correlates). `turn` is the open
 * turn the invocation lives inside.
 */
'hook/invoked': {
  turn: number
  point: string
  dialect: HookDialect
  matcher?: string
  handlerId: string
}
```

来源：[`packages/hooks/hook-protocol/src/types.ts:19`](../packages/hooks/hook-protocol/src/types.ts)

<a id="hookresult--log-only"></a>

#### `hook/result` — log-only

```ts persistence-catalog
/**
 * Log-only outcome paired to `hook/invoked` by `handlerId`. Decision is the
 * parsed permission result, `stop` for `continue:false`, or `pass`; exit code
 * may be absent, stderr is bounded, and duration is wall-clock runtime.
 */
'hook/result': {
  turn: number
  point: string
  handlerId: string
  decision: string
  exitCode?: number
  stderrSummary?: string
  durationMs: number
}
```

来源：[`packages/hooks/hook-protocol/src/types.ts:31`](../packages/hooks/hook-protocol/src/types.ts)

### `llm/*`

<a id="llmretry--log-only"></a>

#### `llm/retry` — log-only

```ts persistence-catalog
/** Durable, non-surface record of one provider-routed retry scheduled after a failed request attempt. */
// 中文：一次请求尝试失败后、按 provider 路由调度重试的持久（非展示面）记录。
'llm/retry': LlmRetryEventData
```

来源：[`packages/llm/llm-retry/src/types.ts:9`](../packages/llm/llm-retry/src/types.ts)

<a id="llmretry-started--log-only"></a>

#### `llm/retry-started` — log-only

```ts persistence-catalog
/** Durable transition written after a retry wait succeeds and before the next request attempt starts. */
// 中文：重试等待成功、下一次请求尝试开始之前写入的持久转换记录。
'llm/retry-started': LlmRetryStartedEventData
```

来源：[`packages/llm/llm-retry/src/types.ts:11`](../packages/llm/llm-retry/src/types.ts)

### `permission/*`

<a id="permissionpreset--log-only"></a>

#### `permission/preset` — log-only

```ts persistence-catalog
/**
 * Records the selected preset as durable, log-only user intent. The knob
 * events follow in the same turn and control execution; this event stays
 * out of the model transcript and lets {@link effectivePermissionPreset}
 * preserve a selection when bundles match.
 */
'permission/preset': { preset: string }
```

来源：[`packages/interaction/permission-presets/src/index.ts:50`](../packages/interaction/permission-presets/src/index.ts)

### `plan/*`

<a id="planmode--log-only"></a>

#### `plan/mode` — log-only

```ts persistence-catalog
/**
 * Whether plan mode is in force from this point on: log-only, non-surface,
 * whole-value replace. The last `plan/mode` wins; a log with none folds to
 * inactive through {@link foldPlanMode}.
 */
'plan/mode': { active: boolean }
```

来源：[`packages/plan/plan-mode/src/index.ts:53`](../packages/plan/plan-mode/src/index.ts)

### `request/*`

<a id="requestcontext--log-only"></a>

#### `request/context` — log-only

```ts persistence-catalog
/**
 * Route metadata for the next request, logged only when the route or capacity
 * changes. It does not participate in request reconstruction or header equality.
 */
/* 下一次请求的路由元数据；仅在路由或容量变化时记录。不参与请求重建，也不参与头部相等性比较。 */
'request/context': RequestContext
```

来源：[`packages/core/session/src/types.ts:313`](../packages/core/session/src/types.ts)

<a id="requestheader--log-only"></a>

#### `request/header` — log-only

```ts persistence-catalog
/**
 * Full header for the next request, appended inside its step before dispatch.
 * It is log-only; the latest snapshot reconstructs the request header.
 */
/* 下一次请求的完整头部，在其 step 内、派发之前追加。仅供日志使用；最新一份快照即重建结果。 */
'request/header': { header: EpochHeader; reason: RequestHeaderReason }
```

来源：[`packages/core/session/src/types.ts:308`](../packages/core/session/src/types.ts)

### `sandbox/*`

<a id="sandboxmode--log-only"></a>

#### `sandbox/mode` — log-only

```ts persistence-catalog
/**
 * The session's sandbox mode was switched — log-only (like `approval/*`;
 * NOT a surface event, carries no `surfaceOp`): durable and replayable,
 * never in the model transcript. The LAST such event is the session's
 * override ({@link effectiveSandboxMode}). `source: 'delegation'` marks
 * an override seeded into a child; an absent source is a runtime switch.
 */
'sandbox/mode': {
  mode: SandboxMode
  /** Marks an override seeded into a child at delegation. */
  source?: 'delegation'
}
```

来源：[`packages/sandbox/sandbox-policy/src/session-mode.ts:33`](../packages/sandbox/sandbox-policy/src/session-mode.ts)

### `schedule/*`

<a id="schedulechange--log-only"></a>

#### `schedule/change` — log-only

```ts persistence-catalog
/**
 * Versioned Schedule mutation. The owning package validates the complete
 * session-local transition stream before accepting a candidate event.
 */
'schedule/change': ScheduleChange
```

类型：[ScheduleChange](subsystems/schedule.zh.md)

来源：[`packages/schedule/schedule/src/types.ts:219`](../packages/schedule/schedule/src/types.ts)

### `session/*`

<a id="sessionend-seed--log-only"></a>

#### `session/end-seed` — log-only

```ts persistence-catalog
/**
 * Marks the end of a constructor seed. Events before it have smaller seq
 * values and came from the seed (resume, fork, or replay); this lifecycle
 * produced none of them. This log-only event is the durable projection of
 * {@link Session.firstLiveSeq}. Its payload is empty — position and `time`
 * carry the meaning.
 *
 * Locate the LAST one in stored history. A seed already ending in one is not
 * re-marked, so reopening an untouched session does not grow its log per
 * pickup and the event need not be at the current `firstLiveSeq`.
 *
 * `Session`'s constructor is the only legitimate writer. The invariant
 * companion deliberately constrains nothing here, so a plugin appending one
 * would silently classify every live bracket before it as seed history.
 *
 * An owner of a standalone open/close bracket (`compaction/start` …
 * `compaction/end`) reads it because seed history and live work are otherwise
 * byte-identical: an unmatched opening marker before this event belongs to
 * an ended lifecycle, whatever ended it. NOT a liveness signal about other
 * writers — a concurrently live session holds its own boundary elsewhere,
 * so tolerating concurrent writers needs a signal beyond the log.
 */
/*
 * 标记构造种子的终点：它之前（seq 更小）的事件都来自种子（resume/fork/replay），
 * 本生命周期从未产生过它们。这是 Session.firstLiveSeq 在日志中的持久化投影，
 * 载荷为空——位置和时间本身就是含义。读取存储历史时应定位“最后一条”该事件：
 * 种子若已以其结尾则不再重复标注，避免每次打开未动过的会话都让日志增长。
 * 只有 Session 的构造函数有权写入此事件。
 */
'session/end-seed': Record<string, never>
```

来源：[`packages/core/session/src/types.ts:336`](../packages/core/session/src/types.ts)

<a id="sessiontitle--log-only"></a>

#### `session/title` — log-only

```ts persistence-catalog
/**
 * Latest-wins session title snapshot. Log-only: it never enters the model
 * surface or derived history.
 */
'session/title': SessionTitleEventData
```

类型：[SessionTitleEventData](subsystems/session-title.zh.md)

来源：[`packages/session/session-title/src/index.ts:100`](../packages/session/session-title/src/index.ts)

<a id="sessiontitle-llm-request--log-only"></a>

#### `session/title-llm-request` — log-only

```ts persistence-catalog
/** Log-only pre-dispatch record of one session-title model request. */
'session/title-llm-request': SessionTitleLlmRequestEventData
```

类型：[SessionTitleLlmRequestEventData](subsystems/session-title.zh.md)

来源：[`packages/session/session-title-llm/src/index.ts:43`](../packages/session/session-title-llm/src/index.ts)

### `step/*`

<a id="stepend--log-only"></a>

#### `step/end` — log-only

```ts persistence-catalog
/** Closes step `step` of turn `turn`. */
/* 关闭第 turn 轮的第 step 步。 */
'step/end': { turn: number; step: number }
```

来源：[`packages/core/session/src/types.ts:256`](../packages/core/session/src/types.ts)

<a id="stepstart--log-only"></a>

#### `step/start` — log-only

```ts persistence-catalog
/** Opens step `step` of turn `turn` — one model call plus the tool executions it requested. */
/* 打开第 turn 轮的第 step 步——一次模型调用加上它要求的全部工具执行。 */
'step/start': { turn: number; step: number }
```

来源：[`packages/core/session/src/types.ts:254`](../packages/core/session/src/types.ts)

### `subagent/*`

<a id="subagentdescriptor--log-only"></a>

#### `subagent/descriptor` — log-only

```ts persistence-catalog
/**
 * Durable identity and lifecycle mode of a session-backed subagent child,
 * appended once by the establishing provider inside the child's initial
 * turn, before its first request. Continuable records also carry their
 * resumable composition. Log-only: it carries no `surfaceOp`, never enters
 * model history, and survives compaction.
 */
'subagent/descriptor': SubagentDescriptorData
```

来源：[`packages/subagent/subagent/src/descriptor.ts:37`](../packages/subagent/subagent/src/descriptor.ts)

### `team/*`

<a id="teammember--log-only"></a>

#### `team/member` — log-only

```ts persistence-catalog
/** Whole teammate lifecycle value, stored only in the Team Lead Session. */
'team/member': { version: 1; teamId: TeamId; member: TeamMemberSnapshot }
```

类型：[TeamId](subsystems/agent-team.zh.md) · [TeamMemberSnapshot](subsystems/agent-team.zh.md)

来源：[`packages/experimental/agent-team/src/types.ts:206`](../packages/experimental/agent-team/src/types.ts)

<a id="teammessagedelivered--log-only"></a>

#### `team/message/delivered` — log-only

```ts persistence-catalog
/** Durable acknowledgement that the target Session recorded the message. */
'team/message/delivered': {
  version: 1
  teamId: TeamId
  messageId: TeamMessageId
  targetId: SessionId
}
```

类型：[TeamId](subsystems/agent-team.zh.md) · [TeamMessageId](subsystems/agent-team.zh.md)

来源：[`packages/experimental/agent-team/src/types.ts:212`](../packages/experimental/agent-team/src/types.ts)

<a id="teammessagequeued--log-only"></a>

#### `team/message/queued` — log-only

```ts persistence-catalog
/** Durable mailbox enqueue, stored before delivery is attempted. */
'team/message/queued': { version: 1; teamId: TeamId; message: TeamMessageSnapshot }
```

类型：[TeamId](subsystems/agent-team.zh.md) · [TeamMessageSnapshot](subsystems/agent-team.zh.md)

来源：[`packages/experimental/agent-team/src/types.ts:210`](../packages/experimental/agent-team/src/types.ts)

<a id="teamtask--log-only"></a>

#### `team/task` — log-only

```ts persistence-catalog
/** Whole shared-task value, stored only in the Team Lead Session. */
'team/task': { version: 1; teamId: TeamId; task: TeamTaskSnapshot }
```

类型：[TeamId](subsystems/agent-team.zh.md) · [TeamTaskSnapshot](subsystems/agent-team.zh.md)

来源：[`packages/experimental/agent-team/src/types.ts:208`](../packages/experimental/agent-team/src/types.ts)

### `todo/*`

<a id="todowrite--log-only"></a>

#### `todo/write` — log-only

```ts persistence-catalog
/** Whole-list snapshot; latest write wins on replay. Log-only UI state; never derived history. */
/* 整张待办清单的快照；重放时最新一次写入生效。只用于日志/UI 状态，绝不进入派生历史。 */
'todo/write': { todos: TodoItem[] }
```

类型：[TodoItem](subsystems/session.zh.md)

来源：[`packages/core/session/src/types.ts:303`](../packages/core/session/src/types.ts)

### `tool/*`

<a id="toolcall--log-only"></a>

#### `tool/call` — log-only

```ts persistence-catalog
/**
 * The model requested one tool invocation: `name` with the raw `arguments`
 * JSON string exactly as the model produced it (unparsed). `callId` pairs the
 * call with its `tool/result`.
 */
/* 模型请求一次工具调用：name 加上模型原始产出的 arguments JSON 字符串（不解析）；callId 用于与对应的 tool/result 配对。 */
'tool/call': { turn: number; step: number; callId: CallId; name: string; arguments: string }
```

类型：[CallId](subsystems/core.zh.md)

来源：[`packages/core/session/src/types.ts:283`](../packages/core/session/src/types.ts)

<a id="toolcode-dispatch--log-only"></a>

#### `tool/code-dispatch` — log-only

```ts persistence-catalog
/**
 * One bridged sub-dispatch SETTLING: the pairing ids (matching the
 * `tool/code-dispatch-start` with the same `subCallId`), the tool `name`
 * with the same JSON-normalized `arguments`, and the sub-call's complete
 * model-facing outcome in `tool/result`'s own vocabulary
 * (`content` + `isError`), so UIs render a sub-call through the exact
 * code path that renders a native call. Every started sub-call settles
 * with exactly one of these (abort included: the aborted pipeline result
 * is an `isError` outcome).
 * Log-only: `deriveMessages()` ignores it, so sub-calls never re-enter
 * model context; persistence and UIs get every call. Appended inside the
 * parent `run_code`'s execution (the bridge drains in-flight dispatches
 * before returning), so its execution-enclosure relation holds by
 * construction.
 */
/*
 * 【中文】子调用落定事件：每个已开始的子调用恰好对应一条（中止亦然），按
 *   subCallId 与对应的开始事件配对。同样仅入日志——子调用结果不会重新进入
 *   模型上下文；它在父 `run_code` 执行内部被追加（桥接层在返回前排空所有在途
 *   分派），因此"落定发生在父调用执行区间内"这一封闭关系由构造保证。
 */
'tool/code-dispatch': CodeDispatchEventData
```

来源：[`packages/core/tools/src/types.ts:56`](../packages/core/tools/src/types.ts)

<a id="toolcode-dispatch-start--log-only"></a>

#### `tool/code-dispatch-start` — log-only

```ts persistence-catalog
/**
 * One sub-dispatch STARTING inside a `run_code` program: the parent
 * `run_code` call id, the deterministic sub-call id (`<parent>:code:<n>`,
 * numbered in submission order), and the tool `name` with its
 * JSON-normalized `arguments` — the exact value dispatched, normalized
 * BEFORE dispatch, so this append can never fail on payload shape.
 * Appended when the scheduler actually starts the call (not at
 * submission), so a start means the tool body pipeline was entered; a
 * call abandoned in the queue logs nothing. Log-only: `deriveMessages()`
 * ignores it; UIs use it for live per-sub-call running state and pair it
 * with `tool/code-dispatch` by `subCallId` (timing = the two events'
 * `time` fields).
 */
/*
 * 【中文】子调用开始事件：调度器真正启动该调用时才写入（提交时不算），
 *   因此它的出现意味着工具体流水线已进入；仅在队列里被放弃的调用不产生日志。
 *   仅入日志、不进入模型消息（deriveMessages 忽略它）；UI 用它展示逐子调用的
 *   运行中状态，并按 subCallId 与落定事件配对。
 */
'tool/code-dispatch-start': CodeDispatchStartEventData
```

来源：[`packages/core/tools/src/types.ts:40`](../packages/core/tools/src/types.ts)

<a id="toolresult--surface"></a>

#### `tool/result` — surface

```ts persistence-catalog
/**
 * A completed tool call's model-facing result, optional internal failure
 * identity, and optional tool-private `meta` presentation payload. `meta` is
 * opaque to the core (the producing tool owns its shape and reads it back in
 * `presentResult`) but MUST be JSON-serializable: `Session.append`
 * runtime-validates all event data with `isJsonValue`, so a non-serializable
 * `meta` is rejected at the source, and the durable log reproduces the
 * identical card on replay. Absent
 * unless the tool attaches one (e.g. `dsh-tool-fs` carries its result-time
 * contextual diff here).
 */
/*
 * 已完成工具调用的模型侧结果 message、可选的内部失败标识 error、可选的
 * 工具私有展示载荷 meta。meta 对核心不透明（由产生它的工具定义形状并在
 * presentResult 读回），但必须可 JSON 序列化——Session.append 会用
 * isJsonValue 校验，不可序列化的 meta 在源头就被拒绝，耐久日志重放时能
 * 还原出完全相同的卡片。
 */
'tool/result': {
  turn: number
  step: number
  message: ToolResultMessage
  error?: { name: string; code: string }
  meta?: JsonValue
}
```

来源：[`packages/core/session/src/types.ts:295`](../packages/core/session/src/types.ts)

### `tool-workflow/*`

<a id="tool-workflowagent-end--log-only"></a>

#### `tool-workflow/agent-end` — log-only

```ts persistence-catalog
/**
 * Records one member settlement.
 * @param data - run identity, paired member sequence, and outcome.
 */
/* 中文：记录成员结算；data 包含运行标识、配对序号和结果。 */
'tool-workflow/agent-end': ToolWorkflowAgentEndData
```

来源：[`packages/workflow/tool-workflow/src/types.ts:57`](../packages/workflow/tool-workflow/src/types.ts)

<a id="tool-workflowagent-start--log-only"></a>

#### `tool-workflow/agent-start` — log-only

```ts persistence-catalog
/**
 * Records one published workflow member.
 * @param data - run identity, member sequence, display identity, and child Session.
 */
/* 中文：记录已发布成员；data 包含运行、序号、显示信息和子会话。 */
'tool-workflow/agent-start': ToolWorkflowAgentStartData
```

来源：[`packages/workflow/tool-workflow/src/types.ts:52`](../packages/workflow/tool-workflow/src/types.ts)

<a id="tool-workflowrun-end--log-only"></a>

#### `tool-workflow/run-end` — log-only

```ts persistence-catalog
/**
 * Closes one workflow record after cleanup.
 * @param data - stable run identity and terminal reason.
 */
/* 中文：关闭工作流记录；data 包含运行标识和终止原因。 */
'tool-workflow/run-end': ToolWorkflowRunEndData
```

来源：[`packages/workflow/tool-workflow/src/types.ts:62`](../packages/workflow/tool-workflow/src/types.ts)

<a id="tool-workflowrun-start--log-only"></a>

#### `tool-workflow/run-start` — log-only

```ts persistence-catalog
/**
 * Opens one top-level workflow record.
 * @param data - stable run identity and display name.
 */
/* 中文：打开工作流记录；data 包含运行标识和显示名称。 */
'tool-workflow/run-start': ToolWorkflowRunStartData
```

来源：[`packages/workflow/tool-workflow/src/types.ts:47`](../packages/workflow/tool-workflow/src/types.ts)

### `turn/*`

<a id="turnend--log-only"></a>

#### `turn/end` — log-only

```ts persistence-catalog
/**
 * Closes turn `turn` with the {@link TurnEndReason} that ended it. A turn
 * with no entered step has no `step/start` or `step/end`. The loop does not await a
 * flush at turn boundaries: `dsh-session-checkpoint-policy` owns the
 * per-request durability checkpoint, and consumers that read storage after
 * `whenIdle()` flush themselves. Success commits the turn; rejection is
 * reported live and does not prevent later work.
 */
/* 以结束原因关闭第 turn 个轮次；没有进入过 step 的轮次就没有 step/start 与 step/end。轮边界处循环不等待落盘：由 checkpoint-policy 插件负责每请求的持久化检查点，读完存储的消费者自行冲刷。 */
'turn/end': { turn: number; reason: TurnEndReason }
```

类型：[TurnEndReason](subsystems/session.zh.md)

来源：[`packages/core/session/src/types.ts:252`](../packages/core/session/src/types.ts)

<a id="turnstart--log-only"></a>

#### `turn/start` — log-only

```ts persistence-catalog
/**
 * Opens turn `turn` before the loop claims queued input or runs pre-step.
 * Rejection, empty input, cancellation, or failure may close it with no
 * step; otherwise the following identified `user/message` event or batch
 * records the messages entering the step.
 */
/* 在循环认领排队输入或执行前置步骤之前，打开第 turn 个轮次；被拒绝、空输入、取消或失败都可能让该轮没有任何 step 就关闭。 */
'turn/start': { turn: number }
```

来源：[`packages/core/session/src/types.ts:243`](../packages/core/session/src/types.ts)

### `user/*`

<a id="usermessage--surface"></a>

#### `user/message` — surface

```ts persistence-catalog
/**
 * A user-role message on the model-visible surface: a direct human prompt
 * (the queued message claimed for this turn), a synthetic `agent.inject()`
 * context (file-change notices, subdir AGENTS.md, skill content, cron
 * notifications, …), or an entered goal continuation round. All three
 * project their `content` verbatim; `source` tells them apart.
 */
/*
 * 模型可见表面上的一条 user 角色消息：可能是人类直接输入（本轮认领的排队
 * 消息）、agent.inject() 注入的合成上下文（文件变更通知、子目录 AGENTS.md、
 * 技能内容、定时通知等）、或目标延续回合。三者都原样投影 content，用
 * source 区分来源。
 */
'user/message': UserMessage
```

来源：[`packages/core/session/src/types.ts:264`](../packages/core/session/src/types.ts)

### `web/*`

<a id="webdeepseek-search-llm-request--log-only"></a>

#### `web/deepseek-search-llm-request` — log-only

```ts persistence-catalog
/** Secret-free auxiliary DeepSeek search request recorded before dispatch. */
// 派发前记录的、去密钥的 DeepSeek 辅助搜索请求。
'web/deepseek-search-llm-request': DeepSeekSearchLlmRequest
```

来源：[`packages/web/web-search-deepseek/src/provider.ts:83`](../packages/web/web-search-deepseek/src/provider.ts)
