/**
 * ================================ 文件注释 ================================
 * 【文件职责】会话引用的规范 URI 编码与内联提及（mention）语法：把任意会话 id
 *             编码成无损的 dsh-session: URI，并负责在用户文本里解析/生成
 *             Markdown 风格的 @[label](dsh-session:…) 提及。
 * 【技术维度】Base64url 编码（无 +/ 和 = 填充，URI 友好）；双向可逆（encode 与
 *             decode 互逆，且 decode 校验规范性）；正则提取提及与裸 URI。
 * 【产品维度】用户在聊天里用 @ 提及另一个会话时，Host 需要把这个提及翻译成
 *             结构化引用，模型看到的是可读的 @label，底层携带的是完整 URI。
 * 【逻辑维度】1) encode：session id 经 JSON + base64url 编码成 URI；2) decode：
 *             前缀/字符集/可逆性三重校验后还原 id；3) formatMention：生成
 *             @[label](uri)；4) parseText：一次正则同时匹配 Markdown 提及与
 *             裸 URI，替换为可读 @label 并收集结构化引用。
 * 【关键边界】只接受规范形式（encode 后再比对），防伪造/混用编码；label 中的
 *             反斜杠与方括号需转义（escapeLabel/unescapeLabel 成对出现）。
 * 【新手阅读建议】先看 encode/decode 的互逆关系，再看 parseSessionReferenceText
 *                 的正则结构与替换回调，最后看两个转义函数的成对关系。
 * ==========================================================================
 */

/** Canonical session URI and inline mention encoding. */

import { SessionId, type SessionId as SessionIdType } from '@deepseek-ai/dsh-session'
import { SessionReferenceError } from './config.ts'
import type { SessionReferenceInput } from './types.ts'

/** URI scheme reserved for DeepSeek Harness session snapshots. */
/** 保留给 DeepSeek Harness 会话快照的 URI 协议前缀：dsh-session:。 */
export const SESSION_REFERENCE_SCHEME = 'dsh-session:'

/**
 * Encode any JavaScript session-id string as a canonical lossless URI.
 * @param sessionId - opaque session id to serialize.
 * @returns canonical `dsh-session:` URI.
 */
/**
 * 把任意 JavaScript 字符串形式的会话 id 编码为规范的无损 URI。
 * 先 JSON 序列化再 base64url，保证任何字符（含非 UTF-8 安全的）都能无损还原。
 * @param sessionId 待序列化的不透明会话 id
 * @returns 规范形式 dsh-session: 前缀 + base64url 负载
 */
export function encodeSessionReferenceUri(sessionId: SessionIdType): string {
  const payload = Buffer.from(JSON.stringify(sessionId), 'utf8').toString('base64url')
  return `${SESSION_REFERENCE_SCHEME}${payload}`
}

/**
 * Decode and canonicalize one session-reference URI.
 * @param uri - complete canonical URI.
 * @returns decoded session id.
 */
/**
 * 解码并规范化一个会话引用 URI：解码出的 id 必须能重新编码出完全相同的
 * URI，否则视为伪造/非规范形式直接拒绝。
 * @param uri 完整的规范 URI
 * @returns 解码出的会话 id
 * @throws SessionReferenceError URI 前缀不对、负载字符非法、解码失败或非规范时抛出
 */
export function decodeSessionReferenceUri(uri: string): SessionIdType {
  if (!uri.startsWith(SESSION_REFERENCE_SCHEME)) {
    throw invalidUri(uri)
  }
  // base64url 字符集校验：只允许字母数字与 -_
  const payload = uri.slice(SESSION_REFERENCE_SCHEME.length)
  if (!/^[A-Za-z0-9_-]+$/.test(payload)) throw invalidUri(uri)
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (typeof parsed !== 'string') throw new TypeError('decoded session id is not a string')
    const sessionId = SessionId(parsed)
    // 规范性校验：重编码结果必须与输入完全一致
    if (encodeSessionReferenceUri(sessionId) !== uri) throw new TypeError('URI is not canonical')
    return sessionId
  } catch (error: unknown) {
    throw invalidUri(uri, error)
  }
}

/**
 * Render a host-neutral Markdown mention carrying the canonical URI.
 * @param reference - structured id and optional display label.
 * @returns escaped `@[label](uri)` mention.
 */
/**
 * 生成宿主无关的 Markdown 提及：@[label](uri)。label 缺省时用会话 id 本身，
 * 含特殊字符的 label 会被转义保证语法正确。
 * @param reference 结构化引用：会话 id 与可选展示 label
 * @returns 转义后的 @[label](uri) 提及文本
 */
export function formatSessionReferenceMention(reference: SessionReferenceInput): string {
  const label = escapeLabel(reference.label ?? reference.sessionId)
  return `@[${label}](${encodeSessionReferenceUri(reference.sessionId)})`
}

/** Result of extracting canonical mentions from plain text. */
/** 从纯文本中提取规范提及的结果：可读文本 + 结构化引用列表。 */
export interface ParsedSessionReferenceText {
  /** Text with opaque tokens replaced by readable `@label` spans. */
  /** 替换后的文本：原来的长 URI 都被换成可读的 @label 片段。 */
  text: string
  /** Structured references in first-appearance order, before service deduplication. */
  /** 按首次出现顺序收集的结构化引用（尚未经过服务层去重）。 */
  references: SessionReferenceInput[]
}

/**
 * Extract Markdown mentions and bare canonical URIs from one text value.
 * Explicit Markdown mentions fail on any malformed URI. Bare text is treated
 * as a reference only when it has a non-empty base64url-shaped payload, then
 * still fails if that candidate is not canonical.
 * @param text - host text to normalize.
 * @returns readable text and structured references in appearance order.
 */
/**
 * 从一段文本中提取 Markdown 提及与裸规范 URI。显式 Markdown 提及遇到
 * 畸形 URI 直接失败；裸文本只有负载长得像 base64url 才当作候选，
 * 且候选必须通过规范性校验。
 * @param text 需要规范化的宿主文本
 * @returns 可读文本与按出现顺序排列的结构化引用
 */
export function parseSessionReferenceText(text: string): ParsedSessionReferenceText {
  const references: SessionReferenceInput[] = []
  // 一个正则两个分支：@[label](uri) 与裸 dsh-session:xxxx 都匹配
  const pattern = /@\[((?:\\.|[^\\\]])*)\]\((dsh-session:[^\s)]*)\)|(dsh-session:[A-Za-z0-9_-]+)/gu
  const rendered = text.replace(pattern, (
    _match,
    rawLabel: string | undefined,
    markdownUri: string | undefined,
    bareUri: string | undefined,
  ) => {
    const uri = markdownUri ?? bareUri
    /* v8 ignore next -- the two-alternative regex always captures exactly one URI group. */
    if (uri === undefined) throw new SessionReferenceError('session reference URI is missing', 'SESSION_REFERENCE_INVALID_REFERENCE')
    const sessionId = decodeSessionReferenceUri(uri)
    // 裸 URI 没有 label，直接用会话 id 当展示名
    const label = rawLabel === undefined ? sessionId : unescapeLabel(rawLabel)
    references.push({ sessionId, label })
    return `@${label}`
  })
  return { text: rendered, references }
}

/** 转义 label 中的反斜杠与右方括号（Markdown 链接文本语法要求）。 */
function escapeLabel(label: string): string {
  return label.replace(/[\\\]]/gu, match => `\\${match}`)
}

/** 撤销 escapeLabel 的转义，还原原始 label 文本。 */
function unescapeLabel(label: string): string {
  return label.replace(/\\(.)/gu, '$1')
}

/** 构造统一的"无效 URI"错误，可附带原始原因。 */
function invalidUri(uri: string, cause?: unknown): SessionReferenceError {
  return new SessionReferenceError(
    `invalid session reference URI ${JSON.stringify(uri)}`,
    'SESSION_REFERENCE_INVALID_REFERENCE',
    cause === undefined ? undefined : { cause },
  )
}
