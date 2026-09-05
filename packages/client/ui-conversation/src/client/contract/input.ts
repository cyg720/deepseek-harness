/*
 * 【文件职责】定义输入提交状态机的事件和状态；
 * 草稿文本由 Lexical 编辑器持有，状态机只管理提交认领与尝试。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ObservableSnapshot, SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { LexicalEditor } from 'lexical'
import type { QueueRow } from './queue.ts'
import type { InputSubmitMode } from './composer-submission.ts'

/** Pick-time draft span guarded by the input revision. */
export interface TokenSpan {
  readonly start: number
  readonly end: number
  readonly draftRev: number
}

/** Attachment payload passed to a claimed command submission. */
export type SubmitAttachment =
  | {
    readonly type: 'image'
    readonly mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
    readonly data: string
    readonly name?: string
  }
  | { readonly type: 'file'; readonly receiptId: string }

/** Command serialization result for one ordered attachment draft. */
export interface DraftAttachmentSerializationResult {
  readonly attachments: readonly SubmitAttachment[]
}

/** Settled result of a command or default composer submission. */
export interface SubmitOutcome {
  readonly kind: 'success' | 'error'
  readonly text?: string
}

/** Command-mode credential supplied by one input-trigger source. */
export interface CommandClaim {
  readonly token: string
  readonly hint?: string
  readonly attachments?: boolean
  /**
   * Submit the claimed command.
   * @param args - command text after the claimed token.
   * @param actx - current Session scope.
   * @param attachments - serialized draft attachments accepted by the claim.
   * @returns command settlement.
   * @remarks 中文说明：功能说明：处理 submit 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：args（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：actx（Context）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：images（readonly
   * SubmitImageAttachment[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<SubmitOutcome>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 submit(args, actx, images)，并按返回类型处理结果。
   */
  submit(args: string, actx: Context, attachments: readonly SubmitAttachment[]): Promise<SubmitOutcome>
}

/** Structured reference inserted by an input-trigger source. */
export interface ReferenceInsert {
  readonly source: string
  readonly ref: string
  readonly label: string
  readonly appearance?: 'session' | 'file' | 'folder'
  readonly clipboardText: string
}

/** Result of trigger-source adjudication. */
export type PickOutcome =
  | { readonly claim: CommandClaim }
  | { readonly insert: ReferenceInsert }
  | { readonly text: string; readonly continue?: boolean }
  | 'handled'
  | undefined

/** Keyboard keys intercepted by an open trigger menu. */
export type ArbitrateKey = 'up' | 'down' | 'enter' | 'escape' | 'tab'

/** Trigger-menu keyboard routing result. */
export type ArbitrateOutcome = 'consumed' | 'pick-highlighted' | 'pass'

/** Scoped request to enter command mode. */
export interface BeginCommandRequest {
  readonly claim: CommandClaim
  readonly span: TokenSpan
}

/** Scoped request to insert a structured reference. */
export interface InsertReferenceRequest {
  readonly reference: ReferenceInsert
  readonly span: TokenSpan
}

/** Scoped request to consume a command token after business settlement. */
export interface ConsumeTokenRequest {
  readonly guard:
    | { readonly kind: 'span'; readonly span: TokenSpan }
    | { readonly kind: 'bare-token'; readonly token: string }
}

/** Scoped request to insert ordinary completion text. */
export interface InsertTextRequest {
  readonly text: string
  readonly span: TokenSpan
  readonly continue?: boolean
}

/** Trigger hit used to open one source programmatically. */
export interface InputTriggerHit {
  readonly trigger: '/' | '@'
  readonly query: string
  readonly quoted: boolean
  readonly position: 'leading' | 'inline'
  readonly span: TokenSpan
}

/** Structural per-Session trigger provider consumed by the input shell. */
export interface InputTriggerController {
  readonly launcher: ObservableSnapshot<string | null>
  readonly lexicon: ObservableSnapshot<ReadonlyMap<'/' | '@', readonly string[]>>
  /** @param draft - current draft. @param caret - caret offset. @param guard - availability tier. @param draftRev - input revision.
   * @remarks 中文说明：功能说明：处理 track 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：draft（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：caret（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：guard（{ readonly
   * tier: 'plain' | 'claimed' | 'frozen' }）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：draftRev（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 track(draft, caret, guard, draftRev)，
   * 并按返回类型处理结果。 */
  track(
    draft: string,
    caret: number,
    guard: { readonly tier: 'plain' | 'claimed' | 'frozen' },
    draftRev: number,
  ): void
  /** @param key - intercepted key. @param composing - whether IME composition is active. @returns routing result.
   * @remarks 中文说明：功能说明：处理 arbitrate 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：key（ArbitrateKey）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：composing（boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：ArbitrateOutcome；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * arbitrate(key, composing)，并按返回类型处理结果。 */
  arbitrate(key: ArbitrateKey, composing: boolean): ArbitrateOutcome
  /** @returns whether Space applied a trigger result.
   * @remarks 中文说明：功能说明：响应 Space 相关流程；使用场景由所在模块及调用位置决定。；返回值：boolean；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 onSpace()，并按返回类型处理结果。 */
  onSpace(): boolean
  /** @param source - reference source. @param ref - source-local id. @param signal - submit cancellation. @returns model text.
   * @remarks 中文说明：功能说明：序列化 Reference 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：source（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：ref（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：signal（AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；返回值：Promise<string>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * serializeReference(source, ref, signal)，并按返回类型处理结果。 */
  serializeReference(source: string, ref: string, signal: AbortSignal): Promise<string>
  /** @param line - trimmed draft. @param signal - submit cancellation. @param envelope - attachment count. @returns winning result.
   * @remarks 中文说明：功能说明：处理 adjudicate 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：line（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：signal（AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；参数说明：envelope（{
   * readonly images: number }）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<PickOutcome>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * adjudicate(line, signal, envelope)，并按返回类型处理结果。 */
  adjudicate(
    line: string,
    signal: AbortSignal,
    envelope: { readonly attachments: number },
  ): Promise<PickOutcome>
  /** @param source - source name. @param hit - synthetic trigger hit.
   * @remarks 中文说明：功能说明：处理 toggleSource 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：source（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：hit（InputTriggerHit）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 toggleSource(source, hit)，
   * 并按返回类型处理结果。 */
  toggleSource(source: string, hit: InputTriggerHit): void
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Claim a command token for the scoped input machine.
     * @param request - command claim and span.
     * @mode bail
     * @remarks 中文说明：功能说明：处理 'slash/input-begin-command' 相关流程；使用场景由所在模块及调用位置决定。；
     * 参数说明：request（BeginCommandRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；
     * 返回值：true | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
     * 'slash/input-begin-command'(request)，并按返回类型处理结果。
     */
    'slash/input-begin-command'(request: BeginCommandRequest): true | undefined
    /**
     * Insert a structured reference into the scoped input machine.
     * @param request - reference and span.
     * @mode bail
     * @remarks 中文说明：功能说明：处理 'slash/input-insert-reference' 相关流程；
     * 使用场景由所在模块及调用位置决定。；参数说明：request（InsertReferenceRequest）：提供调用方提交的请求信息；
     * 必须满足声明的类型及调用时序要求。；返回值：true | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；
     * 使用示例：典型用法：在完成前置校验后调用 'slash/input-insert-reference'(request)，并按返回类型处理结果。
     */
    'slash/input-insert-reference'(request: InsertReferenceRequest): true | undefined
    /**
     * Consume a trigger token without inserting replacement content.
     * @param request - token guard.
     * @mode bail
     * @remarks 中文说明：功能说明：处理 'slash/input-consume-token' 相关流程；使用场景由所在模块及调用位置决定。；
     * 参数说明：request（ConsumeTokenRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；
     * 返回值：true | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
     * 'slash/input-consume-token'(request)，并按返回类型处理结果。
     */
    'slash/input-consume-token'(request: ConsumeTokenRequest): true | undefined
    /**
     * Insert plain text into the scoped input machine.
     * @param request - plain text and span.
     * @mode bail
     * @remarks 中文说明：功能说明：处理 'slash/input-insert-text' 相关流程；使用场景由所在模块及调用位置决定。；
     * 参数说明：request（InsertTextRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；返回值：true
     * | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
     * 'slash/input-insert-text'(request)，并按返回类型处理结果。
     */
    'slash/input-insert-text'(request: InsertTextRequest): true | undefined
  }
}

/** Browser-runtime identity of one unsent attachment draft. */
export type DraftAttachmentId = Branded<'DraftAttachmentId'>

/**
 * The scoped-event application verbs: the hub's bail listeners call these,
 * and the boolean answer IS the event's bail value (true ⟺ the editor
 * applied the edit after phase and span guards).
 */
export interface InputTarget {
  /** Replace the trigger span with claim.token and enter claimed (span-CAS'd).
   * @remarks 中文说明：功能说明：处理 beginCommand 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：claim（CommandClaim）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：span（TokenSpan）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：boolean；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 beginCommand(claim, span)，
   * 并按返回类型处理结果。 */
  beginCommand(claim: CommandClaim, span: TokenSpan): boolean
  /** Replace the trigger span with one reference chip (span-CAS'd).
   * @remarks 中文说明：功能说明：处理 insertReference 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：ref（ReferenceInsert）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：span（TokenSpan）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：boolean；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 insertReference(ref,
   * span)，并按返回类型处理结果。 */
  insertReference(ref: ReferenceInsert, span: TokenSpan): boolean
}

/** Per-session input facade owned by the conversation wiring layer. */
export interface SessionInput extends InputTarget {
  /** Replace the whole draft (persisted-draft seed and programmatic writes).
   * @remarks 中文说明：功能说明：设置 Draft 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：text（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 setDraft(text)，并按返回类型处理结果。 */
  setDraft(text: string): void
  /** Append ordered browser-owned attachment ids; busy admission phases refuse. */
  addAttachments(ids: readonly DraftAttachmentId[]): boolean
  /** Remove one browser-owned attachment id; busy admission phases refuse. @returns whether the id was removed. */
  removeAttachment(id: DraftAttachmentId): boolean
  /** Drop ids whose browser-owned objects no longer exist. */
  pruneAttachments(ids: readonly DraftAttachmentId[]): void
  /**
   * THE complexity sink: enter adjudication, submit transaction, and the default sink live inside.
   * @param mode - delivery intent retained through asynchronous adjudication and serialization.
   * @remarks 中文说明：功能说明：处理 submit 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：mode（InputSubmitMode）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 submit(mode)，并按返回类型处理结果。
   */
  submit(mode?: InputSubmitMode): void
  /**
   * Surface a notice outside the machine's own effect stream: detached
   * command results and business notifications render through here.
   * Session-routed — resolving the facade via SessionInputResolver.for(actx) lands
   * the notice on that session's composer, so a result arriving after a
   * session switch still reaches its own session.
   * @param level - severity tier.
   * @param text - notice body.
   * @remarks 中文说明：功能说明：处理 notify 相关流程；使用场景由所在模块及调用位置决定。；参数说明：level（'info' |
   * 'error'）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：text（string）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 notify(level, text)，并按返回类型处理结果。
   */
  notify(level: 'info' | 'error', text: string): void
  /** Input state store (InputZone currency + decorations read here). */
  readonly state: SnapshotStore<InputState>
}

/** Session-addressed access to the per-session input facade. */
export interface SessionInputResolver {
  /** Resolve the facade for one session-scope ctx.
   * @remarks 中文说明：功能说明：处理 for 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：actx（Context）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：SessionInput；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 for(actx)，并按返回类型处理结果。 */
  for(actx: Context): SessionInput
}

/**
 * The public input action face provided to every session-scope slot
 * component: stable-identity void callbacks, mirroring the
 * useStore+actions convention. Command-style handles (arbitrate/space/
 * paste/…) stay InputBar-private and never ride this face.
 */
export interface InputActions {
  /** Replace the whole draft (persisted-draft seed and programmatic writes).
   * @remarks 中文说明：功能说明：设置 Draft 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：text（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 setDraft(text)，并按返回类型处理结果。 */
  setDraft(text: string): void
  /** Append ordered browser-owned attachment ids; busy admission phases refuse. */
  addAttachments(ids: readonly DraftAttachmentId[]): boolean
  /** Remove one browser-owned attachment id; busy admission phases refuse. */
  removeAttachment(id: DraftAttachmentId): void
  /** Drop ids whose browser-owned objects no longer exist. */
  pruneAttachments(ids: readonly DraftAttachmentId[]): void
  /** Enter submission (adjudication / claim transaction / default sink inside). */
  submit(): void
}

/** One surfaced notice (command results, adjudication failures). seq keys re-render of repeats. */
export interface InputNotice {
  readonly level: 'info' | 'error'
  readonly text: string
  readonly seq: number
}

/**
 * The InputBar-exclusive keyboard/DOM command face: synchronous
 * returns and event-handler semantics that must not enter the public provide
 * channel. Handed to the composer-bar entry through its own inject —
 * package-internal, never across a plugin boundary. The session shell
 * satisfies it structurally. Text editing itself rides the shell's Lexical
 * editor (exposed here for the contenteditable binding); the members below
 * are the submit-plane and trigger-pipeline verbs the editor does not own.
 */
export interface ComposerKeyboard {
  /** Live machine state for event-handler reads (render reads go through useInput). */
  readonly snapshot: InputState
  /** The shell-owned Lexical editor the composer binds its contenteditable to. */
  readonly editor: LexicalEditor
  /** Submit with an explicit delivery mode resolved by the keyboard policy.
   * @remarks 中文说明：功能说明：处理 submit 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：mode（InputSubmitMode）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 submit(mode)，并按返回类型处理结果。 */
  submit(mode: InputSubmitMode): void
  /**
   * Steer every still-pending queued message into the running turn (the
   * empty-draft accelerated-Enter gesture; the queue dock's per-row steer
   * button is the same operation applied to the whole queue).
   * @remarks 中文说明：功能说明：处理 steerQueue 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 steerQueue()，并按返回类型处理结果。
   */
  steerQueue(): void
  /** Insert pasted plain text over the current editor selection (reference-placeholder-sanitized).
   * @remarks 中文说明：功能说明：处理 paste 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：text（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 paste(text)，并按返回类型处理结果。 */
  paste(text: string): void
  /**
   * The live selection as a detect-coordinate span (menu-launcher synthetic
   * hits replace it on pick); an absent selection answers a collapsed span at
   * the document end.
   * @remarks 中文说明：功能说明：处理 caretSpan 相关流程；使用场景由所在模块及调用位置决定。；返回值：EditSelection；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 caretSpan()，并按返回类型处理结果。
   */
  caretSpan(): EditSelection
  /** Keyboard arbitration while the menu is open ('pass' when no pipeline).
   * @remarks 中文说明：功能说明：处理 arbitrate 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：key（ArbitrateKey）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：composing（boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：ArbitrateOutcome；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * arbitrate(key, composing)，并按返回类型处理结果。 */
  arbitrate(key: ArbitrateKey, composing: boolean): ArbitrateOutcome
  /** Space adjudication; true = the input applied a claim — caller preventDefaults.
   * @remarks 中文说明：功能说明：处理 space 相关流程；使用场景由所在模块及调用位置决定。；返回值：boolean；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 space()，并按返回类型处理结果。 */
  space(): boolean
  /** Dismiss the popupSelect shell (any interaction outside the box).
   * @remarks 中文说明：功能说明：处理 dismissPopup 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 dismissPopup()，并按返回类型处理结果。 */
  dismissPopup(): void
}

/** One independently addressable row projected from the transient queue snapshot. */
export type QueuedMessage = QueueRow

/** Guard union of the scoped consume-token event, checked by the shell. */
export type ConsumeTokenGuard = ConsumeTokenRequest['guard']

/** Half-open [start, end) range/selection in detect-projection coordinates. */
export interface EditSelection {
  readonly start: number
  readonly end: number
}

/**
 * One reference occurrence projected from the editor's chip nodes, in
 * clipboard-text coordinates. Identity is occurrenceId — a stable per-shell
 * assignment per chip NodeKey, so same-named references stay independently
 * addressable and survive undo. label/appearance/clipboardText are the
 * owner's insert-time projections cached on the node (invalid flips instead
 * of dropping the occurrence).
 */
export interface Occurrence {
  /** Shell-assigned stable identity (monotonic per shell, keyed by NodeKey). */
  readonly occurrenceId: number
  /** Owning source name (serializer routing key). */
  readonly source: string
  /** Owner-scoped reference id. */
  readonly ref: string
  /** Offset in the clipboard-text projection. */
  readonly offset: number
  /** Length in the clipboard-text projection; the occurrence occupies exactly [offset, offset+length). */
  readonly length: number
  /** Inline display label (insert-time cache). */
  readonly label: string
  /** Optional domain glyph (insert-time cache). */
  readonly appearance?: ReferenceInsert['appearance']
  /** Clipboard / persistence projection, e.g. `/name` (insert-time cache, never the model form). */
  readonly clipboardText: string
  /** Owner-resolution failure flag: the chip renders the failure treatment. */
  readonly invalid?: boolean
}

/** Published input state (the currency; per-session). */
export interface InputState {
  /** Clipboard-text projection of the editor document (chips expanded to their clipboard form). */
  readonly draft: string
  /** Ordered runtime-only attachment ids; browser objects stay in ConversationController. */
  readonly attachmentIds: readonly DraftAttachmentId[]
  /** Monotonic editor revision (span CAS compares against this). */
  readonly draftRev: number
  readonly phase: 'plain' | 'adjudicating' | 'claimed' | 'submitting'
  /** Present exactly while claimed/submitting (claim snapshot during flight; submit closure withheld). */
  readonly claim?: { readonly token: string; readonly hint?: string; readonly attachments?: boolean }
  /** Reference occurrence view of the editor's chips, sorted by offset. */
  readonly occurrences: readonly Occurrence[]
  /** Read-only transient inbox projection from Session control, including pending steering. */
  readonly queue: readonly QueuedMessage[]
}

/**
 * One in-flight submission attempt: the ONLY id concept in the submit plane.
 * Created on enter; carried by adjudicated/submit-settled/sink-settled
 * events; stale attempts are dropped (anti-backwash). Command attempts hold
 * the single frozen in-flight slot; default-sink attempts run detached and
 * concurrently. release/session teardown aborts them all, keeping every
 * promise bounded.
 */
export interface SubmitAttempt {
  readonly seq: number
  readonly signal: AbortSignal
  /** Clipboard-projection draft captured before an optimistic default-send commit. */
  readonly draftSnapshot: string
  /** Default-message delivery intent retained while slash adjudication is pending. */
  readonly mode: InputSubmitMode
}

/**
 * Submit-machine input events (the machine's single write path). Text
 * mutation lives in the editor; the machine only observes the draft through
 * event payloads (claim integrity, enter snapshots, settlement decisions).
 */
export type InputEvent =
  /** Clipboard projection changed: the claimed integrity watch runs (zero effects). */
  | { readonly type: 'draft-changed'; readonly draft: string }
  /** The editor applied a claim-token replacement: enter claimed. */
  | { readonly type: 'claim'; readonly claim: CommandClaim }
  /** Enter submission with the current clipboard projection. */
  | { readonly type: 'enter'; readonly mode: InputSubmitMode; readonly draft: string }
  | { readonly type: 'adjudicated'; readonly attempt: SubmitAttempt; readonly outcome: PickOutcome }
  | { readonly type: 'adjudication-failed'; readonly attempt: SubmitAttempt; readonly message: string }
  /** Settlement carries the live clipboard projection for suffix-retention and claim re-entry decisions. */
  | { readonly type: 'submit-settled'; readonly attempt: SubmitAttempt; readonly ok: boolean; readonly draft: string; readonly outcome?: SubmitOutcome; readonly message?: string }
  /** Settlement of one optimistic default send, independent of the frozen command slot. */
  | { readonly type: 'sink-settled'; readonly attempt: SubmitAttempt; readonly ok: boolean; readonly outcome?: SubmitOutcome; readonly message?: string }
  /** Commit an attachment-only send whose empty draft did not need an attempt. */
  | { readonly type: 'send-committed' }
  | { readonly type: 'release' }

/**
 * Submit-machine output effects (executed by the SessionInput shell; the
 * machine stays pure).
 */
export type InputEffect =
  | { readonly type: 'adjudicate'; readonly attempt: SubmitAttempt; readonly draft: string }
  | { readonly type: 'begin-submit'; readonly attempt: SubmitAttempt; readonly claim: CommandClaim; readonly args: string }
  /** Detached default send; the shell captures its editor projection before the following commit effect. */
  | {
    readonly type: 'default-sink'
    readonly attempt: SubmitAttempt
    readonly draft: string
    readonly mode: InputSubmitMode
  }
  | { readonly type: 'notice'; readonly level: 'info' | 'error'; readonly text: string }
  /**
   * Clear the committed draft in the editor and cut undo history. A string
   * snapshot keeps a pure suffix typed during the Host round-trip (content
   * appended after the sent snapshot survives; interleaved edits cannot be
   * separated and clear whole); null clears unconditionally (attachment-only
   * sends have no draft to retain).
   */
  | { readonly type: 'commit-draft'; readonly retainSuffixOf: string | null }
