/** Model and UI rendering for persistent terminal tool results. */
/*
 * ================================ 文件注释 ================================
 * 【文件职责】持久化终端工具结果的模型与 UI 渲染：把会话/发送/读取/列表等结构化结果
 * 渲染为模型可见文本，并对完整结果做 UTF-8 安全的字节预算截断。
 * 【技术维度】TextRetainer（dsh-output-retention）按 head/tail 保留；辅助函数
 * fitWithSuffix/fitWithPrefix/boundBodyWithSuffix 组合"内容 + 元数据 + 截断标记"
 * 并保持 UTF-8 边界；结果内联类型与 dsh-terminal 的线上形状对应（无依赖契约）。
 * 【产品维度】模型看到可读的终端输出：等待原因与会话状态以 [wait: ...]/[session: ...]
 * 标记呈现，超限结果附 [output truncated] 提示而不撑爆上下文。
 * 【逻辑维度】字节预算工具（byteLength/retain/fitWith*）→ 各渲染函数
 * （boundTerminalText / renderSpawn / renderSend / renderSendRead / renderRead / renderList）。
 * 【关键边界】截断必须保持 UTF-8 完整（不许切半字符）；固定元数据不得被内容挤出；
 * 空输出渲染为占位文本（如 `(no new output)`）。
 * 【新手阅读建议】先看 fitWithSuffix/fitWithPrefix 的预算分配，再看 renderSend 的
 * 标记组合与 renderList 的逐行格式。
 * ==========================================================================
 */

import { TextRetainer } from '@deepseek-ai/dsh-output-retention'

interface RenderedSessionStatusRunning {
  kind: 'running'
}

interface RenderedSessionStatusExited {
  kind: 'exited'
  exitCode: number | null
  signal: string | null
}

type RenderedSessionStatus = RenderedSessionStatusRunning | RenderedSessionStatusExited

interface RenderedSessionSnapshot {
  sessionId: string
  name?: string
  type: string
  pid?: number
  status: RenderedSessionStatus
}

interface RenderedSpawnResult extends RenderedSessionSnapshot {
  motd: string
}

interface RenderedSendResult {
  viewport: string
  waitReason: 'stdin_read' | 'inferred_idle' | 'timeout' | 'session_exit'
  sessionStatus: RenderedSessionStatus
  truncated: boolean
}

interface RenderedSendRead {
  delta: string
  truncated: boolean
}

interface RenderedReadResult {
  text: string
  totalLines: number
  lineBegin: number
  lineEnd: number
  truncated: boolean
}

const encoder = new TextEncoder()
const TRUNCATED = '\n[output truncated]'

/** 按 UTF-8 字节数计算文本长度（截断预算按字节而非字符）。 */
function byteLength(text: string): number {
  return encoder.encode(text).byteLength
}

/** 用 TextRetainer 按 head/tail 保留指定字节数。 */
function retain(text: string, maxBytes: number, kind: 'head' | 'tail'): string {
  const retainer = new TextRetainer({ kind, maxBytes })
  retainer.push(text)
  return retainer.finish().text
}

/** 内容尾部截断 + 固定后缀（元数据优先保留，内容让出空间）。 */
function fitWithSuffix(content: string, suffix: string, maxBytes: number): string {
  const fixedBytes = byteLength(suffix)
  if (fixedBytes >= maxBytes) return retain(suffix, maxBytes, 'tail')
  return `${retain(content, maxBytes - fixedBytes, 'tail')}${suffix}`
}

/** 前缀保留 + 内容尾部截断 + 截断标记（前缀如"started terminal session ..."必须可见）。 */
function fitWithPrefix(prefix: string, content: string, maxBytes: number): string {
  const fixed = `${prefix}${TRUNCATED}`
  const fixedBytes = byteLength(fixed)
  if (fixedBytes >= maxBytes) return retain(fixed, maxBytes, 'head')
  return `${prefix}${retain(content, maxBytes - fixedBytes, 'tail')}${TRUNCATED}`
}

/** 通用"正文 + 元数据后缀"的预算边界：放得下则原样，放不下则截正文并附加截断标记。 */
function boundBodyWithSuffix(
  content: string,
  metadata: string,
  upstreamTruncated: boolean,
  maxBytes: number,
): string {
  const suffix = `${metadata}${upstreamTruncated ? TRUNCATED : ''}`
  const complete = `${content}${suffix}`
  if (byteLength(complete) <= maxBytes) return complete
  return fitWithSuffix(content, `${metadata}${TRUNCATED}`, maxBytes)
}

/**
 * Bound one complete terminal acknowledgement while preserving UTF-8 cuts.
 * @param text - complete acknowledgement text.
 * @param maxBytes - positive final result cap.
 * @returns bounded text with a truncation marker when it fits.
 */
/*
 * 给一条完整终端确认文本设字节上限，并保持 UTF-8 切分完整。
 * @param text 完整确认文本
 * @param maxBytes 正的结果上限
 * @returns 有界文本；超限时附加截断标记
 */
export function boundTerminalText(text: string, maxBytes: number): string {
  if (byteLength(text) <= maxBytes) return text
  const markerBytes = byteLength(TRUNCATED)
  if (markerBytes >= maxBytes) return retain(TRUNCATED, maxBytes, 'tail')
  return `${retain(text, maxBytes - markerBytes, 'head')}${TRUNCATED}`
}

/**
 * Render one created session and its bounded MOTD.
 * @param result - published spawn result.
 * @param maxBytes - complete UTF-8 result cap.
 * @returns Model-facing session acknowledgement.
 */
/*
 * 渲染一个已创建会话及其有界 MOTD。
 * @param result 已发布的 spawn 结果
 * @param maxBytes 完整 UTF-8 结果上限
 * @returns 模型可见的会话确认
 */
export function renderSpawn(result: RenderedSpawnResult, maxBytes: number): string {
  const label = result.name === undefined ? result.sessionId : `${result.sessionId} (${result.name})`
  const prefix = `started terminal session ${label} [type: ${result.type}]\n`
  const motd = result.motd || '(no startup output)'
  const complete = `${prefix}${motd}`
  return byteLength(complete) <= maxBytes ? complete : fitWithPrefix(prefix, motd, maxBytes)
}

/**
 * Render one settled interactive send.
 * @param result - settled send outcome.
 * @param maxBytes - complete UTF-8 result cap.
 * @returns Terminal output plus wait/session markers.
 */
/*
 * 渲染一次已落定的交互式发送。
 * @param result 已落定的发送结果
 * @param maxBytes 完整 UTF-8 结果上限
 * @returns 终端输出加等待/会话标记
 */
export function renderSend(result: RenderedSendResult, maxBytes: number): string {
  const output = result.viewport || '(no new output)'
  const status = result.sessionStatus.kind === 'running'
    ? 'running'
    : `exited code=${result.sessionStatus.exitCode ?? 'null'} signal=${result.sessionStatus.signal ?? 'null'}`
  return boundBodyWithSuffix(
    output,
    `\n[wait: ${result.waitReason}]\n[session: ${status}]`,
    result.truncated,
    maxBytes,
  )
}

/**
 * Render one incremental background operation read.
 * @param read - consuming operation delta.
 * @returns Delta plus its upstream truncation marker. The generic task control
 *   applies the producer's complete-result cap after adding job status.
 */
/*
 * 渲染一次增量式的后台操作读取。
 * @param read 消耗式的操作增量
 * @returns 增量加其上游截断标记；通用任务控制会在附加 job 状态后应用生产者的
 *   完整结果上限
 */
export function renderSendRead(read: RenderedSendRead): string {
  const separator = read.delta.endsWith('\n') || read.delta.length === 0 ? '' : '\n'
  return `${read.delta}${read.truncated ? `${separator}[output truncated]` : ''}`
}

/**
 * Render one bounded historical page.
 * @param result - retained scrollback page.
 * @param maxBytes - complete UTF-8 result cap.
 * @returns Page text plus pagination and truncation markers.
 */
/*
 * 渲染一页有界的历史滚动区。
 * @param result 保留的滚动区页
 * @param maxBytes 完整 UTF-8 结果上限
 * @returns 页文本加分页与截断标记
 */
export function renderRead(result: RenderedReadResult, maxBytes: number): string {
  const output = result.text || '(no retained output)'
  return boundBodyWithSuffix(
    output,
    `\n[lines: ${result.lineBegin}-${result.lineEnd} of ${result.totalLines}]`,
    result.truncated,
    maxBytes,
  )
}

/**
 * Render owner-visible live sessions.
 * @param sessions - fresh owner-scoped snapshots.
 * @param maxBytes - complete UTF-8 result cap.
 * @returns One line per session or the empty marker.
 */
/*
 * 渲染 owner 可见的存活会话列表。
 * @param sessions 新鲜的 owner 级快照
 * @param maxBytes 完整 UTF-8 结果上限
 * @returns 每会话一行；无会话时返回空标记
 */
export function renderList(sessions: readonly RenderedSessionSnapshot[], maxBytes: number): string {
  if (sessions.length === 0) return '(no terminal sessions)'
  const text = sessions.map((session) => {
    const name = session.name === undefined ? '' : ` (${session.name})`
    const pid = session.pid === undefined ? '' : ` pid=${session.pid}`
    const status = session.status.kind === 'running'
      ? 'running'
      : `exited code=${session.status.exitCode ?? 'null'} signal=${session.status.signal ?? 'null'}`
    return `${session.sessionId}${name} [${session.type}] ${status}${pid}`
  }).join('\n')
  return boundBodyWithSuffix(text, '', false, maxBytes)
}
