/**
 * Generate `docs/config-catalog.md` from package entry points, config types,
 * JSDoc, and static Schemastery schemas. Every package must classify, referenced
 * types must resolve without collisions, and every enumerable schema path must
 * exist on the declared config type. External and dynamic types stay unknown;
 * declared runtime-only fields need not appear in the schema. `--check` verifies
 * the committed artifact.
 */
/*
 * 文件职责：实现 gen-config-catalog.ts 覆盖的仓库生成、校验或维护职责。
 * 技术维度：使用 TypeScript、JavaScript、Vitest、Node.js 文件系统、AST 或项目图分析。
 * 产品维度：保障源码、生成目录、文档和发布元数据在开发与 CI 中保持一致。
 * 逻辑维度：读取仓库输入，构建中间模型，执行生成或校验，再报告差异和失败。
 * 关键边界：生成结果必须确定；路径与源码文本不可信；校验失败必须以非零状态显式报告。
 * 新手阅读建议：先看命令入口和输入目录，再读模型转换，最后关注输出文件与失败条件。
 */

import { globSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import ts from 'typescript'
import { LINK_MAP } from './gen-cordis-catalog.ts'
import { parseJsDoc, pointer, rawJsDoc } from './jsdoc.ts'
import { githubSlug } from './verify-md-links.ts'

/** 中文说明：变量 root 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const root = resolve(import.meta.dirname, '..')
/** 中文说明：常量 OUT 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const OUT = 'docs/config-catalog.md'

/** The fenced-block info string for pasted config declarations (skipped by
 * doc-typecheck, since a lone declaration referencing imports is not
 * standalone-compilable). */
/* 中文说明：常量 FENCE 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const FENCE = 'ts config-catalog'

/** TypeScript/Node global type names a config declaration may reference
 * without importing; never treated as unresolved. Extend when a new global
 * legitimately appears — the generator hard-errors on unknown names, so an
 * omission is loud, not silent. */
/* 中文说明：常量 GLOBAL_TYPES 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const GLOBAL_TYPES = new Set([
  'Array', 'ReadonlyArray', 'Record', 'Partial', 'Required', 'Readonly', 'Pick', 'Omit',
  'Promise', 'Map', 'Set', 'Date', 'Error', 'RegExp', 'Exclude', 'Extract', 'NonNullable',
  'ReturnType', 'Parameters', 'AbortSignal', 'URL', 'Buffer', 'NodeJS', 'Iterable', 'AsyncIterable',
])

/** How a package classifies for the catalog. */
/* 中文说明：type Kind 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
type Kind = 'config' | 'no-config' | 'seam' | 'library'

/** One name a pasted declaration references but the paste does not contain. */
/* 中文说明：interface TypeRef 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
interface TypeRef {
  /** The name as it appears in the pasted text (the local import alias). */
  alias: string
  /** The name the source module exports it under (pre-alias). */
  imported: string
  /** The import module specifier (package name or external module). */
  specifier: string
}

/** One verbatim declaration paste. */
/* 中文说明：interface Paste 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
interface Paste {
  /** Full source text: leading JSDoc (when present) through the closing token. */
  text: string
  /** Source pointer `packages/…/file.ts:line` of the declaration. */
  source: string
}

/** One package's catalog entry. */
/* 中文说明：interface CatalogEntry 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
export interface CatalogEntry {
  /** npm package name, e.g. `@deepseek-ai/dsh-agent-loop`. */
  pkg: string
  /** Repo-relative package dir, e.g. `packages/core/agent-loop`. */
  dir: string
  /** Repo-relative entry file, `<dir>/src/index.ts`. */
  entry: string
  kind: Kind
  /** Service keys the plugin `inject`s (empty when none declared). */
  inject: string[]
  /** Seam/service class name (kinds `seam` and class-based plugins). */
  className?: string
  /** Name of the config type (kind `config`). */
  configTypeName?: string
  /** Verbatim declaration pastes, the config type first (kind `config`). */
  pastes?: Paste[]
  /** References the pastes leave unresolved locally (kind `config`). */
  refs?: TypeRef[]
  /** Top-level keys and nested key paths (`agents[].id`) of the runtime
   * schema, `null` when no schema exists (kind `config`). */
  schemaKeys?: string[] | null
  /** Package names whose schemas an intersect composes (kind `config`). */
  schemaComposes?: string[]
}

/** A parsed source file plus its import map (local name → origin). */
/* 中文说明：interface FileCtx 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
interface FileCtx {
  abs: string
  rel: string
  text: string
  sf: ts.SourceFile
  /** Local binding name → `{ imported, specifier }`; default imports record
   * `imported: 'default'`. */
  imports: Map<string, { imported: string; specifier: string }>
}

/** Throw one aggregate error for every violation the walk collected. */
/* 中文说明：函数 report 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function report(violations: string[]): void {
  if (violations.length === 0) return
  throw new Error(
    `gen-config-catalog: ${violations.length} violation(s):\n`
    + violations.map(v => `  ${v}`).join('\n'),
  )
}

/** Parse a source file and index its import declarations. */
/* 中文说明：函数 loadFile 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function loadFile(abs: string, rel: string, cache: Map<string, FileCtx>): FileCtx {
  /** 中文说明：变量 cached 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const cached = cache.get(abs)
  if (cached) return cached
  /** 中文说明：变量 text 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const text = readFileSync(abs, 'utf8')
  /** 中文说明：变量 sf 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const sf = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true)
  /** 中文说明：变量 imports 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const imports = new Map<string, { imported: string; specifier: string }>()
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue
    /** 中文说明：变量 specifier 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const specifier = stmt.moduleSpecifier.text
    /** 中文说明：变量 clause 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const clause = stmt.importClause
    if (!clause) continue
    if (clause.name) imports.set(clause.name.text, { imported: 'default', specifier })
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
      for (const el of clause.namedBindings.elements) {
        imports.set(el.name.text, { imported: (el.propertyName ?? el.name).text, specifier })
      }
    }
    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      imports.set(clause.namedBindings.name.text, { imported: '*', specifier })
    }
  }
  /** 中文说明：变量 ctx 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = { abs, rel, text, sf, imports }
  cache.set(abs, ctx)
  return ctx
}

/** A type declaration a paste can contain. */
/* 中文说明：type TypeDecl 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
type TypeDecl = ts.InterfaceDeclaration | ts.TypeAliasDeclaration | ts.EnumDeclaration

/** Find a pasteable type declaration by name in a file, or null. */
/* 中文说明：函数 findTypeDecl 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function findTypeDecl(ctx: FileCtx, name: string): TypeDecl | null {
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const stmt of ctx.sf.statements) {
    if ((ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt) || ts.isEnumDeclaration(stmt))
      && stmt.name.text === name) return stmt
  }
  return null
}

/**
 * Resolve a type name from a file to its declaration (following package-local
 * relative imports transitively) or to the import that brings it in. Returns
 * `null` when the name is neither declared, imported, nor a known global.
 */
/* 中文说明：函数 resolveTypeName 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function resolveTypeName(
  ctx: FileCtx,
  name: string,
  cache: Map<string, FileCtx>,
  violations: string[],
): { decl: TypeDecl; ctx: FileCtx } | { ref: TypeRef } | null {
  /** 中文说明：变量 local 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const local = findTypeDecl(ctx, name)
  if (local) return { decl: local, ctx }
  /** 中文说明：变量 imp 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const imp = ctx.imports.get(name)
  if (!imp) return null
  if (imp.specifier.startsWith('.')) {
    if (!imp.specifier.endsWith('.ts')) {
      violations.push(`${ctx.rel}: relative import '${imp.specifier}' lacks the explicit .ts extension the repo convention requires.`)
      return null
    }
    if (imp.imported !== name) {
      violations.push(`${ctx.rel}: '${name}' aliases '${imp.imported}' across a package-local import; the catalog pastes declarations verbatim, so keep package-local config types unaliased.`)
      return null
    }
    /** 中文说明：变量 abs 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const abs = resolve(dirname(ctx.abs), imp.specifier)
    /** 中文说明：变量 rel 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const rel = ctx.rel.slice(0, ctx.rel.lastIndexOf('/') + 1) + imp.specifier.replace(/^\.\//, '')
    /** 中文说明：变量 target 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const target = loadFile(abs, rel, cache)
    return resolveTypeName(target, imp.imported, cache, violations)
  }
  return { ref: { alias: name, imported: imp.imported, specifier: imp.specifier } }
}

/** Collect every type NAME referenced in type positions under a node. */
/* 中文说明：函数 collectTypeNames 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function collectTypeNames(node: ts.Node, out: Set<string>): void {
  /** 中文说明：函数值 visit 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const visit = (n: ts.Node): void => {
    if (ts.isTypeReferenceNode(n)) {
      /** 中文说明：变量 head 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      let head: ts.EntityName = n.typeName
      while (ts.isQualifiedName(head)) head = head.left
      out.add(head.text)
    } else if (ts.isExpressionWithTypeArguments(n) && ts.isIdentifier(n.expression)) {
      out.add(n.expression.text) // heritage clause: `extends X`
    }
    ts.forEachChild(n, visit)
  }
  visit(node)
}

/** The verbatim paste text of a declaration: leading JSDoc through the end. */
/* 中文说明：函数 pasteText 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function pasteText(ctx: FileCtx, decl: TypeDecl): string {
  /** 中文说明：变量 raw 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const raw = rawJsDoc(ctx.text, decl)
  /** 中文说明：变量 start 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const start = raw ? ctx.text.indexOf(raw, decl.getFullStart()) : decl.getStart(ctx.sf)
  return ctx.text.slice(start, decl.end)
}

/** Enforce non-empty JSDoc prose on every property of a pasted declaration,
 * recursing into nested type literals (e.g. an array-of-objects field). */
/* 中文说明：函数 checkMemberDocs 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function checkMemberDocs(ctx: FileCtx, decl: TypeDecl, violations: string[]): void {
  /** 中文说明：函数值 walkMembers 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const walkMembers = (members: ts.NodeArray<ts.TypeElement>, path: string): void => {
    /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
    for (const member of members) {
      if (!ts.isPropertySignature(member)) continue
      /** 中文说明：变量 name 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const name = member.name.getText(ctx.sf)
      /** 中文说明：变量 where 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const where = `config field '${path}.${name}' (${pointer(ctx.rel, ctx.sf, member)})`
      if (!parseJsDoc(rawJsDoc(ctx.text, member)).doc) violations.push(`${where} has no JSDoc prose.`)
      if (member.type) walkNested(member.type, `${path}.${name}`)
    }
  }
  /** 中文说明：函数值 walkNested 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const walkNested = (type: ts.Node, path: string): void => {
    if (ts.isTypeLiteralNode(type)) walkMembers(type.members, path)
    else ts.forEachChild(type, (n) => { walkNested(n, path) })
  }
  if (ts.isInterfaceDeclaration(decl)) walkMembers(decl.members, decl.name.text)
  else if (ts.isTypeAliasDeclaration(decl)) walkNested(decl.type, decl.name.text)
}

/** Cross-file resolution context for the schema-path check. */
/* 中文说明：interface World 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
interface World {
  scanRoot: string
  cache: Map<string, FileCtx>
  /** Workspace package name → repo-relative package dir. */
  pkgDirByName: Map<string, string>
}

/** How a schema key path fared against the declared config type: definitely
 * present, definitely absent, or crossing a type the walk cannot enumerate
 * (only `missing` is a violation — `unknown` must never mis-report). */
/* 中文说明：type PathLookup 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
type PathLookup = 'found' | 'missing' | 'unknown'

/** One step of a schema key path: a named member, or an array-element hop. */
/* 中文说明：type PathStep 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
type PathStep = { member: string } | { array: true }

/** Parse a schema key path (`agents[].id`) into member/array steps. */
/* 中文说明：函数 parsePath 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function parsePath(path: string): PathStep[] {
  /** 中文说明：变量 steps 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const steps: PathStep[] = []
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const seg of path.split('.')) {
    /** 中文说明：变量 name 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let name = seg
    /** 中文说明：变量 arrays 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let arrays = 0
    while (name.endsWith('[]')) {
      name = name.slice(0, -2)
      arrays += 1
    }
    steps.push({ member: name })
    /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
    for (let i = 0; i < arrays; i += 1) steps.push({ array: true })
  }
  return steps
}

/** Load a package-relative import target as a FileCtx. */
/* 中文说明：函数 loadRelative 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function loadRelative(world: World, from: FileCtx, specifier: string): FileCtx {
  /** 中文说明：变量 abs 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const abs = resolve(dirname(from.abs), specifier)
  /** 中文说明：变量 rel 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const rel = from.rel.slice(0, from.rel.lastIndexOf('/') + 1) + specifier.replace(/^\.\//, '')
  return loadFile(abs, rel, world.cache)
}

/** Find a type declaration EXPORTED (directly or via re-export chains) from a
 * file, following `export … from './x.ts'` and `export * from './x.ts'`. */
/* 中文说明：函数 findExportedTypeDecl 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function findExportedTypeDecl(world: World, ctx: FileCtx, name: string, seen = new Set<string>()): { decl: TypeDecl; ctx: FileCtx } | null {
  /** 中文说明：变量 key 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const key = `${ctx.abs}#${name}`
  if (seen.has(key)) return null
  seen.add(key)
  /** 中文说明：变量 local 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const local = findTypeDecl(ctx, name)
  if (local) return { decl: local, ctx }
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const stmt of ctx.sf.statements) {
    if (!ts.isExportDeclaration(stmt) || !stmt.moduleSpecifier || !ts.isStringLiteral(stmt.moduleSpecifier)) continue
    /** 中文说明：变量 spec 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const spec = stmt.moduleSpecifier.text
    if (!spec.startsWith('.') || !spec.endsWith('.ts')) continue
    /** 中文说明：变量 lookFor 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let lookFor: string | null = null
    if (!stmt.exportClause) {
      lookFor = name // export * from './x.ts'
    } else if (ts.isNamedExports(stmt.exportClause)) {
      /** 中文说明：函数值 el 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
      const el = stmt.exportClause.elements.find(e => e.name.text === name)
      if (el) lookFor = (el.propertyName ?? el.name).text
    }
    if (lookFor === null) continue
    /** 中文说明：变量 hit 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const hit = findExportedTypeDecl(world, loadRelative(world, ctx, spec), lookFor, seen)
    if (hit) return hit
  }
  return null
}

/** Resolve a referenced type NAME to its declaration: declared locally, via a
 * package-relative import, or via a workspace-package import (entry file +
 * re-export chains). `'unknown'` = external or otherwise out of reach. */
/* 中文说明：函数 declForTypeName 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function declForTypeName(world: World, ctx: FileCtx, name: string): { decl: TypeDecl; ctx: FileCtx } | 'unknown' {
  /** 中文说明：变量 local 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const local = findTypeDecl(ctx, name)
  if (local) return { decl: local, ctx }
  /** 中文说明：变量 imp 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const imp = ctx.imports.get(name)
  if (!imp) return 'unknown'
  if (imp.specifier.startsWith('.')) {
    if (!imp.specifier.endsWith('.ts')) return 'unknown'
    return findExportedTypeDecl(world, loadRelative(world, ctx, imp.specifier), imp.imported) ?? 'unknown'
  }
  /** 中文说明：变量 dir 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const dir = world.pkgDirByName.get(imp.specifier)
  if (dir === undefined) return 'unknown'
  /** 中文说明：变量 entryRel 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const entryRel = `${dir}/src/index.ts`
  /** 中文说明：变量 entry 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let entry: FileCtx
  try {
    entry = loadFile(resolve(world.scanRoot, entryRel), entryRel, world.cache)
  } catch {
    // A workspace package without a readable entry is reported by its own
    // classification pass; for a lookup it is out of reach.
    return 'unknown'
  }
  return findExportedTypeDecl(world, entry, imp.imported) ?? 'unknown'
}

/** Utility wrappers that pass a member lookup through to their type argument. */
/* 中文说明：常量 PASSTHROUGH_WRAPPERS 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const PASSTHROUGH_WRAPPERS = new Set(['Partial', 'Required', 'Readonly', 'NonNullable'])

/**
 * Walk a schema key path against a declared type. This is a PRESENCE check,
 * not a runtime value check: it answers "does the declared config type have a member
 * here", resolving interfaces (heritage included), type aliases, literals,
 * intersections, unions, arrays, indexed access, pass-through utility
 * wrappers, and type references across package-local and workspace imports.
 * Anything it cannot see through resolves `'unknown'`, never `'missing'`.
 */
/* 中文说明：函数 lookupPath 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function lookupPath(world: World, ctx: FileCtx, node: ts.Node, steps: PathStep[], seen: Set<string>): PathLookup {
  if (steps.length === 0) return 'found'
  // Guard only named declarations, where recursive types can loop. Structural
  // children can share a source position with their parent, so guarding them
  // would mistake ordinary descent for a cycle.
  if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
    /** 中文说明：变量 key 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const key = `${ctx.abs}:${node.pos}:${steps.length}`
    if (seen.has(key)) return 'unknown' // recursive type — bail rather than loop
    seen.add(key)
  }
  /** 中文说明：变量 step 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const step = steps[0]
  if (step === undefined) return 'found'
  // Combine branch results: any found wins, else any unknown taints, else missing.
  /** 中文说明：函数值 combine 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const combine = (results: PathLookup[]): PathLookup => {
    if (results.includes('found')) return 'found'
    if (results.includes('unknown')) return 'unknown'
    return 'missing'
  }
  /** 中文说明：函数值 intoMembers 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const intoMembers = (members: ts.NodeArray<ts.TypeElement>): PathLookup | null => {
    if (!('member' in step)) return null
    /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
    for (const m of members) {
      if (!ts.isPropertySignature(m) || m.name.getText(ctx.sf) !== step.member) continue
      if (steps.length === 1) return 'found'
      return m.type ? lookupPath(world, ctx, m.type, steps.slice(1), seen) : 'unknown'
    }
    return null // not among these members; caller consults heritage/parts
  }
  if (ts.isInterfaceDeclaration(node)) {
    if (!('member' in step)) return 'unknown' // an array step cannot land on an interface
    /** 中文说明：变量 direct 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const direct = intoMembers(node.members)
    if (direct !== null) return direct
    /** 中文说明：变量 bases 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bases: PathLookup[] = []
    /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
    for (const clause of node.heritageClauses ?? []) {
      /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
      for (const base of clause.types) {
        if (!ts.isIdentifier(base.expression)) {
          bases.push('unknown')
          continue
        }
        /** 中文说明：变量 resolved 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const resolved = declForTypeName(world, ctx, base.expression.text)
        bases.push(resolved === 'unknown' ? 'unknown' : lookupPath(world, resolved.ctx, resolved.decl, steps, seen))
      }
    }
    return bases.length ? combine(bases) : 'missing'
  }
  if (ts.isTypeAliasDeclaration(node)) return lookupPath(world, ctx, node.type, steps, seen)
  if (ts.isTypeLiteralNode(node)) {
    if (!('member' in step)) return 'unknown'
    return intoMembers(node.members) ?? 'missing'
  }
  if (ts.isParenthesizedTypeNode(node)) return lookupPath(world, ctx, node.type, steps, seen)
  if (ts.isIntersectionTypeNode(node)) {
    return combine(node.types.map(t => lookupPath(world, ctx, t, steps, seen)))
  }
  if (ts.isUnionTypeNode(node)) {
    // Presence on a union is only definite when every branch agrees.
    /** 中文说明：函数值 results 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
    const results = node.types.map(t => lookupPath(world, ctx, t, steps, seen))
    if (results.every(r => r === 'found')) return 'found'
    if (results.every(r => r === 'missing')) return 'missing'
    return 'unknown'
  }
  if (ts.isArrayTypeNode(node)) {
    return 'array' in step ? lookupPath(world, ctx, node.elementType, steps.slice(1), seen) : 'unknown'
  }
  if (ts.isTypeOperatorNode(node)) return lookupPath(world, ctx, node.type, steps, seen)
  if (ts.isIndexedAccessTypeNode(node)) {
    /** 中文说明：变量 index 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const index = node.indexType
    if (ts.isLiteralTypeNode(index) && ts.isStringLiteral(index.literal)) {
      return lookupPath(world, ctx, node.objectType, [{ member: index.literal.text }, ...steps], seen)
    }
    return 'unknown'
  }
  if (ts.isTypeReferenceNode(node)) {
    /** 中文说明：变量 head 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let head: ts.EntityName = node.typeName
    while (ts.isQualifiedName(head)) head = head.left
    /** 中文说明：变量 name 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const name = head.text
    if (PASSTHROUGH_WRAPPERS.has(name) && node.typeArguments?.[0]) {
      return lookupPath(world, ctx, node.typeArguments[0], steps, seen)
    }
    if ((name === 'Array' || name === 'ReadonlyArray') && node.typeArguments?.[0]) {
      return 'array' in step ? lookupPath(world, ctx, node.typeArguments[0], steps.slice(1), seen) : 'unknown'
    }
    if (!ts.isIdentifier(node.typeName)) return 'unknown' // namespace-qualified: out of reach
    /** 中文说明：变量 resolved 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const resolved = declForTypeName(world, ctx, name)
    return resolved === 'unknown' ? 'unknown' : lookupPath(world, resolved.ctx, resolved.decl, steps, seen)
  }
  return 'unknown'
}

/** Unwrap `as` / `satisfies` / parenthesized wrappers around an expression. */
/* 中文说明：函数 unwrapExpr 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function unwrapExpr(expr: ts.Expression): ts.Expression {
  /** 中文说明：变量 e 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let e = expr
  while (ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isParenthesizedExpression(e)) e = e.expression
  return e
}

/**
 * Statically walk a schemastery schema expression to its key paths plus the
 * packages whose schemas an intersect composes. A key path is the top-level
 * key or a nested path through object/array compositions (`agents[].id`).
 * Handles the declaration forms the repo uses — `z.object({…})` (possibly behind
 * chained calls) and `z.intersect([X.Config, …])` — and hard-errors on
 * anything else, so a schema the walk cannot see fails the gate instead of
 * silently thinning it. Nested values that are neither `object` nor `array`
 * compositions (primitives, unions, dynamic-key dicts) contribute no paths.
 */
/* 中文说明：函数 walkSchemaExpr 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function walkSchemaExpr(
  ctx: FileCtx,
  expr: ts.Expression,
  where: string,
  violations: string[],
): { keys: string[]; composes: string[] } {
  /** 中文说明：变量 keys 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const keys: string[] = []
  /** 中文说明：变量 composes 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const composes: string[] = []
  // Nested paths under one object property's VALUE expression: recurse through
  // chained refinements toward the base call, descending into object/array.
  /** 中文说明：函数值 collectValuePaths 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const collectValuePaths = (value: ts.Expression, base: string): void => {
    /** 中文说明：变量 call 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const call = unwrapExpr(value)
    if (!ts.isCallExpression(call) || !ts.isPropertyAccessExpression(call.expression)) return
    /** 中文说明：变量 method 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const method = call.expression.name.text
    if (method === 'object' && call.arguments[0] && ts.isObjectLiteralExpression(call.arguments[0])) {
      /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
      for (const prop of call.arguments[0].properties) {
        if (!ts.isPropertyAssignment(prop)) continue
        /** 中文说明：变量 key 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const key = ts.isStringLiteral(prop.name) ? prop.name.text : prop.name.getText(ctx.sf)
        keys.push(`${base}.${key}`)
        collectValuePaths(prop.initializer, `${base}.${key}`)
      }
      return
    }
    if (method === 'array' && call.arguments[0]) {
      collectValuePaths(call.arguments[0], `${base}[]`)
      return
    }
    /** 中文说明：变量 inner 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const inner = unwrapExpr(call.expression.expression)
    if (ts.isCallExpression(inner)) collectValuePaths(inner, base)
  }
  /** 中文说明：函数值 visit 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const visit = (e: ts.Expression): void => {
    /** 中文说明：变量 call 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const call = unwrapExpr(e)
    if (!ts.isCallExpression(call) || !ts.isPropertyAccessExpression(call.expression)) {
      violations.push(`${where}: schema expression is not a statically walkable schemastery call.`)
      return
    }
    /** 中文说明：变量 method 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const method = call.expression.name.text
    if (method === 'object' && call.arguments[0] && ts.isObjectLiteralExpression(call.arguments[0])) {
      /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
      for (const prop of call.arguments[0].properties) {
        if (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) {
          /** 中文说明：变量 key 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const key = ts.isStringLiteral(prop.name) ? prop.name.text : prop.name.getText(ctx.sf)
          keys.push(key)
          if (ts.isPropertyAssignment(prop)) collectValuePaths(prop.initializer, key)
        } else {
          violations.push(`${where}: schema object property '${prop.getText(ctx.sf)}' is not a plain key.`)
        }
      }
      return
    }
    if (method === 'intersect' && call.arguments[0] && ts.isArrayLiteralExpression(call.arguments[0])) {
      /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
      for (const el of call.arguments[0].elements) {
        /** 中文说明：变量 part 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const part = unwrapExpr(el)
        if (ts.isPropertyAccessExpression(part) && part.name.text === 'Config' && ts.isIdentifier(part.expression)) {
          /** 中文说明：变量 imp 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const imp = ctx.imports.get(part.expression.text)
          if (imp && !imp.specifier.startsWith('.')) { composes.push(imp.specifier); continue }
        }
        if (ts.isCallExpression(part)) { visit(part); continue }
        violations.push(`${where}: intersect element '${part.getText(ctx.sf)}' is neither a workspace plugin's Config nor an inline schema call.`)
      }
      return
    }
    // A union of objects (discriminated union config): collect keys from all
    // variants. Each variant is visited the same way as an intersect element.
    if (method === 'union' && call.arguments[0] && ts.isArrayLiteralExpression(call.arguments[0])) {
      /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
      for (const el of call.arguments[0].elements) {
        /** 中文说明：变量 part 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const part = unwrapExpr(el)
        if (ts.isCallExpression(part)) { visit(part); continue }
      }
      return
    }
    // A chained refinement (`z.object({…}).default(…)` etc.): the keys live on
    // the call the chain hangs off — keep unwrapping toward it.
    /** 中文说明：变量 base 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const base = unwrapExpr(call.expression.expression)
    if (ts.isCallExpression(base)) { visit(base); return }
    violations.push(`${where}: schema call '${method}' is not object/intersect and hangs off no walkable base call.`)
  }
  visit(expr)
  return { keys, composes }
}

/** Find a plugin's schemastery schema expression: an exported `const Config`
 * in the entry file, else a `static Config` on the plugin class. */
/* 中文说明：函数 findSchemaExpr 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function findSchemaExpr(ctx: FileCtx, pluginClass: ts.ClassDeclaration | null): ts.Expression | null {
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const stmt of ctx.sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue
    if (!stmt.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) continue
    /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
    for (const decl of stmt.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.name.text === 'Config' && decl.initializer) return decl.initializer
    }
  }
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const member of pluginClass?.members ?? []) {
    if (!ts.isPropertyDeclaration(member) || member.name.getText() !== 'Config') continue
    if (!member.modifiers?.some(m => m.kind === ts.SyntaxKind.StaticKeyword)) continue
    if (member.initializer) return member.initializer
  }
  return null
}

/** Read an `inject` service-key list: `export const inject = […]` in the entry
 * file, else `static inject = […]` on the plugin class. */
/* 中文说明：函数 findInject 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function findInject(ctx: FileCtx, pluginClass: ts.ClassDeclaration | null, violations: string[]): string[] {
  /** 中文说明：函数值 fromArray 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const fromArray = (expr: ts.Expression, where: string): string[] => {
    if (!ts.isArrayLiteralExpression(expr)) {
      violations.push(`${where}: inject is not a plain string-array literal; teach the generator the new declaration form.`)
      return []
    }
    return expr.elements.map(el => ts.isStringLiteral(el) ? el.text : el.getText(ctx.sf))
  }
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const stmt of ctx.sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue
    /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
    for (const decl of stmt.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.name.text === 'inject' && decl.initializer) {
        return fromArray(decl.initializer, ctx.rel)
      }
    }
  }
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const member of pluginClass?.members ?? []) {
    if (ts.isPropertyDeclaration(member) && member.name.getText() === 'inject' && member.initializer) {
      return fromArray(member.initializer, ctx.rel)
    }
  }
  return []
}

/** Resolve the entry file's default export to its class/function declaration
 * (mirroring the Loader's `unwrapExports`), or null when there is none. */
/* 中文说明：函数 defaultExport 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function defaultExport(ctx: FileCtx): ts.ClassDeclaration | ts.FunctionDeclaration | null {
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const stmt of ctx.sf.statements) {
    if (ts.isExportAssignment(stmt) && !stmt.isExportEquals && ts.isIdentifier(stmt.expression)) {
      /** 中文说明：变量 name 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const name = stmt.expression.text
      /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
      for (const s of ctx.sf.statements) {
        if ((ts.isClassDeclaration(s) || ts.isFunctionDeclaration(s)) && s.name?.text === name) return s
      }
      return null
    }
    if ((ts.isClassDeclaration(stmt) || ts.isFunctionDeclaration(stmt))
      && stmt.modifiers?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword)) return stmt
  }
  return null
}

/** Find the exported `apply` function declaration in the entry file, or null. */
/* 中文说明：函数 applyExport 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function applyExport(ctx: FileCtx): ts.FunctionDeclaration | null {
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const stmt of ctx.sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === 'apply'
      && stmt.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) return stmt
  }
  return null
}

/**
 * Walk every `packages/<group>/<pkg>` entry and build the catalog entries.
 * Hard-errors (aggregated) on any violation listed in the module doc.
 * `scanRoot` defaults to the repo root; tests pass a fixture dir.
 */
/* 中文说明：函数 collectConfigCatalog 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function collectConfigCatalog(scanRoot: string = root): CatalogEntry[] {
  /** 中文说明：变量 violations 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const violations: string[] = []
  /** 中文说明：变量 cache 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const cache = new Map<string, FileCtx>()
  /** 中文说明：变量 entries 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const entries: CatalogEntry[] = []

  // Pre-pass: package name → dir, so schema-path lookups can follow
  // workspace-package imports while individual packages are still being walked.
  /** 中文说明：变量 pkgDirByName 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const pkgDirByName = new Map<string, string>()
  /** 中文说明：变量 manifests 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const manifests: { dir: string; pkg: string }[] = []
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const manifestRel of globSync('packages/*/*/package.json', { cwd: scanRoot }).map(path => path.split(sep).join('/')).sort()) {
    /** 中文说明：变量 dir 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dir = manifestRel.slice(0, -'/package.json'.length)
    /** 中文说明：变量 manifest 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const manifest = JSON.parse(readFileSync(resolve(scanRoot, manifestRel), 'utf8')) as { name?: string; os?: string[]; cpu?: string[] }
    /** 中文说明：变量 pkg 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pkg = manifest.name
    if (!pkg) {
      violations.push(`${manifestRel} has no "name".`)
      continue
    }
    if (manifest.os !== undefined && manifest.cpu !== undefined) {
      // A per-platform native-binary package (npm os/cpu selection) ships no
      // JavaScript at all — nothing to classify, no Config to catalog.
      continue
    }
    pkgDirByName.set(pkg, dir)
    manifests.push({ dir, pkg })
  }
  /** 中文说明：变量 world 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const world: World = { scanRoot, cache, pkgDirByName }

  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const { dir, pkg } of manifests) {
    /** 中文说明：变量 entryRel 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const entryRel = `${dir}/src/index.ts`
    /** 中文说明：变量 ctx 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let ctx: FileCtx
    try {
      ctx = loadFile(resolve(scanRoot, entryRel), entryRel, cache)
    } catch {
      // A package without src/index.ts cannot be classified — that is the
      // violation itself; nothing else in this loop body can run without it.
      violations.push(`${pkg}: entry ${entryRel} is missing or unreadable.`)
      continue
    }

    // Classify, mirroring the Loader's unwrapExports: the default export IS
    // the plugin when present; else an exported `apply` makes the module
    // namespace the plugin; else the package is a plain library.
    /** 中文说明：变量 dflt 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dflt = defaultExport(ctx)
    /** 中文说明：变量 apply 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const apply = applyExport(ctx)
    /** 中文说明：变量 pluginClass 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let pluginClass: ts.ClassDeclaration | null = null
    /** 中文说明：变量 configParam 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let configParam: ts.ParameterDeclaration | undefined
    /** 中文说明：变量 kind 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let kind: Kind
    /** 中文说明：变量 className 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let className: string | undefined
    if (dflt && ts.isClassDeclaration(dflt)) {
      className = dflt.name?.text
      if (dflt.modifiers?.some(m => m.kind === ts.SyntaxKind.AbstractKeyword)) {
        kind = 'seam'
      } else {
        pluginClass = dflt
        /** 中文说明：变量 ctor 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const ctor = dflt.members.find(ts.isConstructorDeclaration)
        configParam = ctor?.parameters[1]
        kind = configParam ? 'config' : 'no-config'
      }
    } else if (dflt) {
      configParam = dflt.parameters[1]
      kind = configParam ? 'config' : 'no-config'
    } else if (apply) {
      configParam = apply.parameters[1]
      kind = configParam ? 'config' : 'no-config'
    } else {
      kind = 'library'
    }

    /** 中文说明：变量 entry 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const entry: CatalogEntry = {
      pkg,
      dir,
      entry: entryRel,
      kind,
      inject: kind === 'library' || kind === 'seam' ? [] : findInject(ctx, pluginClass, violations),
      ...className !== undefined ? { className } : {},
    }
    entries.push(entry)
    if (kind !== 'config' || !configParam) continue

    // Resolve the config type and paste its package-local transitive closure.
    if (!configParam.type || !ts.isTypeReferenceNode(configParam.type) || !ts.isIdentifier(configParam.type.typeName)) {
      violations.push(`${pkg}: config parameter type (${pointer(entryRel, ctx.sf, configParam)}) is not a plain type-name reference; declare a named config type.`)
      continue
    }
    /** 中文说明：变量 typeName 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const typeName = configParam.type.typeName.text
    entry.configTypeName = typeName
    /** 中文说明：变量 pastes 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pastes: Paste[] = []
    /** 中文说明：变量 refs 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const refs = new Map<string, TypeRef>()
    // A bare name is the fence's whole namespace: two DIFFERENT declarations
    // (or a declaration in one file and an import in another) sharing a name
    // cannot both render unambiguously, so every resolution is identity-checked
    // by source pointer and a collision is a violation, never a silent skip.
    /** 中文说明：变量 pastedDeclByName 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pastedDeclByName = new Map<string, string>()
    /** 中文说明：变量 queue 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const queue: { name: string; from: FileCtx }[] = [{ name: typeName, from: ctx }]
    /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
      const { name, from } = item
      /** 中文说明：变量 resolved 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const resolved = resolveTypeName(from, name, cache, violations)
      if (resolved === null) {
        violations.push(`${pkg}: config declaration references '${name}' (via ${from.rel}), which is neither declared in the package, imported, nor a known global type.`)
        continue
      }
      if ('ref' in resolved) {
        if (name === typeName) {
          violations.push(`${pkg}: config type '${name}' is imported from '${resolved.ref.specifier}'; a plugin's config type must live in its own package.`)
          continue
        }
        if (pastedDeclByName.has(name)) {
          violations.push(`${pkg}: '${name}' resolves to a package-local declaration (${pastedDeclByName.get(name) ?? ''}) in one file and an import from '${resolved.ref.specifier}' in another; rename one so the fence is unambiguous.`)
          continue
        }
        /** 中文说明：变量 existing 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const existing = refs.get(name)
        if (existing && (existing.specifier !== resolved.ref.specifier || existing.imported !== resolved.ref.imported)) {
          violations.push(`${pkg}: '${name}' is imported from both '${existing.specifier}' (${existing.imported}) and '${resolved.ref.specifier}' (${resolved.ref.imported}) across the pasted closure; disambiguate the aliases.`)
          continue
        }
        refs.set(name, resolved.ref)
        continue
      }
      /** 中文说明：变量 declKey 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const declKey = pointer(resolved.ctx.rel, resolved.ctx.sf, resolved.decl)
      /** 中文说明：变量 prior 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const prior = pastedDeclByName.get(name)
      if (prior === declKey) continue // same declaration reached again — benign
      if (prior !== undefined) {
        violations.push(`${pkg}: type name '${name}' resolves to two different declarations (${prior} and ${declKey}) across the pasted closure; rename one — a verbatim fence cannot carry two same-named declarations.`)
        continue
      }
      if (refs.has(name)) {
        violations.push(`${pkg}: '${name}' resolves to an import from '${refs.get(name)?.specifier ?? ''}' in one file and a package-local declaration (${declKey}) in another; rename one so the fence is unambiguous.`)
        continue
      }
      pastedDeclByName.set(name, declKey)
      pastes.push({ text: pasteText(resolved.ctx, resolved.decl), source: declKey })
      checkMemberDocs(resolved.ctx, resolved.decl, violations)
      /** 中文说明：变量 names 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const names = new Set<string>()
      collectTypeNames(resolved.decl, names)
      /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
      for (const n of names) {
        if (GLOBAL_TYPES.has(n)) continue
        queue.push({ name: n, from: resolved.ctx })
      }
    }
    entry.pastes = pastes
    entry.refs = [...refs.values()].sort((a, b) => a.alias.localeCompare(b.alias))

    // Statically walk the runtime schema (when one exists) for the subset check.
    /** 中文说明：变量 schemaExpr 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const schemaExpr = findSchemaExpr(ctx, pluginClass)
    if (schemaExpr) {
      const { keys, composes } = walkSchemaExpr(ctx, unwrapExpr(schemaExpr), `${pkg} (${entryRel})`, violations)
      entry.schemaKeys = keys
      entry.schemaComposes = composes
    } else {
      entry.schemaKeys = null
    }
  }

  // Fold composed schemas' key paths in, then check each path against the type.
  // Only a definite miss fails; types the walk cannot enumerate stay unknown.
  /** 中文说明：函数值 byName 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const byName = new Map(entries.map(e => [e.pkg, e]))
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const entry of entries) {
    if (entry.kind !== 'config' || entry.schemaKeys === null || entry.schemaKeys === undefined) continue
    /** 中文说明：变量 seen 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const seen = new Set<string>()
    /** 中文说明：函数值 foldComposed 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
    const foldComposed = (e: CatalogEntry): string[] => {
      if (seen.has(e.pkg)) return []
      seen.add(e.pkg)
      /** 中文说明：变量 keys 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const keys = [...e.schemaKeys ?? []]
      /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
      for (const composed of e.schemaComposes ?? []) {
        /** 中文说明：变量 target 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const target = byName.get(composed)
        if (!target) {
          violations.push(`${entry.pkg}: schema intersects '${composed}', which is not a workspace package the walk collected.`)
          continue
        }
        keys.push(...foldComposed(target))
      }
      return keys
    }
    /** 中文说明：变量 allKeys 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const allKeys = foldComposed(entry)
    /** 中文说明：变量 mainPaste 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mainPaste = entry.pastes?.[0]
    /** 中文说明：变量 mainFile 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mainFile = mainPaste?.source.split(':')[0]
    /** 中文说明：变量 mainCtx 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mainCtx = mainFile !== undefined ? cache.get(resolve(scanRoot, mainFile)) : undefined
    /** 中文说明：变量 mainDecl 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mainDecl = mainCtx && entry.configTypeName !== undefined ? findTypeDecl(mainCtx, entry.configTypeName) : null
    if (!mainCtx || !mainDecl) {
      violations.push(`${entry.pkg}: cannot locate config type '${entry.configTypeName ?? ''}' for the schema-path check.`)
      continue
    }
    /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
    for (const keyPath of allKeys) {
      if (lookupPath(world, mainCtx, mainDecl, parsePath(keyPath), new Set()) === 'missing') {
        violations.push(`${entry.pkg}: schema validates key '${keyPath}' but config type '${entry.configTypeName ?? ''}' declares no such member — the catalog paste would hide a loader-accepted field.`)
      }
    }
  }

  report(violations)
  return entries.sort((a, b) => a.pkg.localeCompare(b.pkg))
}

/** Render the `Requires:` service-key line, or '' when the plugin injects nothing. */
/* 中文说明：函数 requiresLine 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function requiresLine(inject: string[]): string {
  return inject.length ? `Requires: ${inject.map(k => `\`${k}\``).join(' · ')}` : ''
}

/** Render one reference as a link: another plugin's config type → its section,
 * a curated subsystems name → its page, any other workspace type →
 * its source file, an external type → named with its module, unlinked. */
/* 中文说明：函数 refLink 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function refLink(ref: TypeRef, byName: Map<string, CatalogEntry>): string {
  /** 中文说明：变量 target 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const target = byName.get(ref.specifier)
  if (target?.kind === 'config' && ref.imported === target.configTypeName) {
    return `[\`${ref.alias}\`](#${githubSlug(target.pkg)})`
  }
  /** 中文说明：变量 page 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const page = LINK_MAP[ref.imported]
  if (page) return `[\`${ref.alias}\`](subsystems/${page})`
  if (target) return `[\`${ref.alias}\`](../${target.entry})`
  return `\`${ref.alias}\` (\`${ref.specifier}\`)`
}

/** Render one configurable plugin's section. */
/* 中文说明：函数 renderConfigEntry 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function renderConfigEntry(entry: CatalogEntry, byName: Map<string, CatalogEntry>): string[] {
  /** 中文说明：变量 out 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const out = [`<a id="${githubSlug(entry.pkg)}"></a>`, '', `## \`${entry.pkg}\``, '']
  /** 中文说明：变量 requires 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const requires = requiresLine(entry.inject)
  if (requires) out.push(requires, '')
  out.push('```' + FENCE, ...(entry.pastes ?? []).map(p => p.text).join('\n\n').split('\n'), '```', '')
  if (entry.refs && entry.refs.length > 0) {
    out.push(`Depends on: ${entry.refs.map(r => refLink(r, byName)).join(' · ')}`, '')
  }
  /** 中文说明：变量 source 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const source = entry.pastes?.[0]?.source ?? entry.entry
  out.push(`Source: [\`${source}\`](../${source.split(':')[0]})`, '')
  return out
}

/** Render one terse list line (the no-config / seam / library sections). */
/* 中文说明：函数 renderTerse 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function renderTerse(entry: CatalogEntry, detail: string): string {
  /** 中文说明：函数值 requires 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const requires = entry.inject.length ? ` — requires ${entry.inject.map(k => `\`${k}\``).join(' · ')}` : ''
  return `- \`${entry.pkg}\`${detail}${requires} ([\`${entry.entry}\`](../${entry.entry}))`
}

/** Render the full catalog (pure, deterministic given sorted entries). */
/* 中文说明：函数 render 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function render(entries: CatalogEntry[]): string {
  /** 中文说明：函数值 byName 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const byName = new Map(entries.map(e => [e.pkg, e]))
  /** 中文说明：变量 lines 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const lines: string[] = [
    '<!-- Generated by scripts/gen-config-catalog.ts — do not edit by hand.',
    '     Run `pnpm run gen-config-catalog` to regenerate. -->',
    '',
    '# Plugin Config Catalog',
    '',
    'Every `config:` block a `cordis.yml` entry can set: for each loadable harness package, the verbatim config declaration (JSDoc included) its `apply` function or service constructor receives, with every referenced type pasted alongside (package-local types) or linked (everything else). The paste is the plugin\'s full declared config type — a field the runtime schema deliberately excludes is a runtime-only seam (its own JSDoc says so) and is not settable from `cordis.yml`. This is the **deployment**-axis reference — the wiring a plugin author works against is the generated Cordis API region on each [subsystem page](subsystems/core.md), the model-facing tool schemas are the [tool catalog](tool-catalog.md), and [subsystems/](subsystems/core.md) documents the types these declarations reference.',
    '',
    'This file is GENERATED from source (`scripts/gen-config-catalog.ts`) and verified fresh by `pnpm run verify-config-catalog` (part of `doc-sync`) — do not edit it by hand. Declaration blocks use a `ts config-catalog` fence (skipped by doc-typecheck, since a lone declaration referencing imports is not standalone-compilable). The generator also cross-checks the runtime schemastery schema against the pasted declaration — every schema-validated key, nested keys included, must be locatable on the declared config type — so the paste cannot hide a loader-accepted field.',
    '',
    'A `Requires:` line lists the service keys the plugin `inject`s: its `cordis.yml` tree must also load providers for those services. Scope is the harness tier (`packages/`); the vendored cordis plugins a config tree may also load (`hmr`, the console logger, …) are pinned upstream source ([vendoring policy](../vendor/README.md)) and not catalogued here.',
    '',
  ]
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const entry of entries.filter(e => e.kind === 'config')) {
    lines.push(...renderConfigEntry(entry, byName))
  }
  lines.push(
    '## Loadable plugins with no config',
    '',
    'These load from a `cordis.yml` entry with no `config:` block; they declare no configuration API.',
    '',
    ...entries.filter(e => e.kind === 'no-config').map(e => renderTerse(e, '')),
    '',
    '## Seam packages (not directly loadable)',
    '',
    'Abstract service classes — a deployment loads a concrete implementation package instead ([capability seams](../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md)).',
    '',
    ...entries.filter(e => e.kind === 'seam').map(e => renderTerse(e, ` — abstract \`${e.className ?? ''}\``)),
    '',
    '## Library packages (no plugin entry)',
    '',
    'Imported as libraries by other packages; a `cordis.yml` cannot load them.',
    '',
    ...entries.filter(e => e.kind === 'library').map(e => renderTerse(e, '')),
    '',
  )
  return lines.join('\n')
}

/** CLI entry: default writes the catalog, `--check` fails if the committed
 * copy is stale. Guarded behind an entry-point check so importing this module
 * for tests neither regenerates the committed file nor calls process.exit. */
/* 中文说明：函数 main 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function main(): void {
  /** 中文说明：变量 content 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const content = render(collectConfigCatalog())
  if (process.argv.includes('--check')) {
    /** 中文说明：变量 committed 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let committed: string | null = null
    try {
      committed = readFileSync(resolve(root, OUT), 'utf8')
    } catch {
      // Only ENOENT (not yet generated) is expected; a present-but-unreadable
      // file is not a state this repo produces. Either way the remedy is the
      // same — regenerate — so treat a read failure as "stale".
      committed = null
    }
    if (committed === content) {
      console.log(`gen-config-catalog: ${OUT} is up to date.`)
      process.exit(0)
    }
    console.error(`gen-config-catalog: ${OUT} is stale. Run \`pnpm run gen-config-catalog\` and commit ${OUT}.`)
    process.exit(1)
  }
  writeFileSync(resolve(root, OUT), content)
  console.log(`gen-config-catalog: wrote ${OUT}.`)
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  main()
}
