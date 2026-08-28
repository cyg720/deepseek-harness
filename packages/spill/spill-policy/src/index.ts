/**
 * The spill-policy PLUGIN: a `tools/post-execute` result transformer that keeps
 * oversized plain-text tool results out of the model's context. When a final
 * result's UTF-8 size exceeds `maxInlineBytes`, it saves the FULL text to a
 * session-scoped spill artifact (`ctx.spillStore`) and replaces the
 * model-facing result with a bounded head/tail preview plus the backend's
 * locator and retrieval guidance.
 *
 * It registers NO service and owns NO storage or preview mechanics: preview is
 * `@deepseek-ai/dsh-output-retention` (`TextRetainer`), storage is `ctx.spillStore`.
 * The policy only decides WHEN to spill and composes the notice.
 *
 * A second arm applies the SAME cap to the durable log: the
 * `tools/ptc-dispatch-log` waterfall bounds the `tool/code-dispatch` event's
 * copy of an oversized `run_code` sub-call result (the program's value is
 * untouched; UIs and replay read the full text through the spill artifact).
 *
 * ## Deliberately narrow
 *
 * - Omitted `maxInlineBytes` ⇒ the plugin registers nothing (a true no-op).
 * - Plain-text results only: a result carrying any non-text block is left
 *   untouched (the policy knows only the final formatted text, not tool
 *   internals).
 * - Nested composite calls skip the MODEL-facing arm; their durable log copy
 *   is bounded by the dispatch-log arm instead.
 * - Accepted value replacements pass through for registry revalidation and
 *   rendering; this presentation policy cannot also replace content in the
 *   same mutually exclusive decision.
 * - `read` is skipped by the model-facing arm to avoid a
 *   `read → spill → read again` loop; the dispatch-log arm bounds `read`
 *   sub-calls too (a log copy is not model context, and `read` is precisely
 *   the tool that produces huge logs).
 * - Best-effort: no session owner, no `ctx.spillStore` backend, or a save
 *   failure ⇒ log and return the original result. A spill failure must NEVER
 *   turn a successful tool call into an `isError` or hide the inline result.
 *
 * It COMPOSES with other post-execute listeners: its prepended listener
 * delegates via `next()` and bounds the resulting content projection, so
 * tool-owned asynchronous projection runs before generic bounding, a hook that
 * replaced content still has its replacement bounded, and value replacements
 * and `block` decisions pass through unchanged.
 *
 * @module @deepseek-ai/dsh-spill-policy
 */
/*
 * 文件职责：实现 index.ts 覆盖的大结果落盘行为与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、文件存储或受控子进程协议。
 * 产品维度：保障 Agent 的大结果落盘能力稳定、安全且可诊断。
 * 逻辑维度：准备或解析输入，执行核心流程，再处理结果、错误与资源清理。
 * 关键边界：外部进程和持久化数据不可信；敏感环境需净化；清理必须等待资源完全停止。
 * 新手阅读建议：先看导出类型和夹具，再读主流程，最后关注协议错误、恢复和清理。
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { TextRetainer, describeOmitted } from '@deepseek-ai/dsh-output-retention'
import type { Omitted } from '@deepseek-ai/dsh-output-retention'
import type { SaveTextSpill, SpillRef } from '@deepseek-ai/dsh-spill'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { PostToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import type { SpillPolicyExec } from './types.ts'

export type { SpillPolicyExec } from './types.ts'

/** Plugin config. */
/* 中文说明：interface Config 定义本模块所需的数据或行为，用于表达大结果落盘场景。 */
export interface Config {
  /**
   * The model-facing context cap for a plain-text tool result, in UTF-8 bytes.
   * Omitted disables the policy entirely (no-op). When set, a result larger than
   * this is spilled and replaced with a preview derived from this same budget.
   */
  maxInlineBytes?: number
}

/** Cordis plugin name used by loader diagnostics. */
/* 中文说明：变量 name 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
export const name = 'spill-policy'

/** Require the tool registry (its `tools/post-execute` waterfall is the extension point we transform). */
/* 中文说明：变量 inject 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
export const inject = ['tools']

/** 中文说明：变量 Config 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
export const Config: z<Config> = z.object({
  maxInlineBytes: z.number(),
})

/** All-text content flattened to one UTF-8 string, or `undefined` if any block is non-text. */
/* 中文说明：函数 flattenPlainText 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function flattenPlainText(content: ContentBlock[]): string | undefined {
  /** 中文说明：变量 text 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let text = ''
  /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
  for (const block of content) {
    if (block.type !== 'text') return undefined
    text += block.text
  }
  return text
}

/** The owning session id, or `undefined` for a call with no agent (a direct/test call). */
/* 中文说明：函数 ownerSessionId 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function ownerSessionId(exec: ToolExecution): SessionId | undefined {
  return (exec as SpillPolicyExec).agent?.session.header.id
}

/** Build the bounded head/tail preview for `text`, splitting `budget` bytes across the two ends. */
/* 中文说明：函数 preview 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function preview(text: string, budget: number): { text: string; omitted: Omitted } {
  /** 中文说明：变量 headBytes 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const headBytes = Math.ceil(budget / 2)
  /** 中文说明：变量 tailBytes 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const tailBytes = Math.floor(budget / 2)
  /** 中文说明：变量 retainer 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const retainer = new TextRetainer({ kind: 'headTail', headBytes, tailBytes })
  retainer.push(text)
  /** 中文说明：变量 kept 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const kept = retainer.finish()
  return { text: kept.text, omitted: kept.omittedBytes }
}

/** The spill-notice line for a given omission + saved reference (no preview, no leading blank line). */
/* 中文说明：函数 spillNotice 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function spillNotice(omitted: Omitted, ref: SpillRef): string {
  /** 中文说明：变量 omission 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const omission = describeOmitted(omitted, 'bytes')
  return `(${omission} Full formatted result stored at: ${ref.locator}. ${ref.retrievalHint})`
}

/** 中文说明：函数 apply 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export function apply(ctx: Context, config: Config): void {
  /** 中文说明：变量 maxInlineBytes 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const maxInlineBytes = config.maxInlineBytes
  // Omitted ⇒ no automatic spill policy: register nothing at all.
  if (maxInlineBytes === undefined) return
  // Validate at LOAD, not per call: a negative/fractional cap would reach
  // TextRetainer's assertBudget and throw, turning every oversized-result call
  // into an isError. A bad config must fail the deployment, not the tool.
  if (!Number.isInteger(maxInlineBytes) || maxInlineBytes < 0) {
    throw new Error(`spill-policy: maxInlineBytes must be a non-negative integer (got ${maxInlineBytes})`)
  }
  // Narrowed once for the nested arms (closure narrowing does not survive awaits).
  /** 中文说明：变量 cap 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const cap: number = maxInlineBytes

  /**
   * Spill `text` and build the bounded replacement (preview + notice), or
   * return `undefined` when the policy must keep the original (no session
   * owner, no backend, storage failure, or no within-cap replacement).
   * Shared verbatim by the model-facing post-execute arm and the durable
   * dispatch-log arm so both produce byte-identical projections.
   */
  /* 中文说明：函数 spillReplacement 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
  async function spillReplacement(
    text: string,
    totalBytes: number,
    sessionId: SessionId | undefined,
    toolName: string,
    callId: ToolCallId,
    label: 'result' | 'dispatch',
  ): Promise<string | undefined> {
    if (sessionId === undefined) {
      ctx.logger.warn(`spill-policy: no session owner for ${toolName} ${label}; keeping the inline content`)
      return undefined
    }
    /** 中文说明：变量 spillStore 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const spillStore = ctx.get('spillStore')
    if (!spillStore) {
      ctx.logger.warn('spill-policy: no ctx.spillStore backend loaded; keeping the inline content')
      return undefined
    }
    /** 中文说明：变量 save 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const save: SaveTextSpill = {
      owner: { sessionId },
      source: { toolName, callId, label },
      suggestedName: `${toolName}.txt`,
      content: text,
    }
    /** 中文说明：变量 ref 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let ref: SpillRef
    try {
      ref = await spillStore.saveText(save)
    } catch (error: unknown) {
      // Best-effort: a storage failure (permissions, ENOSPC, backend down) must
      // never fail the call or hide the content — keep the original inline.
      ctx.logger.warn(`spill-policy: saveText failed for ${toolName}: ${String(error)}; keeping the inline content`)
      return undefined
    }

    // Reserve the notice's byte cost INSIDE maxInlineBytes so the replacement
    // (preview + blank line + notice) never exceeds the documented cap — a naive
    // preview that spent the whole budget then appended the notice could be
    // larger than the cap, and for a marginally-over result even larger than the
    // original. The reservation uses a notice priced at the worst-case omission
    // count (the full byte total): its digit count bounds the real count's, so
    // the reserved size is a safe upper bound and the final notice is never
    // longer than what we reserved. `\n\n` is the 2-byte join.
    /** 中文说明：变量 reserve 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const reserve = Buffer.byteLength(spillNotice({ kind: 'exact', count: totalBytes }, ref), 'utf8') + 2
    /** 中文说明：变量 previewBudget 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const previewBudget = Math.max(0, cap - reserve)
    const { text: previewText, omitted } = preview(text, previewBudget)
    /** 中文说明：变量 notice 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const notice = spillNotice(omitted, ref)
    /** 中文说明：变量 replacedText 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const replacedText = previewText.length > 0 ? `${previewText}\n\n${notice}` : notice
    // Invariant: the policy NEVER emits a replacement larger than the cap. When
    // the notice alone exceeds maxInlineBytes (a tiny cap or a long spill root),
    // there is no within-cap replacement, so keep the inline content — spilling
    // would break the advertised cap. (A within-cap replacement is always
    // smaller than the original, which is > cap by the entry condition, so this
    // one check subsumes "not smaller than the original" too. The spill file
    // already written is a harmless orphan; cleanup is deferred.)
    if (Buffer.byteLength(replacedText, 'utf8') > cap) {
      ctx.logger.warn(`spill-policy: spill notice for ${toolName} exceeds maxInlineBytes; keeping the inline content`)
      return undefined
    }
    return replacedText
  }

  ctx.on('tools/post-execute', async (exec, result, next): Promise<PostToolDecision> => {
    // Delegate first so a downstream listener (e.g. a hook) settles the result;
    // we bound whatever it accepted. A block passes through — spill only shapes
    // accepted plain-text results, never corrective feedback.
    /** 中文说明：变量 decision 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const decision = await next()
    // Skip `read` to avoid a read → spill → read again loop.
    if (decision.kind !== 'accept' || Object.hasOwn(decision, 'value')
      || exec.parent !== undefined || exec.name === 'read') return decision

    /** 中文说明：变量 content 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const content = decision.content ?? result.content
    /** 中文说明：变量 text 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const text = flattenPlainText(content)
    if (text === undefined) return decision
    /** 中文说明：变量 totalBytes 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const totalBytes = Buffer.byteLength(text, 'utf8')
    if (totalBytes <= maxInlineBytes) return decision

    /** 中文说明：变量 replacedText 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const replacedText = await spillReplacement(text, totalBytes, ownerSessionId(exec), exec.name, exec.callId, 'result')
    if (replacedText === undefined) return decision
    /** 中文说明：变量 replaced 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const replaced: ContentBlock[] = [{ type: 'text', text: replacedText }]
    return { kind: 'accept', content: replaced, ...decision.additionalContexts ? { additionalContexts: decision.additionalContexts } : {} }
  }, { prepend: true })

  // The durable-log arm: bound the `tool/code-dispatch` event's copy of an
  // oversized sub-call result the same way the model-facing arm bounds an
  // outer result. The program's returned value is untouched (it already
  // crossed the worker boundary whole); only the session log's copy shrinks
  // to preview + locator, so replay and UIs read the full text through the
  // spill artifact exactly as they do for spilled native results.
  ctx.on('tools/ptc-dispatch-log', async (dispatch, next): Promise<ContentBlock[]> => {
    const content = await next()
    // `read` sub-calls spill too: the log copy is not model context, so the
    // read → spill → read-again loop the post-execute arm avoids cannot
    // happen here, and read is precisely the tool that produces huge logs.
    /** 中文说明：变量 text 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const text = flattenPlainText(content)
    if (text === undefined) return content
    /** 中文说明：变量 totalBytes 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const totalBytes = Buffer.byteLength(text, 'utf8')
    if (totalBytes <= maxInlineBytes) return content

    /** 中文说明：变量 replacedText 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const replacedText = await spillReplacement(
      text, totalBytes, ownerSessionId(dispatch.exec), dispatch.name, dispatch.subCallId, 'dispatch')
    if (replacedText === undefined) return content
    return [{ type: 'text', text: replacedText }]
  }, { prepend: true })
}
