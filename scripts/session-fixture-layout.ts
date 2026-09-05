/** Canonical packed-row and envelope projection helpers for repository session fixtures. */
/*
 * 文件职责：实现 session-fixture-layout.ts 覆盖的发布、门禁、翻译配对或仓库维护职责。
 * 技术维度：使用 TypeScript、Vitest、Node.js 文件系统、Git、包管理器或构建产物校验。
 * 产品维度：保障项目发布物、文档配对和 CI 门禁保持一致且可追踪。
 * 逻辑维度：解析参数与仓库状态，执行检查或发布步骤，再输出诊断和退出状态。
 * 关键边界：发布与 Git 操作会改变外部状态；失败必须显式停止；路径和命令输出不可信。
 * 新手阅读建议：先看入口参数和只读检查，再读状态变更步骤，最后关注回滚、错误码和平台差异。
 */

import { deepStrictEqual } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  decodeSeqRanges,
  SessionLogOffset,
  type SessionEvent,
} from '@deepseek-ai/dsh-session'
import type { SessionLogOffset as SessionLogOffsetType } from '@deepseek-ai/dsh-session'
import { sessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog'

/** Physical persistence artifacts validated by the WebWorker runtime fixture spec. */
const WEBWORKER_PHYSICAL_SESSION_FIXTURE_ROOT =
  'packages/experimental/webworker-runtime/tests/fixtures/vfs-example/home/sessions/'

/** Installed-runtime snapshots that preserve the JSONL writer's physical encoding. */
const PYTHON_RUNTIME_PHYSICAL_SESSION_FIXTURE_ROOT =
  'scripts/snapshots/python-sdk-single-exe/'

/** One repository session fixture and its canonical projected representation. */
/* 中文说明：interface SessionFixtureLayout 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
export interface SessionFixtureLayout {
  /** Repository-relative path with `/` separators. */
  path: string
  /** Current fixture bytes decoded as UTF-8. */
  source: string
  /** Canonical projected fixture bytes. */
  canonical: string
}

/**
 * Whether a repository JSONL preserves physical persistence encoding rather
 * than the logical event projection owned by this script.
 * @param path - Repository-relative path with `/` separators.
 * @returns True for physical WebWorker and installed-runtime session logs.
 */
export function isPhysicalSessionFixture(path: string): boolean {
  if (path.startsWith(WEBWORKER_PHYSICAL_SESSION_FIXTURE_ROOT)) {
    return /\/session(?:\.v[1-9]\d*)?\.jsonl$/.test(path)
  }
  return path.startsWith(PYTHON_RUNTIME_PHYSICAL_SESSION_FIXTURE_ROOT)
    && /\/session(?:\.[1-9]\d*)?(?:\.v[1-9]\d*)?\.jsonl$/.test(path)
}

function isSessionHeader(value: unknown): boolean {
  return value !== null && typeof value === 'object' && (value as { type?: unknown }).type === 'session'
}

function validationHeader(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value
  const header = { ...value as Record<string, unknown> }
  if (header.version === 0 && !Object.hasOwn(header, 'delegationDepth')) header.delegationDepth = 0
  if (typeof header.cwd === 'string' && /^\{\{cwd\}\}(?:\/|$)/.test(header.cwd)) {
    header.cwd = header.cwd.replace('{{cwd}}', '/dsh-snapshot-cwd')
  }
  return header
}

function renderFixture(headerLine: string, events: readonly SessionEvent[]): string {
  return [
    headerLine,
    ...events.map((event) => {
      const record = { ...event } as unknown as Record<string, unknown>
      delete record.seq
      delete record.time
      return JSON.stringify(record)
    }),
    '',
  ].join('\n')
}

function projectedRowCardinality(record: Readonly<Record<string, unknown>>): number {
  const data = record.data
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return 1
  const key = record.type === 'tool-call-chunks' ? 'args' : 'texts'
  const values = (data as Record<string, unknown>)[key]
  return Array.isArray(values) && values.length > 0 ? values.length : 1
}

function parseFixtureObjectLine(line: string, lineNumber: number): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(line) as unknown
  } catch (error) {
    throw new Error(`session snapshot line ${lineNumber} contains invalid JSON`, { cause: error })
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`session snapshot line ${lineNumber} must be a JSON object`)
  }
  return value as Record<string, unknown>
}

function parseFixtureRows(content: string, headerValue: unknown): SessionEvent[] {
  const rows: Record<string, unknown>[] = []
  const rowLines: number[] = []
  let nextSeq: SessionLogOffsetType = SessionLogOffset(0)
  let headerSkipped = false
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if (line.trim().length === 0) continue
    if (!headerSkipped) {
      headerSkipped = true
      continue
    }
    const record = parseFixtureObjectLine(line, index + 1)
    const packed = record.type === 'text-chunks'
      || record.type === 'reasoning-chunks'
      || record.type === 'tool-call-chunks'
    const seqKey = packed ? 'seq0' : 'seq'
    const timeKey = packed ? 'time0' : 'time'
    if (!Object.hasOwn(record, seqKey)) record[seqKey] = nextSeq
    if (!Object.hasOwn(record, timeKey)) record[timeKey] = 0
    rows.push(record)
    rowLines.push(index + 1)
    nextSeq = SessionLogOffset(nextSeq + projectedRowCardinality(record))
  }
  // Versionless protocol fixtures and current projected snapshots use scalar
  // event rows. Current snapshots may contain owner-restored scrub tokens such
  // as `{{tools}}`; semantic replay restores those sidecars, while this layout
  // gate owns only envelopes, provenance ranges, and one-event-per-row form.
  const projectedCurrent = headerValue !== null
    && typeof headerValue === 'object'
    && !Array.isArray(headerValue)
    && (headerValue as Record<string, unknown>).version === sessionFormatCatalog.currentVersion
  if (headerValue === null || typeof headerValue !== 'object' || Array.isArray(headerValue)
    || !Object.hasOwn(headerValue, 'version') || projectedCurrent) {
    return rows.map((source, index) => {
      const record = { ...source }
      try {
        if (record.type === 'text-chunks'
          || record.type === 'reasoning-chunks'
          || record.type === 'tool-call-chunks') {
          throw new Error('current projected fixtures cannot contain legacy packed rows')
        }
        if (Object.hasOwn(record, 'sourceEventSeqs')) {
          record.sourceEventSeqs = decodeSeqRanges(record.sourceEventSeqs)
        }
        return record as unknown as SessionEvent
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        throw new Error(`session snapshot line ${rowLines[index] ?? 1}: ${detail}`, { cause: error })
      }
    })
  }
  try {
    return [
      ...sessionFormatCatalog.decodeArtifact(validationHeader(headerValue), rows).events,
    ] as unknown as SessionEvent[]
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    const storedRow = /\brow (\d+)\b/.exec(detail)
    const line = storedRow === null ? 1 : rowLines[Number(storedRow[1])] ?? 1
    throw new Error(`session snapshot line ${line}: ${detail}`, { cause: error })
  }
}

function withoutEnvelope(events: readonly SessionEvent[]): Array<Omit<SessionEvent, 'seq' | 'time'>> {
  return events.map((event) => {
    const { seq: _seq, time: _time, ...projected } = event
    return projected
  })
}

/**
 * Canonicalize one JSONL document when its first record is a session header.
 * The header line remains byte-identical; body records decode to logical events,
 * re-encode one event per row, and omit storage sequence/time envelopes.
 * Non-session JSONL returns undefined.
 *
 * @param content - JSONL source text.
 * @param label - path-like diagnostic label.
 * @returns Canonical text for a session fixture, otherwise undefined.
 */
/* 中文说明：函数 canonicalSessionFixture 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function canonicalSessionFixture(content: string, label = '<session-fixture>'): string | undefined {
  /** 中文说明：函数值 headerLine 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const headerLine = content.split(/\r?\n/).find(line => line.trim().length > 0)
  if (headerLine === undefined) return undefined

  /** 中文说明：变量 headerValue 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let headerValue: unknown
  try {
    headerValue = JSON.parse(headerLine) as unknown
  } catch {
    return undefined
  }
  if (!isSessionHeader(headerValue)) return undefined

  /** 中文说明：变量 events 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let events
  try {
    events = parseFixtureRows(content, headerValue)
  } catch (error) {
    /** 中文说明：变量 detail 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`${label}: ${detail}`, { cause: error })
  }
  const storedVersion = headerValue !== null
    && typeof headerValue === 'object'
    && !Array.isArray(headerValue)
    && typeof (headerValue as Record<string, unknown>).version === 'number'
    ? (headerValue as Record<string, number>).version
    : undefined
  // Released predecessor generations are immutable compatibility fixtures.
  // Parsing above still validates their physical rows, but canonicalization
  // never rewrites their committed bytes into the current scalar layout.
  if (storedVersion !== undefined && storedVersion < sessionFormatCatalog.currentVersion) {
    return content
  }
  const canonical = renderFixture(headerLine, events)
  const decoded = parseFixtureRows(canonical, headerValue)
  try {
    deepStrictEqual(withoutEnvelope(decoded), withoutEnvelope(events))
  } catch (error) {
    throw new Error(`${label}: packed snapshot rewrite changed the event payload stream`, { cause: error })
  }
  if (renderFixture(headerLine, decoded) !== canonical) {
    throw new Error(`${label}: packed rewrite is not idempotent`)
  }
  return canonical
}

/**
 * Discover tracked and unignored untracked JSONL files through Git.
 *
 * @param root - repository root.
 * @returns Stable repository-relative paths.
 */
/* 中文说明：函数 discoverJsonlFiles 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function discoverJsonlFiles(root: string): string[] {
  return execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '*.jsonl'],
    { cwd: root, encoding: 'utf8' },
  ).split('\0')
    .filter(path => path.length > 0 && existsSync(resolve(root, path)))
    .sort()
}

/**
 * Inspect every repository JSONL whose first record is a session header.
 *
 * @param root - repository root.
 * @returns Session fixtures with current and canonical text.
 */
/* 中文说明：函数 inspectSessionFixtureLayouts 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function inspectSessionFixtureLayouts(root: string): SessionFixtureLayout[] {
  return discoverJsonlFiles(root).flatMap((path) => {
    if (isPhysicalSessionFixture(path)) return []
    const source = readFileSync(resolve(root, path), 'utf8')
    /** 中文说明：变量 canonical 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const canonical = canonicalSessionFixture(source, path)
    return canonical === undefined ? [] : [{ path, source, canonical }]
  })
}
