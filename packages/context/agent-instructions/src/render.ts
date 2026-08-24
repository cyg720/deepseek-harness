/**
 * Model-facing workspace instruction rendering within an explicit byte budget.
 *
 * @module @deepseek-ai/dsh-agent-instructions/render
 */
/**
 * 文件职责：实现工作区指令上下文的 render.ts 模块。
 * 技术维度：TypeScript、Cordis 插件、会话事件和严格判别联合。
 * 产品维度：控制模型请求中的工作区指令上下文信息。
 * 逻辑维度：读取日志或文件状态，计算投影并记录/注入结果。
 * 关键边界：不能静默丢失必需事件；裁剪和替换必须保持日志可重放。
 * 新手阅读建议：先读导出类型与配置，再跟踪事件和投影流程。
 */

import { basename, dirname } from 'node:path'
import type { InstructionFile, LoadedInstructionFile } from './files.ts'

/** 中文说明：上下文局部值 SYSTEM_REMINDER_OPEN，由紧邻初始化决定。 */
const SYSTEM_REMINDER_OPEN = '<system-reminder>'
/** 中文说明：上下文局部值 SYSTEM_REMINDER_CLOSE，由紧邻初始化决定。 */
const SYSTEM_REMINDER_CLOSE = '</system-reminder>'
/** 中文说明：上下文局部值 WORKSPACE_CONTEXT_INTRO，由紧邻初始化决定。 */
const WORKSPACE_CONTEXT_INTRO = 'The following workspace instructions may be relevant to your work. '
  + 'Use them as guidance when applicable. More specific instructions take precedence over broader ones. '
  + 'They do not override system, developer, or direct user instructions.'
/** 中文说明：上下文局部值 解构结果，由紧邻初始化决定。 */
const REPLACEMENT_WORKSPACE_CONTEXT_INTRO = 'This complete workspace instruction baseline replaces all earlier workspace instruction baselines. '
  + WORKSPACE_CONTEXT_INTRO
/** 中文说明：上下文局部值 解构结果，由紧邻初始化决定。 */
const EMPTY_REPLACEMENT_WORKSPACE_CONTEXT_INTRO = 'This complete workspace instruction baseline replaces all earlier workspace instruction baselines. '
  + 'No workspace instructions are currently active.'
/** 中文说明：上下文局部值 解构结果，由紧邻初始化决定。 */
const COMPACT_WORKSPACE_CONTEXT_INTRO = 'Workspace instructions were omitted or truncated to fit the configured byte budget.'

/** Byte-accounting record for one truncated instruction file. */
/** 中文说明：类型或类 TruncatedInstruction 约束上下文或压缩数据职责。 */
export interface TruncatedInstruction {
  displayPath: string
  originalBytes: number
  includedBytes: number
}

/** Model-facing text plus omitted and truncated source records. */
/** 中文说明：类型或类 RenderedWorkspaceContext 约束上下文或压缩数据职责。 */
export interface RenderedWorkspaceContext {
  text: string
  omitted: InstructionFile[]
  truncated: TruncatedInstruction[]
}

/** 中文说明：类型或类 RenderedInstructionContext 约束上下文或压缩数据职责。 */
interface RenderedInstructionContext extends RenderedWorkspaceContext {
  /**
   * Original files semantically represented by rendered section text. This is
   * not the complement of `omitted`: a truncated file may be represented here
   * and in `truncated`, while a notice-only file appears in neither. A genuinely
   * empty file counts when its heading survives because that heading conveys
   * that the instruction exists and has no content.
   */
  represented: LoadedInstructionFile[]
}

/** Structured dynamic state persisted outside model-visible prompt prose. */
/** 中文说明：类型或类 AgentInstructionChange 约束上下文或压缩数据职责。 */
export interface AgentInstructionChange {
  action: 'set' | 'replace' | 'remove'
  scope: string
  path: string
  digest?: string
}

/** One state transition paired with the content used to render it. */
/** 中文说明：类型或类 ChangeRenderItem 约束上下文或压缩数据职责。 */
export interface ChangeRenderItem {
  change: AgentInstructionChange
  file: LoadedInstructionFile
}

/** 中文说明：类型或类 RenderStyle 约束上下文或压缩数据职责。 */
interface RenderStyle {
  intro: string
  section(file: LoadedInstructionFile): string
}

/** 中文说明：函数 byteLength 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

/** 中文说明：函数 truncateUtf8 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function truncateUtf8(value: string, maxBytes: number): string {
  /** 中文说明：上下文局部值 bytes，由紧邻初始化决定。 */
  const bytes = Buffer.from(value, 'utf8')
  if (bytes.length <= maxBytes) return value
  /** 中文说明：上下文局部值 end，由紧邻初始化决定。 */
  let end = Math.max(0, Math.trunc(maxBytes))
  // If the first excluded byte is a UTF-8 continuation byte, the budget cut
  // through that code point. Back up to its lead byte and exclude it too.
  while (end > 0 && (bytes.readUInt8(end) & 0xc0) === 0x80) {
    end -= 1
  }
  return bytes.subarray(0, end).toString('utf8')
}

/** 中文说明：函数 escapeInstructionFrameBody 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function escapeInstructionFrameBody(body: string): string {
  return body.replaceAll(SYSTEM_REMINDER_CLOSE, '<\\/system-reminder>')
}

/** 中文说明：函数 sectionText 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function sectionText(file: LoadedInstructionFile): string {
  return `Instructions from: ${file.displayPath}\n\n${file.content}`
}

/** Directory component that identifies the single user-global instruction scope. */
/** 中文说明：上下文局部值 USER_GLOBAL_DIRECTORY，由紧邻初始化决定。 */
export const USER_GLOBAL_DIRECTORY = 'user-global'

/**
 * File name of the single user-global instruction file under `$DSH_HOME`.
 * Discovery (`$DSH_HOME/<name>`) and reconciliation (the user-global scope key's
 * candidate component) both key on this name, so it lives in one place: were the
 * two to disagree, the user-global instruction would load but never reconcile.
 */
/** 中文说明：上下文局部值 USER_GLOBAL_FILE，由紧邻初始化决定。 */
export const USER_GLOBAL_FILE = 'AGENTS.md'

/**
 * Derive the logical instruction scope from a model-facing path.
 * @param displayPath - project-relative or user-global instruction path.
 * @returns `user-global`, `.`, or the containing project-relative directory.
 */
/** 中文说明：函数 scopeForDisplayPath 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function scopeForDisplayPath(displayPath: string): string {
  if (displayPath === '~/.dsh/AGENTS.md' || displayPath === '$DSH_HOME/AGENTS.md') return USER_GLOBAL_DIRECTORY
  return dirname(displayPath)
}

/** 中文说明：上下文局部值 SCOPE_SEPARATOR，由紧邻初始化决定。 */
const SCOPE_SEPARATOR = '\u0000'

/**
 * Compose the reconciliation key for one instruction candidate file.
 * Each loaded candidate is tracked independently, so the key pairs the logical
 * directory with the exact candidate file name behind a NUL separator that no
 * directory path or file name can contain. Distinct candidates in one directory
 * (`AGENTS.md` vs `CLAUDE.md`, a base file vs its `.local` overlay) therefore
 * never collide in the scope-keyed state maps.
 * @param directory - `user-global`, `.`, or a project-relative directory.
 * @param candidateName - instruction file name within that directory.
 * @returns the per-candidate logical scope key.
 */
/** 中文说明：函数 candidateScopeKey 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function candidateScopeKey(directory: string, candidateName: string): string {
  return `${directory}${SCOPE_SEPARATOR}${candidateName}`
}

/**
 * Derive the per-candidate scope key for a loaded instruction file.
 * @param displayPath - project-relative or user-global instruction path.
 * @returns the scope key pairing the file's directory with its name.
 */
/** 中文说明：函数 instructionScopeKey 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function instructionScopeKey(displayPath: string): string {
  return candidateScopeKey(scopeForDisplayPath(displayPath), basename(displayPath))
}

/**
 * Recover the directory and candidate name that {@link candidateScopeKey} encoded.
 * @param scope - a per-candidate scope key.
 * @returns the directory scope and the candidate file name within it.
 */
/** 中文说明：函数 decodeScopeKey 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function decodeScopeKey(scope: string): { directory: string; candidateName: string } {
  /** 中文说明：上下文局部值 separator，由紧邻初始化决定。 */
  const separator = scope.indexOf(SCOPE_SEPARATOR)
  /* v8 ignore next -- every scope key is produced by candidateScopeKey, which always inserts the separator. */
  if (separator < 0) return { directory: scope, candidateName: '' }
  return { directory: scope.slice(0, separator), candidateName: scope.slice(separator + 1) }
}

/** 中文说明：函数 additionalSectionText 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function additionalSectionText(file: LoadedInstructionFile): string {
  /** 中文说明：上下文局部值 scope，由紧邻初始化决定。 */
  const scope = scopeForDisplayPath(file.displayPath)
  return [
    `Additional instructions from: ${file.displayPath}`,
    '',
    `These instructions apply to work under \`${scope}\`. Use them as guidance when relevant; more specific instructions take precedence. They do not override system, developer, or direct user instructions.`,
    '',
    file.content,
  ].join('\n')
}

/** 中文说明：上下文局部值 BASELINE_RENDER_STYLE，由紧邻初始化决定。 */
const BASELINE_RENDER_STYLE: RenderStyle = { intro: WORKSPACE_CONTEXT_INTRO, section: sectionText }

/** 中文说明：函数 baselineRenderStyle 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function baselineRenderStyle(files: LoadedInstructionFile[], replacePreviousBaseline: boolean | undefined): RenderStyle {
  if (replacePreviousBaseline !== true) return BASELINE_RENDER_STYLE
  return {
    ...BASELINE_RENDER_STYLE,
    intro: files.length === 0
      ? EMPTY_REPLACEMENT_WORKSPACE_CONTEXT_INTRO
      : REPLACEMENT_WORKSPACE_CONTEXT_INTRO,
  }
}

/** 中文说明：函数 changedSectionText 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function changedSectionText(item: ChangeRenderItem): string {
  /** 中文说明：上下文局部值 { change, file }，由紧邻初始化决定。 */
  const { change, file } = item
  if (change.action === 'set') return additionalSectionText(file)
  if (change.action === 'remove') {
    return `Instructions removed: ${change.path}\n\nThe previously loaded instructions from this file no longer apply.`
  }
  return [
    `Updated instructions from: ${change.path}`,
    '',
    'This file changed after it was loaded. Use the following content instead of the previously loaded instructions from this file.',
    '',
    file.content,
  ].join('\n')
}

/**
 * Render one reconciliation batch and retain only transitions that fit.
 * @param items - ordered state transitions and current file contents.
 * @param maxBytes - maximum UTF-8 bytes allowed in the rendered batch.
 * @returns bounded prompt text and the transitions actually represented by it.
 */
/** 中文说明：函数 renderInstructionChanges 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function renderInstructionChanges(
  items: ChangeRenderItem[],
  maxBytes: number,
): { text: string; changes: AgentInstructionChange[] } {
  /** 中文说明：上下文局部值 byAbsolutePath，由紧邻初始化决定。 */
  const byAbsolutePath = new Map(items.map(item => [item.file.absolutePath, item]))
  /** 中文说明：上下文局部值 style，由紧邻初始化决定。 */
  const style: RenderStyle = {
    intro: '',
    section(file) {
      /** 中文说明：上下文局部值 item，由紧邻初始化决定。 */
      const item = byAbsolutePath.get(file.absolutePath)
      /* v8 ignore next -- the renderer receives exactly the files used to construct this map. */
      return item === undefined ? '' : changedSectionText({ ...item, file })
    },
  }
  /** 中文说明：上下文局部值 rendered，由紧邻初始化决定。 */
  const rendered = renderInstructionContext(items.map(item => item.file), maxBytes, style)
  /** 中文说明：上下文局部值 represented，由紧邻初始化决定。 */
  const represented = new Set(rendered.represented.map(file => file.absolutePath))
  return {
    text: rendered.text,
    changes: items
      .filter(item => represented.has(item.file.absolutePath))
      .map(item => item.change),
  }
}

/** 中文说明：函数 markerText 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function markerText(maxBytes: number, omitted: InstructionFile[], truncated: TruncatedInstruction[]): string {
  if (omitted.length === 0 && truncated.length === 0) return ''
  /** 中文说明：上下文局部值 parts，由紧邻初始化决定。 */
  const parts: string[] = []
  if (omitted.length > 0) {
    parts.push(`omitted ${omitted.map(file => file.displayPath).join(', ')}`)
  }
  if (truncated.length > 0) {
    parts.push(`truncated ${truncated.map(item => `${item.displayPath} from ${item.originalBytes} to ${item.includedBytes} bytes`).join(', ')}`)
  }
  return `Workspace instruction budget ${maxBytes} bytes: ${parts.join('; ')}`
}

/** 中文说明：函数 buildInstructionText 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function buildInstructionText(
  files: LoadedInstructionFile[],
  maxBytes: number,
  omitted: InstructionFile[],
  truncated: TruncatedInstruction[],
  style: RenderStyle,
): string {
  /** 中文说明：上下文局部值 marker，由紧邻初始化决定。 */
  const marker = markerText(maxBytes, omitted, truncated)
  /** 中文说明：上下文局部值 body，由紧邻初始化决定。 */
  const body = [marker, style.intro, ...files.map(file => style.section(file))].filter(block => block.length > 0)
  // Caller-owned framing: the plugin bakes the complete `<system-reminder>`
  // frame into the message content. The session surface projects context
  // verbatim and does not wrap it, so any framing must live here in the
  // producer's content (the pattern a future `meta`-driven renderer would
  // generalize — see the deferred note in
  // ../../../../.agents/notes/implemented/simplification/2026-07-20-unwrap-injected-content-envelopes.md).
  return [SYSTEM_REMINDER_OPEN, escapeInstructionFrameBody(body.join('\n\n')), SYSTEM_REMINDER_CLOSE].join('\n')
}

/** 中文说明：函数 withTruncatedContent 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function withTruncatedContent(file: LoadedInstructionFile, includedBytes: number): LoadedInstructionFile {
  return { ...file, content: truncateUtf8(file.content, includedBytes) }
}

/** 中文说明：函数 truncateToFit 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function truncateToFit(
  file: LoadedInstructionFile,
  includedFiles: LoadedInstructionFile[],
  maxBytes: number,
  omitted: InstructionFile[],
  style: RenderStyle,
): LoadedInstructionFile {
  /** 中文说明：上下文局部值 originalBytes，由紧邻初始化决定。 */
  const originalBytes = byteLength(file.content)
  /** 中文说明：上下文局部值 low，由紧邻初始化决定。 */
  let low = 0
  /** 中文说明：上下文局部值 high，由紧邻初始化决定。 */
  let high = originalBytes
  /** 中文说明：上下文局部值 best，由紧邻初始化决定。 */
  let best = withTruncatedContent(file, 0)
  while (low <= high) {
    /** 中文说明：上下文局部值 mid，由紧邻初始化决定。 */
    const mid = Math.floor((low + high) / 2)
    /** 中文说明：上下文局部值 candidate，由紧邻初始化决定。 */
    const candidate = withTruncatedContent(file, mid)
    /** 中文说明：上下文局部值 truncated，由紧邻初始化决定。 */
    const truncated = [{ displayPath: file.displayPath, originalBytes, includedBytes: byteLength(candidate.content) }]
    /** 中文说明：上下文局部值 text，由紧邻初始化决定。 */
    const text = buildInstructionText([...includedFiles, candidate], maxBytes, omitted, truncated, style)
    if (byteLength(text) <= maxBytes) {
      best = candidate
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return best
}

/** 中文说明：函数 renderInstructionContext 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function renderInstructionContext(
  files: LoadedInstructionFile[],
  maxBytes: number,
  style: RenderStyle,
): RenderedInstructionContext {
  if (maxBytes <= 0 || !Number.isFinite(maxBytes)) {
    return { text: '', omitted: files, truncated: [], represented: [] }
  }

  /** 中文说明：上下文局部值 fullText，由紧邻初始化决定。 */
  const fullText = buildInstructionText(files, maxBytes, [], [], style)
  if (byteLength(fullText) <= maxBytes) {
    return { text: fullText, omitted: [], truncated: [], represented: files }
  }

  /** 中文说明：上下文局部值 start，由紧邻初始化决定。 */
  for (let start = 1; start < files.length; start += 1) {
    /** 中文说明：上下文局部值 included，由紧邻初始化决定。 */
    const included = files.slice(start)
    /** 中文说明：上下文局部值 omitted，由紧邻初始化决定。 */
    const omitted = files.slice(0, start).map(file => ({ absolutePath: file.absolutePath, displayPath: file.displayPath }))
    /** 中文说明：上下文局部值 suffixText，由紧邻初始化决定。 */
    const suffixText = buildInstructionText(included, maxBytes, omitted, [], style)
    if (byteLength(suffixText) <= maxBytes) return { text: suffixText, omitted, truncated: [], represented: included }
  }

  /** 中文说明：上下文局部值 mostSpecific，由紧邻初始化决定。 */
  const mostSpecific = files.at(-1)
  /* v8 ignore next -- callers only reach this after a non-empty fullText was built. */
  if (mostSpecific === undefined) return { text: '', omitted: [], truncated: [], represented: [] }
  /** 中文说明：上下文局部值 omitted，由紧邻初始化决定。 */
  const omitted = files.slice(0, -1).map(file => ({ absolutePath: file.absolutePath, displayPath: file.displayPath }))
  /** 中文说明：上下文局部值 originalBytes，由紧邻初始化决定。 */
  const originalBytes = byteLength(mostSpecific.content)

  /** 中文说明：上下文局部值 candidateStyle，由紧邻初始化决定。 */
  for (const candidateStyle of [style, { ...style, intro: COMPACT_WORKSPACE_CONTEXT_INTRO }]) {
    /** 中文说明：上下文局部值 truncatedFile，由紧邻初始化决定。 */
    const truncatedFile = truncateToFit(mostSpecific, [], maxBytes, omitted, candidateStyle)
    /** 中文说明：上下文局部值 includedBytes，由紧邻初始化决定。 */
    const includedBytes = byteLength(truncatedFile.content)
    /** 中文说明：上下文局部值 truncated，由紧邻初始化决定。 */
    const truncated = [{
      displayPath: mostSpecific.displayPath,
      originalBytes,
      includedBytes,
    }]
    /** 中文说明：上下文局部值 text，由紧邻初始化决定。 */
    const text = buildInstructionText([truncatedFile], maxBytes, omitted, truncated, candidateStyle)
    if (byteLength(text) <= maxBytes) {
      /** 中文说明：上下文局部值 represented，由紧邻初始化决定。 */
      const represented = includedBytes > 0 || originalBytes === 0 ? [mostSpecific] : []
      return { text, omitted, truncated, represented }
    }
  }

  /** 中文说明：上下文局部值 truncated，由紧邻初始化决定。 */
  const truncated = [{
    displayPath: mostSpecific.displayPath,
    originalBytes,
    includedBytes: 0,
  }]
  /** 中文说明：上下文局部值 compactNotice，由紧邻初始化决定。 */
  const compactNotice = escapeInstructionFrameBody(markerText(maxBytes, omitted, truncated))
  /** 中文说明：上下文局部值 compactWithHeading，由紧邻初始化决定。 */
  const compactWithHeading = escapeInstructionFrameBody(
    [compactNotice, style.section(withTruncatedContent(mostSpecific, 0))].join('\n\n'),
  )
  if (byteLength(compactWithHeading) <= maxBytes) {
    /** 中文说明：上下文局部值 represented，由紧邻初始化决定。 */
    const represented = originalBytes === 0 ? [mostSpecific] : []
    return { text: compactWithHeading, omitted, truncated, represented }
  }
  /** 中文说明：上下文局部值 text，由紧邻初始化决定。 */
  const text = byteLength(compactNotice) <= maxBytes ? compactNotice : truncateUtf8(compactNotice, maxBytes)
  return { text, omitted, truncated, represented: [] }
}

/**
 * Render a baseline together with the exact source files semantically represented in it.
 * @param files - loaded files ordered from broadest to most specific.
 * @param options - rendering byte budget and whether this baseline supersedes a visible predecessor.
 * @returns bounded public rendering plus files with surviving content, including genuinely empty files.
 * @internal
 */
/** 中文说明：函数 renderWorkspaceInstructionSet 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function renderWorkspaceInstructionSet(
  files: LoadedInstructionFile[],
  options: { maxBytes: number; replacePreviousBaseline?: boolean },
): { rendered: RenderedWorkspaceContext; included: LoadedInstructionFile[] } {
  /** 中文说明：上下文局部值 style，由紧邻初始化决定。 */
  const style = baselineRenderStyle(files, options.replacePreviousBaseline)
  /** 中文说明：上下文局部值 解构结果，由紧邻初始化决定。 */
  const { represented, ...rendered } = renderInstructionContext(files, options.maxBytes, style)
  return { rendered, included: represented }
}

/**
 * Render the baseline instruction chain with deterministic precedence budgeting.
 * @param files - loaded files ordered from broadest to most specific.
 * @param options - rendering byte budget and whether this baseline supersedes a visible predecessor.
 * @returns bounded baseline prompt text and budget diagnostics.
 */
/** 中文说明：函数 renderWorkspaceContext 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function renderWorkspaceContext(
  files: LoadedInstructionFile[],
  options: { maxBytes: number; replacePreviousBaseline?: boolean },
): RenderedWorkspaceContext {
  return renderWorkspaceInstructionSet(files, options).rendered
}
