/** Canonical session URI and inline mention encoding. */

/*
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

import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId as SessionIdType } from '@deepseek-ai/dsh-session'
import { SessionReferenceError } from './config.ts'
import type { SessionReferenceInput } from './types.ts'

/** URI scheme reserved for DeepSeek Harness session snapshots. */
export const SESSION_REFERENCE_SCHEME = 'dsh-session:'

/**
 * Encode any JavaScript session-id string as a canonical lossless URI.
 * @param sessionId - opaque session id to serialize.
 * @returns canonical `dsh-session:` URI.
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
export function decodeSessionReferenceUri(uri: string): SessionIdType {
  if (!uri.startsWith(SESSION_REFERENCE_SCHEME)) {
    throw invalidUri(uri)
  }
  const payload = uri.slice(SESSION_REFERENCE_SCHEME.length)
  if (!/^[A-Za-z0-9_-]+$/.test(payload)) throw invalidUri(uri)
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (typeof parsed !== 'string') throw new TypeError('decoded session id is not a string')
    const sessionId = brandString<SessionIdType>(parsed)
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
export function formatSessionReferenceMention(reference: SessionReferenceInput): string {
  const label = escapeLabel(reference.label ?? reference.sessionId)
  return `@[${label}](${encodeSessionReferenceUri(reference.sessionId)})`
}

/** Result of extracting canonical mentions from plain text. */
export interface ParsedSessionReferenceText {
  /** Text with opaque tokens replaced by readable `@label` spans. */
  text: string
  /** Structured references in first-appearance order, before service deduplication. */
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
export function parseSessionReferenceText(text: string): ParsedSessionReferenceText {
  const references: SessionReferenceInput[] = []
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
    const label = rawLabel === undefined ? sessionId : unescapeLabel(rawLabel)
    references.push({ sessionId, label })
    return `@${label}`
  })
  return { text: rendered, references }
}

function escapeLabel(label: string): string {
  return label.replace(/[\\\]]/gu, match => `\\${match}`)
}

function unescapeLabel(label: string): string {
  return label.replace(/\\(.)/gu, '$1')
}

function invalidUri(uri: string, cause?: unknown): SessionReferenceError {
  return new SessionReferenceError(
    `invalid session reference URI ${JSON.stringify(uri)}`,
    'SESSION_REFERENCE_INVALID_REFERENCE',
    cause === undefined ? undefined : { cause },
  )
}
