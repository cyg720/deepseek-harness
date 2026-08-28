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
import { packChunkRuns, type SessionEvent } from '@deepseek-ai/dsh-session'
import { parseSessionLog } from '@deepseek-ai/dsh-llm-replay'

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
    return path.endsWith('/session.jsonl')
  }
  return path.startsWith(PYTHON_RUNTIME_PHYSICAL_SESSION_FIXTURE_ROOT)
    && /\/session(?:\.\d+)?\.jsonl$/.test(path)
}

function isSessionHeader(value: unknown): boolean {
  return value !== null && typeof value === 'object' && (value as { type?: unknown }).type === 'session'
}

/** 中文说明：函数 renderFixture 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function renderFixture(headerLine: string, events: readonly SessionEvent[]): string {
  return [
    headerLine,
    ...packChunkRuns(events).map((stored) => {
      /** 中文说明：变量 record 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const record = stored as unknown as Record<string, unknown>
      delete record.seq
      delete record.time
      delete record.seq0
      delete record.time0
      return JSON.stringify(record)
    }),
    '',
  ].join('\n')
}

/** 中文说明：函数 withoutEnvelope 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function withoutEnvelope(events: readonly SessionEvent[]): Array<Omit<SessionEvent, 'seq' | 'time'>> {
  return events.map((event) => {
    const { seq: _seq, time: _time, ...projected } = event
    return projected
  })
}

/**
 * Canonicalize one JSONL document when its first record is a session header.
 * The header line remains byte-identical; body records decode to logical events,
 * re-encode with {@link packChunkRuns}, and omit storage sequence/time envelopes.
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
    events = parseSessionLog(content)
  } catch (error) {
    /** 中文说明：变量 detail 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`${label}: ${detail}`, { cause: error })
  }
  /** 中文说明：变量 canonical 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const canonical = renderFixture(headerLine, events)
  /** 中文说明：变量 decoded 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const decoded = parseSessionLog(canonical)
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
