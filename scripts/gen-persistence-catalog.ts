/**
 * Generate `docs/persistence-catalog.md` from every `SessionEventMap` merge and
 * the owning event-envelope types. This is the durable-record vocabulary, not
 * the live Cordis bus. Event declarations must be unique, explicitly typed,
 * documented, inheritance-free, and free of Cordis-only `@mode` tags; every
 * surface-union member must resolve to one. `--check` verifies the artifact.
 */
/*
 * 文件职责：实现 gen-persistence-catalog.ts 覆盖的仓库生成、校验或维护职责。
 * 技术维度：使用 TypeScript、JavaScript、Vitest、Node.js 文件系统、AST 或项目图分析。
 * 产品维度：保障源码、生成目录、文档和发布元数据在开发与 CI 中保持一致。
 * 逻辑维度：读取仓库输入，构建中间模型，执行生成或校验，再报告差异和失败。
 * 关键边界：生成结果必须确定；路径与源码文本不可信；校验失败必须以非零状态显式报告。
 * 新手阅读建议：先看命令入口和输入目录，再读模型转换，最后关注输出文件与失败条件。
 */

import { globSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import ts from 'typescript'
import { parseJsDoc, pointer, rawJsDoc, reportViolations } from './jsdoc.ts'
import { githubSlug } from './verify-md-links.ts'

/** 中文说明：变量 root 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const root = resolve(import.meta.dirname, '..')
/** 中文说明：常量 OUT 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const OUT = 'docs/persistence-catalog.md'
/** 中文说明：常量 OUT_RUNTIME_TYPES 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const OUT_RUNTIME_TYPES = 'packages/core/session/src/known-event-types.ts'

/** The fenced-block info string for generated declaration blocks (skipped by
 * doc-typecheck, since their imported types are not standalone-compilable). */
/* 中文说明：常量 FENCE 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const FENCE = 'ts persistence-catalog'

/** The package that owns the durable event vocabulary. */
/* 中文说明：常量 SESSION_PACKAGE 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const SESSION_PACKAGE = '@deepseek-ai/dsh-session'

/** The type-only module that plugin declaration merges augment. */
/* 中文说明：常量 SESSION_TYPES_MODULE 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const SESSION_TYPES_MODULE = '@deepseek-ai/dsh-session/types'

/** Event-envelope declarations rendered before the per-event vocabulary. */
/* 中文说明：常量 EVENT_ENVELOPE_TYPE_NAMES 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const EVENT_ENVELOPE_TYPE_NAMES = [
  'SessionEventType',
  'SurfaceEventType',
  'SurfaceOp',
  'SessionEvent',
] as const

/** 中文说明：type EventEnvelopeTypeName 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
type EventEnvelopeTypeName = typeof EVENT_ENVELOPE_TYPE_NAMES[number]

/** Documentation target, relative to `docs/`, for linked payload types. */
const LINK_MAP: Record<string, string> = {
  ToolCallId: 'subsystems/core.md',
  ContentBlock: 'subsystems/core.md',
  MessageSource: 'subsystems/core.md',
  ScheduleChange: 'subsystems/schedule.md',
  StreamChunk: 'subsystems/llm-streaming.md',
  TokenUsage: 'subsystems/llm-streaming.md',
  TodoItem: 'subsystems/todo.md',
  TurnTrigger: 'subsystems/session.md',
  TurnEndReason: 'subsystems/session.md',
  SessionTitleEventData: 'subsystems/session-title.md',
  SessionTitleLlmRequestEventData: 'subsystems/session-title.md',
  SessionTitleModelProvenance: 'subsystems/session-title.md',
  SessionTitleProviderId: 'subsystems/session-title.md',
  SessionTitleSource: 'subsystems/session-title.md',
  TeamId: 'subsystems/agent-team.md',
  TeamMemberSnapshot: 'subsystems/agent-team.md',
  TeamMessageId: 'subsystems/agent-team.md',
  TeamMessageSnapshot: 'subsystems/agent-team.md',
  TeamTaskSnapshot: 'subsystems/agent-team.md',
}

/** One log event, extracted from a `SessionEventMap` declaration. */
/* 中文说明：interface LogEventEntry 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
export interface LogEventEntry {
  /** Scoped name, e.g. `turn/start`. */
  name: string
  /** The scope prefix, e.g. `turn` (everything before the first `/`). */
  scope: string
  /** Payload type text (the member's type annotation, whitespace-collapsed). */
  payload: string
  /** Source member declaration and complete JSDoc, dedented from its container. */
  declaration: string
  /** Description prose (the member's JSDoc), one line per paragraph. */
  doc: string
  /** Source pointer `packages/…/file.ts:line` of the declaration. */
  source: string
}

/** A {@link LogEventEntry} plus its surface-eligibility badge. */
/* 中文说明：interface AnnotatedLogEventEntry 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
export interface AnnotatedLogEventEntry extends LogEventEntry {
  /** Whether the type is a `SurfaceEventType` member (may carry `surfaceOp`). */
  surface: boolean
}

/** One owning event-envelope declaration pasted into the generated catalog. */
/* 中文说明：interface EventEnvelopeTypeEntry 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
export interface EventEnvelopeTypeEntry {
  /** Exported declaration name. */
  name: EventEnvelopeTypeName
  /** Verbatim type declaration, including its complete leading JSDoc. */
  declaration: string
  /** Source pointer `packages/…/file.ts:line` of the declaration. */
  source: string
}

/** 中文说明：变量 printer 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const printer = ts.createPrinter({ removeComments: true })

/**
 * Render a member type on one line through the TypeScript printer, which adds
 * semicolon separators. Drop its trailing semicolon before `}` to match the
 * repository's inline-literal style.
 */
/* 中文说明：函数 payloadText 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function payloadText(type: ts.TypeNode, sf: ts.SourceFile): string {
  return printer.printNode(ts.EmitHint.Unspecified, type, sf)
    .replace(/\s+/g, ' ')
    .replace(/;\s*\}/g, ' }')
    .trim()
}

/**
 * Copy a declaration from its leading JSDoc through its closing token while
 * removing only the indentation imposed by its containing interface/module.
 */
/* 中文说明：函数 declarationText 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function declarationText(text: string, sf: ts.SourceFile, node: ts.Node): string {
  /** 中文说明：变量 raw 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const raw = rawJsDoc(text, node)
  /** 中文说明：变量 nodeStart 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const nodeStart = node.getStart(sf)
  /** 中文说明：变量 start 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const start = raw ? text.lastIndexOf(raw, nodeStart) : nodeStart
  const { line } = sf.getLineAndCharacterOfPosition(start)
  /** 中文说明：变量 lineStart 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const lineStart = sf.getPositionOfLineAndCharacter(line, 0)
  /** 中文说明：变量 indent 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const indent = text.slice(lineStart, start)
  return text.slice(lineStart, node.end)
    .split('\n')
    .map(lineText => lineText.startsWith(indent) ? lineText.slice(indent.length) : lineText)
    .join('\n')
    .trimEnd()
}

/**
 * Every `interface SessionEventMap` declaration in a source file: the owning
 * top-level declaration (in `@deepseek-ai/dsh-session`) and any declaration
 * merge inside a `declare module '@deepseek-ai/dsh-session/types'` block. Both forms
 * declare members of the SAME merged interface, so both are catalogued
 * uniformly. `topLevel` distinguishes the owning form so the caller can verify
 * it actually lives in the owning package — an unrelated local interface that
 * happens to share the name must not be catalogued as the on-disk vocabulary.
 */
/* 中文说明：函数 sessionEventMapDecls 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function sessionEventMapDecls(sf: ts.SourceFile): { decl: ts.InterfaceDeclaration; topLevel: boolean }[] {
  /** 中文说明：变量 decls 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const decls: { decl: ts.InterfaceDeclaration; topLevel: boolean }[] = []
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const stmt of sf.statements) {
    if (ts.isInterfaceDeclaration(stmt) && stmt.name.text === 'SessionEventMap') decls.push({ decl: stmt, topLevel: true })
    if (ts.isModuleDeclaration(stmt) && ts.isStringLiteral(stmt.name) && stmt.name.text === SESSION_TYPES_MODULE
      && stmt.body && ts.isModuleBlock(stmt.body)) {
      /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
      for (const inner of stmt.body.statements) {
        if (ts.isInterfaceDeclaration(inner) && inner.name.text === 'SessionEventMap') decls.push({ decl: inner, topLevel: false })
      }
    }
  }
  return decls
}

/**
 * The npm package name owning a `packages/<group>/<pkg>/…` source file, read
 * from that package's manifest — or null when the manifest is missing or
 * unparseable (the caller treats null as "ownership unverifiable").
 */
/* 中文说明：函数 packageNameFor 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function packageNameFor(rel: string, scanRoot: string): string | null {
  /** 中文说明：变量 dir 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const dir = rel.split('/').slice(0, 3).join('/')
  try {
    /** 中文说明：变量 manifest 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const manifest = JSON.parse(readFileSync(resolve(scanRoot, dir, 'package.json'), 'utf8')) as { name?: string }
    return typeof manifest.name === 'string' ? manifest.name : null
  } catch {
    // Missing or malformed package.json — every real workspace package has one,
    // so this only arises in stripped-down fixture trees; either way ownership
    // cannot be verified and the caller reports the declaration.
    return null
  }
}

/**
 * Collect every `SessionEventMap` merge, rejecting inherited, non-literal,
 * untyped, undocumented, duplicate, or incorrectly owned members in one report.
 */
/* 中文说明：函数 collectLogEvents 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function collectLogEvents(scanRoot: string = root): LogEventEntry[] {
  /** 中文说明：变量 entries 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const entries: LogEventEntry[] = []
  /** 中文说明：变量 violations 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const violations: string[] = []
  /** 中文说明：变量 seen 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const seen = new Map<string, string>()
  /** 中文说明：变量 owningDecl 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let owningDecl: string | null = null
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const rel of globSync('packages/*/*/src/**/*.ts', { cwd: scanRoot }).map(s => s.split(sep).join('/')).sort()) {
    /** 中文说明：变量 abs 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const abs = resolve(scanRoot, rel)
    /** 中文说明：变量 text 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const text = readFileSync(abs, 'utf8')
    if (!text.includes('SessionEventMap')) continue
    /** 中文说明：变量 sf 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sf = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true)
    /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
    for (const { decl, topLevel } of sessionEventMapDecls(sf)) {
      /** 中文说明：变量 declSrc 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const declSrc = pointer(rel, sf, decl)
      if (topLevel) {
        // The top-level form has one home: the single exported declaration in
        // the owning package. Same-named interfaces elsewhere are different
        // types and must not enter the on-disk catalog.
        /** 中文说明：变量 pkg 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const pkg = packageNameFor(rel, scanRoot)
        if (pkg !== SESSION_PACKAGE) {
          violations.push(`top-level interface SessionEventMap (${declSrc}) is outside ${SESSION_PACKAGE} (package ${pkg ?? 'unknown'}). Rename the interface, or contribute events via declare module '${SESSION_TYPES_MODULE}'.`)
          continue
        }
        /** 中文说明：函数值 exported 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
        const exported = decl.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) ?? false
        if (!exported) {
          violations.push(`top-level interface SessionEventMap (${declSrc}) is not exported; the owning vocabulary is the single exported declaration — rename a local helper interface.`)
          continue
        }
        if (owningDecl) {
          violations.push(`top-level interface SessionEventMap (${declSrc}) is already declared at ${owningDecl}; the owning vocabulary has exactly one home.`)
          continue
        }
        owningDecl = declSrc
      }
      if (decl.heritageClauses?.length) {
        violations.push(`SessionEventMap declaration (${declSrc}) uses extends; inherited keys would join keyof SessionEventMap without a catalog row — declare event members directly.`)
      }
      /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
      for (const member of decl.members) {
        /** 中文说明：变量 src 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const src = pointer(rel, sf, member)
        if (!ts.isPropertySignature(member) || !member.type) {
          // A method-form or type-less member still joins `keyof SessionEventMap`,
          // so skipping it silently would be exactly the undocumented-event hole
          // this catalog exists to close.
          /** 中文说明：变量 label 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const label = (member as { name?: ts.Node }).name?.getText(sf) ?? member.getText(sf).replace(/\s+/g, ' ')
          violations.push(`SessionEventMap member ${label} (${src}) is not a property signature with an explicit payload type; declare every log event as 'scope/name': <payload>.`)
          continue
        }
        if (!ts.isStringLiteral(member.name)) {
          violations.push(`log event at ${src} has a non-literal name; the catalog needs string-literal event names.`)
          continue
        }
        /** 中文说明：变量 name 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const name = member.name.text
        /** 中文说明：变量 where 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const where = `log event '${name}' (${src})`
        /** 中文说明：变量 prior 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const prior = seen.get(name)
        if (prior) {
          violations.push(`${where} is already declared at ${prior}; an event type has exactly one declaration.`)
          continue
        }
        seen.set(name, src)
        /** 中文说明：变量 payload 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const payload = payloadText(member.type, sf)
        const { doc, hasMode } = parseJsDoc(rawJsDoc(text, member))
        if (hasMode) {
          violations.push(`${where} carries an @mode tag, but a log event has no dispatch mode (it is not a cordis bus event — it rides the 'session/event' emit). Remove the tag.`)
        }
        if (!doc) {
          violations.push(`${where} has no description prose. Say what the event records and what its payload means — the JSDoc becomes the catalog entry.`)
        }
        /** 中文说明：变量 declaration 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const declaration = declarationText(text, sf, member)
        entries.push({ name, scope: name.split('/')[0] ?? name, payload, declaration, doc, source: src })
      }
    }
  }
  reportViolations('gen-persistence-catalog', violations)
  return entries
}

/**
 * Collect the exported declarations that compose the persisted event envelope,
 * preserving their source JSDoc and declaration text.
 */
/* 中文说明：函数 collectEventEnvelopeTypes 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function collectEventEnvelopeTypes(scanRoot: string = root): EventEnvelopeTypeEntry[] {
  /** 中文说明：变量 found 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const found = new Map<EventEnvelopeTypeName, EventEnvelopeTypeEntry>()
  /** 中文说明：变量 violations 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const violations: string[] = []
  /** 中文说明：变量 wanted 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const wanted = new Set<string>(EVENT_ENVELOPE_TYPE_NAMES)
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const rel of globSync('packages/*/*/src/**/*.ts', { cwd: scanRoot }).map(s => s.split(sep).join('/')).sort()) {
    /** 中文说明：变量 abs 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const abs = resolve(scanRoot, rel)
    /** 中文说明：变量 text 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const text = readFileSync(abs, 'utf8')
    if (!EVENT_ENVELOPE_TYPE_NAMES.some(name => text.includes(name))) continue
    if (packageNameFor(rel, scanRoot) !== SESSION_PACKAGE) continue
    /** 中文说明：变量 sf 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sf = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true)
    /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
    for (const stmt of sf.statements) {
      if (!ts.isTypeAliasDeclaration(stmt) || !wanted.has(stmt.name.text)) continue
      /** 中文说明：变量 name 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const name = stmt.name.text as EventEnvelopeTypeName
      /** 中文说明：变量 src 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const src = pointer(rel, sf, stmt)
      /** 中文说明：变量 where 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const where = `event-envelope type '${name}' (${src})`
      /** 中文说明：变量 prior 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const prior = found.get(name)
      if (prior) {
        violations.push(`${where} is already declared at ${prior.source}; the persisted envelope type has exactly one owner.`)
        continue
      }
      if (!(stmt.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) ?? false)) {
        violations.push(`${where} is not exported.`)
      }
      const { doc, hasMode } = parseJsDoc(rawJsDoc(text, stmt))
      if (hasMode) violations.push(`${where} carries an @mode tag, but a persisted type has no dispatch mode.`)
      if (!doc) violations.push(`${where} has no description prose. The full JSDoc is part of the generated catalog.`)
      found.set(name, { name, declaration: declarationText(text, sf, stmt), source: src })
    }
  }
  /** 中文说明：函数值 missing 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const missing = EVENT_ENVELOPE_TYPE_NAMES.filter(name => !found.has(name))
  if (missing.length > 0) {
    violations.push(`missing event-envelope declaration(s): ${missing.join(', ')}.`)
  }
  reportViolations('gen-persistence-catalog', violations)
  return EVENT_ENVELOPE_TYPE_NAMES.map((name) => {
    /** 中文说明：变量 entry 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const entry = found.get(name)
    if (!entry) throw new Error(`gen-persistence-catalog: missing checked event-envelope declaration '${name}'.`)
    return entry
  })
}

/**
 * Parse the `SurfaceEventType` union — the surface-eligible subset of event
 * types — from source. Hard-errors when the alias is missing, declared more
 * than once, or contains a non-string-literal member: the badge derivation
 * relies on the union being a closed set of literal event names.
 * `scanRoot` defaults to the repo root; tests pass a fixture dir.
 */
/* 中文说明：函数 collectSurfaceEventTypes 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function collectSurfaceEventTypes(scanRoot: string = root): string[] {
  /** 中文说明：变量 found 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const found: { names: string[]; source: string }[] = []
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const rel of globSync('packages/*/*/src/**/*.ts', { cwd: scanRoot }).map(s => s.split(sep).join('/')).sort()) {
    /** 中文说明：变量 abs 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const abs = resolve(scanRoot, rel)
    /** 中文说明：变量 text 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const text = readFileSync(abs, 'utf8')
    if (!text.includes('SurfaceEventType')) continue
    /** 中文说明：变量 sf 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sf = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true)
    /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
    for (const stmt of sf.statements) {
      if (!ts.isTypeAliasDeclaration(stmt) || stmt.name.text !== 'SurfaceEventType') continue
      /** 中文说明：变量 src 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const src = pointer(rel, sf, stmt)
      /** 中文说明：变量 members 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const members = ts.isUnionTypeNode(stmt.type) ? [...stmt.type.types] : [stmt.type]
      /** 中文说明：变量 names 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const names: string[] = []
      /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
      for (const m of members) {
        if (ts.isLiteralTypeNode(m) && ts.isStringLiteral(m.literal)) names.push(m.literal.text)
        else throw new Error(`gen-persistence-catalog: SurfaceEventType (${src}) has a non-string-literal member; the badge derivation needs a closed literal union.`)
      }
      found.push({ names, source: src })
    }
  }
  /** 中文说明：变量 only 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const only = found[0]
  if (!only) throw new Error('gen-persistence-catalog: no SurfaceEventType union found under packages/*/*/src.')
  if (found.length > 1) throw new Error(`gen-persistence-catalog: SurfaceEventType is declared more than once (${found.map(f => f.source).join(', ')}); the surface subset has exactly one owner.`)
  return only.names
}

/**
 * Attach the surface/log-only badge to each event. Hard-errors when a
 * `SurfaceEventType` union member names no collected event — a stale union
 * member would otherwise silently badge nothing.
 */
/* 中文说明：函数 annotateSurface 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function annotateSurface(events: LogEventEntry[], surfaceTypes: string[]): AnnotatedLogEventEntry[] {
  /** 中文说明：函数值 names 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const names = new Set(events.map(e => e.name))
  /** 中文说明：函数值 stale 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const stale = surfaceTypes.filter(t => !names.has(t))
  if (stale.length > 0) {
    throw new Error(`gen-persistence-catalog: SurfaceEventType member(s) ${stale.map(t => `'${t}'`).join(', ')} name no declared log event (stale union member?).`)
  }
  /** 中文说明：变量 surface 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const surface = new Set(surfaceTypes)
  return events.map(e => ({ ...e, surface: surface.has(e.name) }))
}

/** Render the cross-link "Types:" line for a payload, or '' if none apply. */
/* 中文说明：函数 typeLinks 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function typeLinks(payload: string): string {
  /** 中文说明：变量 seen 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const seen = new Set<string>()
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const name of Object.keys(LINK_MAP)) {
    if (new RegExp(`\\b${name}\\b`).test(payload)) seen.add(name)
  }
  if (seen.size === 0) return ''
  const links = [...seen].sort().map(n => `[${n}](${LINK_MAP[n]})`)
  return `Types: ${links.join(' · ')}`
}

/** Render one log event entry. */
/* 中文说明：函数 renderEvent 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function renderEvent(e: AnnotatedLogEventEntry): string[] {
  /** 中文说明：变量 heading 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const heading = `${e.name} — ${e.surface ? 'surface' : 'log-only'}`
  /** 中文说明：变量 out 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const out = [`<a id="${githubSlug(heading)}"></a>`, '', `#### \`${e.name}\` — ${e.surface ? 'surface' : 'log-only'}`, '']
  out.push('```' + FENCE, e.declaration, '```', '')
  /** 中文说明：变量 links 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const links = typeLinks(e.payload)
  if (links) out.push(links, '')
  out.push(`Source: [\`${e.source}\`](../${e.source.split(':')[0]})`, '')
  return out
}

/** Render the full catalog (pure, deterministic given the collected inputs). */
/* 中文说明：函数 render 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function render(events: AnnotatedLogEventEntry[], envelopeTypes: EventEnvelopeTypeEntry[]): string {
  /** 中文说明：变量 lines 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const lines: string[] = [
    '<!-- Generated by scripts/gen-persistence-catalog.ts — do not edit by hand.',
    '     Run `pnpm run gen-persistence-catalog` to regenerate. -->',
    '',
    '# Session Persistence Event Catalog',
    '',
    'Every event type that can appear in a session\'s durable event log: the complete persisted `SessionEvent` envelope and each member of the merge-extensible `SessionEventMap` — the owning vocabulary in `@deepseek-ai/dsh-session` plus every plugin declaration merge into `@deepseek-ai/dsh-session/types` in this repo — with source JSDoc, full payload declaration, surface badge, and declaration site. It complements [session.md](subsystems/session.md) (surface ordering and the `deriveMessages()` projection), [persistence.md](subsystems/persistence.md) (how the log is made durable), and the generated region of [session.md](subsystems/session.md#cordis-surface) (the live bus wiring — a log event is NOT a cordis event; it reaches listeners via the single `session/event` emit).',
    '',
    'This file is GENERATED from source (`scripts/gen-persistence-catalog.ts`) and verified fresh by `pnpm run verify-persistence-catalog` (part of `doc-sync`) — do not edit it by hand. Declaration blocks retain the source declaration and nested property JSDoc, removing only the indentation imposed by a containing interface/module, and use a `ts persistence-catalog` fence (skipped by doc-typecheck because declarations reference types from their owning modules). Type names in a payload link to the page that documents them. See [the persistence-log-catalog Agent Note](../.agents/notes/archived/process/2026-07-04-persistence-log-catalog.md).',
    '',
    'The envelope declarations below compose each event\'s `type`, monotonic `seq`, epoch-ms `time`, `data`, and the conditional `surfaceOp`/`sourceEventSeqs` fields. **surface** marks a `SurfaceEventType` member: it produces an LLM message and declares how it joins the surface list. **log-only** marks everything else: a durable, replayable record with no derived-history contribution. Every payload is JSON-serializable (enforced at `Session.append`), and the whole format is pinned at `SESSION_FORMAT_VERSION = 0` — pre-release, no compatibility implied ([the version stance](subsystems/persistence.md)). Scope: the packages in this repo; a downstream plugin can merge further event types, which are outside this catalog by construction.',
    '',
    '## Event envelope',
    '',
    '```' + FENCE,
    envelopeTypes.map(entry => entry.declaration).join('\n\n'),
    '```',
    '',
    `Sources: ${envelopeTypes.map(entry => `[\`${entry.source}\`](../${entry.source.split(':')[0]})`).join(' · ')}`,
    '',
    '## Events',
    '',
  ]
  /** 中文说明：函数值 scopes 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const scopes = [...new Set(events.map(e => e.scope))].sort()
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const scope of scopes) {
    lines.push(`### \`${scope}/*\``, '')
    /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
    for (const e of events.filter(x => x.scope === scope).sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(...renderEvent(e))
    }
  }
  return lines.join('\n')
}

/**
 * Render the runtime known-vocabulary module: every event type the packages in
 * this repo can write, as a generated `ReadonlySet` the read path checks
 * before reconstructing a stored session.
 */
/* 中文说明：函数 renderKnownEventTypes 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function renderKnownEventTypes(events: AnnotatedLogEventEntry[]): string {
  /** 中文说明：函数值 names 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const names = [...new Set(events.map(e => e.name))].sort()
  return [
    '/**',
    ' * GENERATED by `scripts/gen-persistence-catalog.ts` — do not edit by hand; run',
    ' * `pnpm run gen-persistence-catalog` to regenerate (verified fresh by',
    ' * `pnpm run verify-persistence-catalog`, part of `doc-sync`).',
    ' * @module @deepseek-ai/dsh-session/known-event-types',
    ' */',
    '',
    '/**',
    ' * Every `SessionEventMap` member declared in this repository — the event',
    ' * vocabulary this build understands. The persistence read path refuses to',
    ' * interpret a log containing a type outside this set: such a log was likely',
    ' * written by a newer harness, and silently skipping the event could',
    ' * reconstruct a wrong session.',
    ' * Downstream (out-of-repo) plugin events are outside this list by',
    ' * construction; a registration surface for them is deferred until such a',
    ' * consumer exists.',
    ' */',
    'export const KNOWN_SESSION_EVENT_TYPES: ReadonlySet<string> = new Set([',
    ...names.map(name => `  '${name}',`),
    '])',
    '',
  ].join('\n')
}

/** One generated artifact: repo-relative target and its freshly-rendered content. */
/* 中文说明：interface GeneratedArtifact 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
interface GeneratedArtifact {
  readonly out: string
  readonly content: string
}

/** CLI entry: default writes the artifacts, `--check` fails if a committed copy
 * is stale. Guarded behind an entry-point check so importing this module for
 * tests neither regenerates the committed files nor calls process.exit. */
/* 中文说明：函数 main 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function main(): void {
  /** 中文说明：变量 events 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const events = annotateSurface(collectLogEvents(), collectSurfaceEventTypes())
  /** 中文说明：变量 artifacts 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const artifacts: GeneratedArtifact[] = [
    { out: OUT, content: render(events, collectEventEnvelopeTypes()) },
    { out: OUT_RUNTIME_TYPES, content: renderKnownEventTypes(events) },
  ]
  if (process.argv.includes('--check')) {
    /** 中文说明：函数值 stale 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
    const stale = artifacts.filter((artifact) => {
      /** 中文说明：变量 committed 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      let committed: string | null = null
      try {
        committed = readFileSync(resolve(root, artifact.out), 'utf8')
      } catch {
        // Only ENOENT (not yet generated) is expected; a present-but-unreadable
        // file is not a state this repo produces. Either way the remedy is the
        // same — regenerate — so treat a read failure as "stale".
        committed = null
      }
      return committed !== artifact.content
    })
    if (stale.length === 0) {
      console.log(`gen-persistence-catalog: ${artifacts.map(a => a.out).join(', ')} are up to date.`)
      process.exit(0)
    }
    console.error(`gen-persistence-catalog: ${stale.map(a => a.out).join(', ')} stale. Run \`pnpm run gen-persistence-catalog\` and commit the result.`)
    process.exit(1)
  }

  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const artifact of artifacts) {
    writeFileSync(resolve(root, artifact.out), artifact.content)
    console.log(`gen-persistence-catalog: wrote ${artifact.out}.`)
  }
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  main()
}
