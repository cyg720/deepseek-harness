/**
 * Pure ACP transcript and session-log normalizers. They scrub session ids, run cwd, RPC ids,
 * timestamps, goal lifecycle clocks, and hook duration while preserving semantic payload values.
 * Request-header scrubbers stay composable so one scenario per header class can pin prompt and
 * tool-schema sidecars.
 * @module @deepseek-ai/dsh-session-snapshot/normalize
 */
/*
 * 文件职责：实现 normalize.ts 覆盖的ACP 快照测试支持行为与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、进程流、终端会话或快照规范化。
 * 产品维度：保障 Agent 的ACP 快照测试支持能力稳定、可复现且可诊断。
 * 逻辑维度：准备输入和资源，执行核心流程，收集事件或输出，再处理错误与清理。
 * 关键边界：进程退出与取消可能竞态；外部输出不可信；清理必须等待子资源完全停止。
 * 新手阅读建议：先看类型和夹具，再读启动/收集主流程，最后关注平台差异、规范化和清理。
 */

import {
  decodeSeqRanges,
} from '@deepseek-ai/dsh-session'
import { prepareSessionSnapshotFixtureForComparison } from '@deepseek-ai/dsh-llm-replay'
import { redactSessionSnapshotIds } from './identity.ts'

const SESSION_ID = '{{sessionId}}'
const MESSAGE_ID = '{{messageId}}'
const USED_TOKENS = '{{usedTokens}}'
const CWD = '{{cwd}}'
/** 中文说明：常量 SYSTEM 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const SYSTEM = '{{system}}'
/** 中文说明：常量 TOOLS 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const TOOLS = '{{tools}}'
/** 中文说明：常量 EVENT_TIME 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const EVENT_TIME = '{{eventTime}}'
/** 中文说明：常量 EVENT_OMITTED_BYTES 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const EVENT_OMITTED_BYTES = '{{eventOmittedBytes}}'
/** 中文说明：常量 PACKED_CHUNK_ROW_TYPES 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const PACKED_CHUNK_ROW_TYPES = new Set(['text-chunks', 'reasoning-chunks', 'tool-call-chunks'])

/** 中文说明：函数 isPackedFixtureRow 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function isPackedFixtureRow(record: Record<string, unknown>): boolean {
  return typeof record.type === 'string' && PACKED_CHUNK_ROW_TYPES.has(record.type)
}

/** 中文说明：函数 omitFixtureEnvelope 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function omitFixtureEnvelope(record: Record<string, unknown>): void {
  delete record.seq
  delete record.time
  delete record.seq0
  delete record.time0
}

/** A cwd-rooted path after volatile cwd replacement, through its last separator-delimited segment. */
/* 中文说明：常量 CWD_ROOTED_PATH_RE 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const CWD_ROOTED_PATH_RE = /\{\{cwd\}\}(?:[\\/][^\s<>"'`]+)+/g
const PATH_TAG_RE = /(<path>)([^<]*)(<\/path>)/g
const ADDITIONAL_INSTRUCTIONS_PATH_RE = /(Additional instructions from: )([^\r\n]+)/g
const EMBEDDED_EVENT_TIME_RE = /^(  "time": )\d+(?=,\r?$)/gm
const EVENT_READ_OMITTED_BYTES_RE = /(\r?\n\r?\n\(Omitted )\d+( bytes\.)/g
const EVENT_READ_TARGET_REGION_RE
  = /^Session [^\r\n]+ — [^\r\n]+\r?\nTarget event seq \d+:\r?\n```json\r?\n\{\r?\n[\s\S]*?(?=\r?\n```(?:\r?\n|$)|\r?\n\r?\n\(Omitted )/
const PATH_TEXT_BOUNDARY_RE = /[\s<>'"`()\[\]{},;:!?=]/
/** 中文说明：常量 FILE_URI_PATH_PREFIX_RE 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const FILE_URI_PATH_PREFIX_RE = /(?:^|[^a-z0-9+.-])file:\/\/\/?$/i

/** A UUID v4 string, the shape `randomUUID()` produces for session ids. */
/* 中文说明：常量 UUID_RE 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
/** 中文说明：常量 LOCAL_SPILL_PATH_RE 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const LOCAL_SPILL_PATH_RE = new RegExp(
  String.raw`\{\{cwd\}\}[\\/]\.spill[\\/]session-[0-9a-f]{12}[\\/][0-9a-f]{12}-([A-Za-z0-9._~-]+?)`
  + String.raw`(?=\. Use read with offset/limit|[\s)]|$)`,
  'g',
)
/** 中文说明：常量 SNAPSHOT_SPILL_PATH_RE 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const SNAPSHOT_SPILL_PATH_RE = new RegExp(
  String.raw`(?:[A-Za-z]:)?[\\/](?:tmp|t)[\\/](?:dsh-acp-snap-[0-9a-f]{9}|dsh-acp-snapshot-spill)[\\/]session-[0-9a-f]{12}[\\/][0-9a-f]{12}-([A-Za-z0-9._~-]+?)`
  + String.raw`(?=\. Use read with offset/limit|[\s)]|$)`,
  'g',
)

/**
 * Extract every snapshot-mode spill path from a session log, keyed by spill
 * filename. Used by refresh write-back to keep spill paths stable across runs.
 * @param content - the raw session log text to scan.
 * @returns spill filename → the full matched spill path, last match wins per name.
 */
/*
 * 中文说明：函数 extractSnapshotSpillPaths 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param content 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function extractSnapshotSpillPaths(content: string): Map<string, string> {
  /** 中文说明：变量 result 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const result = new Map<string, string>()
  /** 中文说明：该循环依次处理事件或输出；循环变量仅在当前循环中有效。 */
  for (const match of content.matchAll(SNAPSHOT_SPILL_PATH_RE)) {
    /** 中文说明：变量 name 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const name = match[1]
    /* v8 ignore next -- the filename capture is required and non-empty whenever the spill regex matches */
    if (name === undefined) continue
    result.set(name, match[0])
  }
  return result
}

/** Convert separators only inside generated path-bearing text markers. */
/* 中文说明：函数 canonicalizeEmbeddedPaths 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function canonicalizeEmbeddedPaths(value: string): string {
  return value
    .replace(PATH_TAG_RE, (_match, open: string, path: string, close: string) =>
      `${open}${path.replaceAll('\\', '/')}${close}`)
    .replace(ADDITIONAL_INSTRUCTIONS_PATH_RE, (_match, prefix: string, path: string) =>
      `${prefix}${path.replaceAll('\\', '/')}`)
}

/** Inputs the normalizers need to recognize a run's volatile values. */
/* 中文说明：interface NormalizeContext 定义本模块所需的数据或行为，用于表达ACP 快照测试支持场景。 */
export interface NormalizeContext {
  /** The session id(s) the run issued — replaced with `{{sessionId}}`. */
  sessionIds: string[]
  /** The generated cwd the run used — replaced with `{{cwd}}`. */
  cwd: string
  /** Other filesystem spellings of the same cwd (for example Windows short and long paths). */
  cwdAliases?: readonly string[]
}

/** How cwd-rooted path separators are represented after the cwd is tokenized. */
/* 中文说明：type CwdPathMode 定义本模块所需的数据或行为，用于表达ACP 快照测试支持场景。 */
export type CwdPathMode = 'canonical' | 'native'

/** Optional controls shared by stdout and session-log normalization. */
/* 中文说明：interface NormalizeOptions 定义本模块所需的数据或行为，用于表达ACP 快照测试支持场景。 */
export interface NormalizeOptions {
  /** Use `/` for shared goldens, or preserve captured separators for a platform-specific golden. */
  cwdPathMode?: CwdPathMode
  /** Keep already-redacted typed ids and arbitrary UUID-like prose unchanged. */
  identityMode?: 'legacy' | 'preserve'
}

/** Return every known spelling of the generated cwd, most specific first. */
/* 中文说明：函数 cwdSpellings 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function cwdSpellings(ctx: NormalizeContext): string[] {
  /** 中文说明：变量 spellings 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const spellings = [...new Set([ctx.cwd, ...ctx.cwdAliases ?? []])]
    .filter(spelling => spelling.length > 0)
  /** 中文说明：变量 macAliases 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const macAliases = spellings
    .filter(spelling => spelling.startsWith('/') && !spelling.startsWith('/private/'))
    .map(spelling => `/private${spelling}`)
  return [...new Set([...spellings, ...macAliases])]
    .sort((left, right) => right.length - left.length)
}

/** Whether an embedded cwd match starts and ends at a path/text boundary. */
/* 中文说明：函数 isCwdMatch 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function isCwdMatch(value: string, start: number, length: number): boolean {
  /** 中文说明：变量 before 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const before = value[start - 1]
  /** 中文说明：变量 after 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const after = value[start + length]
  /** 中文说明：变量 afterPunctuation 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const afterPunctuation = value[start + length + 1]
  /** 中文说明：变量 startsAtBoundary 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const startsAtBoundary = before === undefined
    || PATH_TEXT_BOUNDARY_RE.test(before)
    || FILE_URI_PATH_PREFIX_RE.test(value.slice(0, start))
  /** 中文说明：变量 endsAtBoundary 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const endsAtBoundary = after === undefined
    || after === '/'
    || after === '\\'
    || PATH_TEXT_BOUNDARY_RE.test(after)
    || after === '.' && (afterPunctuation === undefined || PATH_TEXT_BOUNDARY_RE.test(afterPunctuation))
  return startsAtBoundary && endsAtBoundary
}

/** Replace one cwd spelling without matching a longer path segment that merely shares its prefix. */
/* 中文说明：函数 replaceCwdSpelling 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function replaceCwdSpelling(value: string, spelling: string, replacement: string): string {
  /** 中文说明：变量 cursor 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let cursor = 0
  /** 中文说明：变量 out 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let out = ''
  while (cursor < value.length) {
    /** 中文说明：变量 match 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const match = value.indexOf(spelling, cursor)
    if (match < 0) return out + value.slice(cursor)
    /** 中文说明：变量 end 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const end = match + spelling.length
    if (isCwdMatch(value, match, spelling.length)) {
      out += value.slice(cursor, match) + replacement
      cursor = end
    } else {
      out += value.slice(cursor, end)
      cursor = end
    }
  }
  return out
}

/** Replace every known cwd spelling with one stable token. */
/* 中文说明：函数 replaceCwd 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function replaceCwd(value: string, ctx: NormalizeContext, replacement: string): string {
  /** 中文说明：变量 out 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let out = value
  /** 中文说明：该循环依次处理事件或输出；循环变量仅在当前循环中有效。 */
  for (const spelling of cwdSpellings(ctx)) out = replaceCwdSpelling(out, spelling, replacement)
  return out
}

/** Replace cwd, session ids, and any stray UUID with stable tokens in a string. */
function scrubString(
  value: string,
  ctx: NormalizeContext,
  cwdPathMode: CwdPathMode,
  identityMode: 'legacy' | 'preserve',
): string {
  let out = replaceCwd(value, ctx, CWD)
  // Filesystem APIs can report one directory with several spellings. Replace
  // every known spelling longest-first so a shorter alias cannot corrupt a
  // longer one before it is tokenized. macOS additionally symlinks
  // /tmp → /private/tmp and /var → /private/var: the session header cwd may
  // omit the /private prefix while fs tools resolve symlinks, so cover the
  // prefixed form of every spelling too, then collapse a residual prefixed
  // token.
  out = out.split(`/private${CWD}`).join(CWD)
  if (cwdPathMode === 'canonical') {
    // Restrict separator conversion to paths rooted at the cwd token. A global
    // backslash rewrite would corrupt regexes, commands, and model-authored text.
    out = out.replace(CWD_ROOTED_PATH_RE, path => path.replaceAll('\\', '/'))
    out = canonicalizeEmbeddedPaths(out)
  }
  out = out.replace(LOCAL_SPILL_PATH_RE, (_match, name: string) => `{{spillLocator:${name}}}`)
  out = out.replace(SNAPSHOT_SPILL_PATH_RE, (_match, name: string) => `{{spillLocator:${name}}}`)
  // Exact event-read results render the target as pretty JSON inside a
  // distinctive envelope. Restrict time scrubbing to that fenced target so
  // neighbor, model, bash, and unrelated tool text remains regression-visible.
  if (EVENT_READ_TARGET_REGION_RE.test(out)) {
    out = out.replace(
      EVENT_READ_TARGET_REGION_RE,
      target => target.replace(EMBEDDED_EVENT_TIME_RE, `$1${EVENT_TIME}`),
    )
    out = out.replace(EVENT_READ_OMITTED_BYTES_RE, `$1${EVENT_OMITTED_BYTES}$2`)
  }
  if (identityMode === 'legacy') {
    for (const id of ctx.sessionIds) out = out.split(id).join(SESSION_ID)
    out = out.replace(UUID_RE, SESSION_ID)
  }
  return out
}

/** Recursively scrub a parsed JSON value (strings replaced; structure kept). */
function scrubValue(
  value: unknown,
  ctx: NormalizeContext,
  cwdPathMode: CwdPathMode,
  identityMode: 'legacy' | 'preserve',
  key?: string,
): unknown {
  if (typeof value === 'string') {
    if (identityMode === 'legacy' && key === 'messageId') return MESSAGE_ID
    const scrubbed = scrubString(value, ctx, cwdPathMode, identityMode)
    return cwdPathMode === 'canonical' && key === 'path' ? scrubbed.replaceAll('\\', '/') : scrubbed
  }
  if (Array.isArray(value)) return value.map(v => scrubValue(v, ctx, cwdPathMode, identityMode))
  if (value !== null && typeof value === 'object') {
    /** 中文说明：变量 out 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = scrubValue(v, ctx, cwdPathMode, identityMode, k)
    if (
      (value as { sessionUpdate?: unknown }).sessionUpdate === 'usage_update'
      && typeof (value as { used?: unknown }).used === 'number'
    ) out.used = USED_TOKENS
    return out
  }
  return value
}

/** Escape one literal path segment for use in a regular expression. */
/* 中文说明：函数 escapeRegExp 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Replace any absolute spelling whose final segment is the generated cwd basename. */
/* 中文说明：函数 tokenizeFixtureString 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function tokenizeFixtureString(value: string, ctx: NormalizeContext, basename: string): string {
  /** 中文说明：变量 exact 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const exact = replaceCwd(value, ctx, CWD)
  /** 中文说明：变量 absoluteCwd 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const absoluteCwd = new RegExp(
    String.raw`(?:[A-Za-z]:)?[\\/](?:[^\\/\s<>"]+[\\/])*${escapeRegExp(basename)}`
    + String.raw`(?=$|[\\/\s<>'"()\[\]{},;:!?=])`,
    'g',
  )
  return exact.replace(absoluteCwd, CWD).split(`/private${CWD}`).join(CWD)
}

/** Recursively replace generated-cwd spellings while preserving every other JSON value. */
/* 中文说明：函数 tokenizeFixtureValue 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function tokenizeFixtureValue(
  value: unknown,
  ctx: NormalizeContext,
  basename: string,
): unknown {
  if (typeof value === 'string') return tokenizeFixtureString(value, ctx, basename)
  if (Array.isArray(value)) return value.map(item => tokenizeFixtureValue(item, ctx, basename))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      tokenizeFixtureValue(item, ctx, basename),
    ]))
  }
  return value
}

/**
 * Store one generated workspace as `{{cwd}}` while retaining every other
 * session value. The caller opts in only for workspaces created under a
 * platform temporary root; explicitly relocated workspaces keep their real
 * path.
 *
 * @param rawLog The raw or refresh-stabilized session JSONL fixture.
 * @returns Compact JSONL whose known cwd spellings become `{{cwd}}`.
 * @throws If a non-empty line is invalid JSON or the session cwd has no basename.
 */
/*
 * 中文说明：函数 tokenizeSessionFixtureCwd 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param rawLog 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function tokenizeSessionFixtureCwd(rawLog: string): string {
  /** 中文说明：变量 lines 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const lines = rawLog.split('\n')
  /** 中文说明：函数值 firstLine 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const firstLine = lines.find(line => line.trim().length > 0)
  /** 中文说明：变量 header 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const header = firstLine === undefined ? undefined : JSON.parse(firstLine) as { cwd?: unknown }
  /** 中文说明：变量 cwd 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const cwd = typeof header?.cwd === 'string' ? header.cwd : ''
  /** 中文说明：变量 basename 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const basename = cwd.split(/[\\/]/).at(-1)
  if (basename === undefined || basename.length === 0) {
    throw new Error('acp-snapshot: cannot tokenize a cwd without a basename')
  }
  /** 中文说明：变量 ctx 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx: NormalizeContext = { sessionIds: [], cwd }
  return lines.map((line) => {
    if (line.trim().length === 0) return line
    return JSON.stringify(tokenizeFixtureValue(JSON.parse(line), ctx, basename))
  }).join('\n')
}

/**
 * Normalize a raw stdout transcript (newline-delimited JSON-RPC frames) into a stable expected output
 * in the same shape as the wire: one compact JSON frame per line (NDJSON), with the JSON-RPC
 * `id` rewritten to a per-transcript sequence (1, 2, 3, …) and all volatile strings scrubbed.
 * Invalid JSON throws, doubling as a protocol-stdout purity check.
 *
 * @param rawStdout The captured stdout bytes, decoded utf8.
 * @param ctx The run's volatile values to scrub.
 * @param options Separator output controls; shared canonical paths are the default.
 * @returns The normalized NDJSON transcript, one frame per line.
 */
/*
 * 中文说明：函数 normalizeStdout 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param rawStdout 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param ctx 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param options 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function normalizeStdout(
  rawStdout: string,
  ctx: NormalizeContext,
  options: NormalizeOptions = {},
): string {
  /** 中文说明：变量 cwdPathMode 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const cwdPathMode = options.cwdPathMode ?? 'canonical'
  const identityMode = options.identityMode ?? 'legacy'
  const lines = rawStdout.split('\n').filter(line => line.trim().length > 0)
  // Map each distinct JSON-RPC id (request/response correlate by id) to a stable
  // sequence number, in first-seen order, so id churn doesn't perturb the expected output.
  /** 中文说明：变量 idSeq 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const idSeq = new Map<string, number>()
  /** 中文说明：函数值 stableId 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const stableId = (id: unknown): number => {
    /** 中文说明：变量 key 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const key = JSON.stringify(id)
    /** 中文说明：变量 n 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let n = idSeq.get(key)
    if (n === undefined) { n = idSeq.size + 1; idSeq.set(key, n) }
    return n
  }
  /** 中文说明：函数值 frames 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const frames = lines.map((line) => {
    /** 中文说明：变量 frame 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const frame = JSON.parse(line) as Record<string, unknown>
    if ('id' in frame && frame.id !== undefined && frame.id !== null) {
      frame.id = stableId(frame.id)
    }
    return scrubValue(frame, ctx, cwdPathMode, identityMode) as Record<string, unknown>
  })
  return frames.map(f => JSON.stringify(f)).join('\n') + '\n'
}

/**
 * Normalize a session JSONL log into a stable expected output: the header line's
 * volatile fields (`createdAt`, `id`, `cwd`) are zeroed/scrubbed; event,
 * historical packed-row, embedded Assistant-stream, and goal lifecycle clocks
 * are zeroed; and all volatile strings are scrubbed. Projected inputs remain
 * projected. Packed `data.dt` gaps are normalized even when the projected row
 * omits its `time0` anchor.
 * Output is JSONL in the same shape as the input — one compact record per
 * line.
 *
 * @param rawLog The raw session `.jsonl` content.
 * @param ctx The run's volatile values to scrub.
 * @param options Separator output controls; shared canonical paths are the default.
 * @returns The normalized JSONL log, one record per line.
 */
/*
 * 中文说明：函数 normalizeSessionLog 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param rawLog 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param ctx 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param options 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function normalizeSessionLog(
  rawLog: string,
  ctx: NormalizeContext,
  options: NormalizeOptions = {},
): string {
  /** 中文说明：变量 cwdPathMode 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const cwdPathMode = options.cwdPathMode ?? 'canonical'
  const identityMode = options.identityMode ?? 'legacy'
  const lines = rawLog.split('\n').filter(line => line.trim().length > 0)
  /** 中文说明：函数值 records 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const records = lines.map((line) => {
    /** 中文说明：变量 record 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const record = JSON.parse(line) as Record<string, unknown>
    if (record.type === 'session') {
      if ('createdAt' in record) record.createdAt = 0
    } else if (isPackedFixtureRow(record)) {
      if ('time0' in record) record.time0 = 0
      /** 中文说明：变量 data 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const data = record.data
      if (data !== null && typeof data === 'object' && Array.isArray((data as { dt?: unknown }).dt)) {
        (data as { dt: unknown[] }).dt = (data as { dt: unknown[] }).dt.map(() => 0)
      }
    } else if ('time' in record) {
      record.time = 0
    }
    if ((record.type === 'assistant/message' || record.type === 'assistant/attempt')
      && record.data !== null && typeof record.data === 'object') {
      const stream = (record.data as { stream?: unknown }).stream
      if (Array.isArray(stream)) {
        for (const member of stream) {
          if (member === null || typeof member !== 'object') continue
          const timed = member as { time?: unknown; time0?: unknown; dt?: unknown }
          if (typeof timed.time === 'number') timed.time = 0
          if (typeof timed.time0 === 'number') timed.time0 = 0
          if (Array.isArray(timed.dt)) timed.dt = timed.dt.map(() => 0)
        }
      }
    }
    if (record.type === 'hook/result' && record.data !== null && typeof record.data === 'object') {
      /** 中文说明：变量 data 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const data = record.data as Record<string, unknown>
      if ('durationMs' in data) data.durationMs = 0
    }
    if (record.type === 'goal/change' && record.data !== null && typeof record.data === 'object') {
      const data = record.data as Record<string, unknown>
      if ('createdAt' in data) data.createdAt = 0
      if ('updatedAt' in data) data.updatedAt = 0
    }
    if (Object.hasOwn(record, 'sourceEventSeqs')) {
      record.sourceEventSeqs = decodeSeqRanges(record.sourceEventSeqs)
    }
    return scrubValue(record, ctx, cwdPathMode, identityMode) as Record<string, unknown>
  })
  return records.map(r => JSON.stringify(r)).join('\n') + '\n'
}

/**
 * Canonicalize projected v2 body records. Compact streams are nested event data,
 * so persistence flush boundaries cannot change the row layout.
 */
function projectSessionSnapshot(rawLog: string): string {
  const lines = rawLog.split('\n').filter(line => line.trim().length > 0)
  const header = lines.shift() as string

  const body = lines.map((line) => {
    const record = JSON.parse(line) as Record<string, unknown>
    const projected = { ...record }
    omitFixtureEnvelope(projected)
    return JSON.stringify(projected)
  })
  return [header, ...body, ''].join('\n')
}

/**
 * Normalize and project persisted session JSONL for a committed fixture.
 * This composes ordinary log normalization with request-header scrubbing and
 * persistence-envelope projection, then writes the v2 logical event stream as
 * one record per event, independent of persistence flush boundaries.
 *
 * @param rawLog - persisted or already-projected session JSONL.
 * @param ctx - the run's volatile values to scrub.
 * @param options - separator output controls.
 * @returns normalized committed session snapshot JSONL.
 */
/*
 * 中文说明：函数 normalizeSessionSnapshot 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param rawLog 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param ctx 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param options 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function normalizeSessionSnapshot(
  rawLog: string,
  ctx: NormalizeContext,
  options: NormalizeOptions = {},
): string {
  return projectSessionSnapshot(scrubSessionSnapshot(normalizeSessionLog(rawLog, ctx, options)))
}

/**
 * Normalize one scenario's primary and child logs with shared typed identity redaction.
 * @param rawLogs - primary-first persisted or projected session JSONL.
 * @param ctx - generated cwd spellings and other volatile run facts.
 * @param options - separator controls; relationship-preserving identity mode is mandatory.
 * @returns normalized session fixtures in input order.
 */
export function normalizeSessionSnapshots(
  rawLogs: readonly string[],
  ctx: NormalizeContext,
  options: Omit<NormalizeOptions, 'identityMode'> = {},
): string[] {
  const currentLogs = rawLogs.map(log => hasSessionFormatVersion(log)
    ? prepareSessionSnapshotFixtureForComparison(log)
    : log)
  const comparableLogs = currentLogs.map(normalizeSessionFormatProvenance)
  return redactSessionSnapshotIds(comparableLogs).map(log => projectSessionSnapshot(
    scrubSessionSnapshot(normalizeSessionLog(
      log,
      { ...ctx, sessionIds: [] },
      { ...options, identityMode: 'preserve' },
    )),
  ))
}

/**
 * Omit only generation-qualified operational provenance from expected-output comparison.
 * @param rawLog - Session records or events as compact JSON lines.
 * @returns the same records without delivery or captured-source generation qualifiers.
 */
export function normalizeSessionFormatProvenance(rawLog: string): string {
  return rawLog.split('\n').map((line) => {
    if (line.trim().length === 0) return line
    const record = JSON.parse(line) as Record<string, unknown>
    let changed = normalizeCapturedFormatProvenance(record)
    if (record.type === 'session' && Object.hasOwn(record, 'version')) {
      delete record.version
      changed = true
    }
    if (record.type === 'session-log-deepseek/delivery-accepted'
      && record.data !== null && typeof record.data === 'object' && !Array.isArray(record.data)) {
      const data = { ...record.data as Record<string, unknown> }
      if (Object.hasOwn(data, 'sessionFormatVersion')) {
        delete data.sessionFormatVersion
        record.data = data
        changed = true
      }
    }
    return changed ? JSON.stringify(record) : line
  }).join('\n')
}

/** Omit captured generations only from an actual current Message source position. */
function normalizeCapturedFormatProvenance(event: Record<string, unknown>): boolean {
  if (event.data === null || typeof event.data !== 'object' || Array.isArray(event.data)) return false
  const data = event.data as Record<string, unknown>
  const message = event.type === 'user/message'
    ? data
    : event.type === 'assistant/message' || event.type === 'tool/result'
      ? data.message
      : undefined
  if (message === null || typeof message !== 'object' || Array.isArray(message)) return false
  const source = (message as Record<string, unknown>).source
  if (source === null || typeof source !== 'object' || Array.isArray(source)) return false
  const record = source as Record<string, unknown>
  if (record.kind !== 'session-reference' || record.form !== 'recall' || record.version !== 1
    || !Array.isArray(record.references)) return false
  let changed = false
  for (const reference of record.references) {
    if (reference === null || typeof reference !== 'object' || Array.isArray(reference)) continue
    const captured = reference as Record<string, unknown>
    if (Object.hasOwn(captured, 'capturedFormatVersion')) {
      delete captured.capturedFormatVersion
      changed = true
    }
  }
  return changed
}

/** Whether a fixture declares a released Session format and therefore participates in migration burn-in. */
function hasSessionFormatVersion(rawLog: string): boolean {
  const firstLine = rawLog.split(/\r?\n/).find(line => line.trim().length > 0)
  if (firstLine === undefined) throw new Error('session snapshot must start with a session header')
  const header = JSON.parse(firstLine) as unknown
  if (header === null || typeof header !== 'object' || Array.isArray(header)
    || (header as Record<string, unknown>)['type'] !== 'session') {
    throw new Error('session snapshot must start with a session header')
  }
  return Object.hasOwn(header, 'version')
}

/**
 * Replace system-prompt content in request headers with `{{system}}` tokens
 * while retaining field presence.
 * Other header content stays verbatim, so a header-pinning fixture can keep
 * its complete tool schemas while every JSONL fixture omits the prompt text.
 * Lines without a system payload pass through byte-for-byte; the transform is
 * idempotent.
 *
 * @param rawLog The raw session `.jsonl` content.
 * @returns The JSONL with system-prompt content tokenized.
 */
/*
 * 中文说明：函数 scrubSystemPrompts 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param rawLog 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function scrubSystemPrompts(rawLog: string): string {
  return scrubHeaderContent(rawLog, { system: true })
}

/**
 * Replace tool schemas in full request-header snapshots with `{{tools}}`
 * tokens while retaining field presence. System prompts and session-prefix
 * messages stay verbatim so pinning fixtures can move only schema bulk into
 * their dedicated JSON sidecar. Lines without a tool payload pass through
 * byte-for-byte; the transform is idempotent.
 *
 * @param rawLog The raw session `.jsonl` content.
 * @returns The JSONL with tool-schema content tokenized.
 */
/*
 * 中文说明：函数 scrubToolSchemas 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param rawLog 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function scrubToolSchemas(rawLog: string): string {
  return scrubHeaderContent(rawLog, { tools: true })
}

/**
 * Replace all bulky request-header content in a session JSONL with stable
 * tokens. This includes the system-prompt fields handled by
 * {@link scrubSystemPrompts}, tool schemas, and session-prefix messages. It
 * keeps prefix message counts, field presence, config, and reason. Lines
 * without content to scrub pass through byte-for-byte, and the transform is
 * idempotent.
 *
 * @param rawLog The raw session `.jsonl` content.
 * @returns The JSONL with all header bulk tokenized, other lines byte-identical.
 */
/*
 * 中文说明：函数 scrubRequestHeaders 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param rawLog 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function scrubRequestHeaders(rawLog: string): string {
  return scrubHeaderContent(rawLog, { system: true, tools: true })
}

/**
 * Project a persisted session log while tokenizing all request-header bulk.
 * Each non-empty line is parsed at most once; the session header stays
 * byte-identical. Body records omit their persistence-only envelopes, and
 * request-header payloads are tokenized.
 *
 * @param rawLog - persisted or already-projected session JSONL.
 * @returns committed snapshot JSONL with request headers tokenized.
 */
/*
 * 中文说明：函数 scrubSessionSnapshot 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param rawLog 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function scrubSessionSnapshot(rawLog: string): string {
  /** 中文说明：变量 scrubbed 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const scrubbed = scrubRequestHeaders(rawLog)
  /** 中文说明：变量 recordIndex 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let recordIndex = 0
  return scrubbed.split('\n').map((line) => {
    if (line.trim().length === 0) return line
    /** 中文说明：变量 record 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const record = JSON.parse(line) as Record<string, unknown>
    if (recordIndex++ === 0) {
      if (record.type !== 'session') throw new Error('session snapshot must start with a session header')
      return line
    }
    omitFixtureEnvelope(record)
    return JSON.stringify(record)
  }).join('\n')
}

/** Which independent request-header payloads a scrubber replaces. */
/* 中文说明：interface HeaderScrubOptions 定义本模块所需的数据或行为，用于表达ACP 快照测试支持场景。 */
interface HeaderScrubOptions {
  system?: boolean
  tools?: boolean
}

/** Transform the selected request-header payloads. */
/* 中文说明：函数 scrubHeaderContent 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function scrubHeaderContent(rawLog: string, options: HeaderScrubOptions): string {
  /** 中文说明：变量 lines 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const lines = rawLog.split('\n')
  /** 中文说明：函数值 out 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const out = lines.map((line) => {
    if (line.trim().length === 0) return line
    /** 中文说明：变量 record 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const record = JSON.parse(line) as Record<string, unknown>
    /** 中文说明：变量 data 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const data = record.data as Record<string, unknown> | null | undefined
    if (data === null || typeof data !== 'object') return line
    if (record.type === 'request/header') {
      /** 中文说明：变量 header 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const header = data.header as Record<string, unknown> | null | undefined
      if (header === null || typeof header !== 'object') return line
      /** 中文说明：变量 touched 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      let touched = false
      if (options.system === true && 'system' in header) { header.system = SYSTEM; touched = true }
      if (options.tools === true && 'tools' in header) { header.tools = TOOLS; touched = true }
      return touched ? JSON.stringify(record) : line
    }
    return line
  })
  return out.join('\n')
}
