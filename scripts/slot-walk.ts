/**
 * AST helpers for the client slot surface: the `SlotMap` declaration merges
 * that type every slot, and the `slots.register` call sites that say who
 * already occupies one. Both readings are lexical (no type-checker program):
 * the client catalog generator consumes them, and the same scan doubles as its
 * own exhaustiveness backstop because it reads every source file rather than a
 * reachable-export closure.
 */
/*
 * 文件职责：实现 slot-walk.ts 覆盖的发布、门禁、翻译配对或仓库维护职责。
 * 技术维度：使用 TypeScript、Vitest、Node.js 文件系统、Git、包管理器或构建产物校验。
 * 产品维度：保障项目发布物、文档配对和 CI 门禁保持一致且可追踪。
 * 逻辑维度：解析参数与仓库状态，执行检查或发布步骤，再输出诊断和退出状态。
 * 关键边界：发布与 Git 操作会改变外部状态；失败必须显式停止；路径和命令输出不可信。
 * 新手阅读建议：先看入口参数和只读检查，再读状态变更步骤，最后关注回滚、错误码和平台差异。
 */

import { globSync, readFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import ts from 'typescript'

/** The module whose `SlotMap` / standard-kit interfaces every slot owner merges into. */
/* 中文说明：常量 SLOTS_MODULE 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const SLOTS_MODULE = '@deepseek-ai/dsh-client-ui-slots'

/** Cheap textual prefilter for a slot-contract merge, quote-style agnostic. */
/* 中文说明：常量 MERGE_HEAD 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const MERGE_HEAD = /declare module ['"]@deepseek-ai\/dsh-client-ui-slots['"]/

/** Cheap textual prefilter for a registration call site. */
/* 中文说明：常量 REGISTER_HEAD 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const REGISTER_HEAD = /\.register\(/

/** One `SlotMap` member: the slot's contract as its owning package declares it. */
/* 中文说明：interface SlotDeclaration 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
export interface SlotDeclaration {
  /** SlotMap key, e.g. `settings.section`. */
  key: string
  /** Cardinality literal (`single` / `list` / `keyed` / `chain`), or '' when not a literal. */
  kind: string
  /** Data-scope literal (`root` / `session` / `session-maybe`), or '' when not a literal. */
  scope: string
  /** Type name of the owner-supplied props share, absent when the slot declares none. */
  ownerType?: string
  /** Source text of the `keyProps` member (keyed slots), absent otherwise. */
  keyProps?: string
  /** Source text of the `hookContext` member, absent otherwise. */
  hookContext?: string
  /** Type name of the slot-level inject face, absent when the slot declares none. */
  injectType?: string
  /** The member's JSDoc with container indentation removed, '' when undocumented. */
  jsDoc: string
  /** Workspace package that declares the contract. */
  package: string
  /** Source pointer `packages/…/file.ts:line`. */
  source: string
}

/** One `slots.register({ name, … }, Component)` call site. */
/* 中文说明：interface SlotRegistration 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
export interface SlotRegistration {
  /** Target SlotMap key the entry contributes into. */
  key: string
  /** Workspace package that registers the entry. */
  package: string
  /** Component argument as written (identifier, or a trimmed expression). */
  component: string
  /** `id` literal of a list entry, absent otherwise. */
  id?: string
  /** `key` literal of a keyed entry, absent otherwise. */
  entryKey?: string
  /** SlotMap keys this registration declares as children (they exist while it is mounted). */
  children: string[]
  /** Source pointer `packages/…/file.ts:line`. */
  source: string
}

/** One exported type declaration, retained with its JSDoc for catalog projection. */
/* 中文说明：interface TypeDeclaration 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
export interface TypeDeclaration {
  /** Declared name. */
  name: string
  /** Full declaration text INCLUDING its JSDoc (member docs are the teaching text). */
  text: string
  /** Source pointer `packages/…/file.ts:line`. */
  source: string
}

/** One scanned source file with the artifacts the catalog reads from it. */
/* 中文说明：interface ScannedFile 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
export interface ScannedFile {
  /** Repo-relative, `/`-normalized path. */
  rel: string
  /** Workspace package name that owns the file. */
  package: string
  /** Parsed source file. */
  sf: ts.SourceFile
}

/**
 * Parse every file matching `patterns`, keeping the ones that carry a slot
 * contract merge or a registration call. Files without either are skipped so
 * the scan stays cheap over the whole workspace.
 * @param scanRoot - repository root the patterns resolve against.
 * @param patterns - glob(s) selecting the TypeScript/TSX files to scan.
 * @returns one entry per interesting file, in path order.
 */
/* 中文说明：函数 scanSlotFiles 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function scanSlotFiles(scanRoot: string, patterns: readonly string[]): ScannedFile[] {
  /** 中文说明：变量 out 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const out: ScannedFile[] = []
  /** 中文说明：变量 names 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const names = new Map<string, string>()
  /** 中文说明：变量 rels 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const rels = [...new Set(globSync(patterns as string[], { cwd: scanRoot })
    .map(path => path.split(sep).join('/')))].sort()
  /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
  for (const rel of rels) {
    /** 中文说明：变量 abs 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const abs = resolve(scanRoot, rel)
    /** 中文说明：变量 text 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const text = readFileSync(abs, 'utf8')
    if (!MERGE_HEAD.test(text) && !REGISTER_HEAD.test(text)) continue
    out.push({
      rel,
      package: packageNameOf(scanRoot, rel, names),
      sf: ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true, scriptKindOf(rel)),
    })
  }
  return out
}

/**
 * Index every exported type declaration of the scanned packages, keeping JSDoc.
 * The catalog resolves owner-props and inject-face shapes through this index
 * instead of a type-checker program: the declaration text with its member
 * documentation IS the teaching material a registrant needs.
 * @param scanRoot - repository root the patterns resolve against.
 * @param patterns - glob(s) selecting the TypeScript/TSX files to index.
 * @returns name → declaration, with names declared more than once dropped as ambiguous.
 */
/* 中文说明：函数 indexExportedTypes 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function indexExportedTypes(scanRoot: string, patterns: readonly string[]): Map<string, TypeDeclaration> {
  /** 中文说明：变量 index 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const index = new Map<string, TypeDeclaration>()
  /** 中文说明：变量 ambiguous 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ambiguous = new Set<string>()
  /** 中文说明：变量 rels 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const rels = [...new Set(globSync(patterns as string[], { cwd: scanRoot })
    .map(path => path.split(sep).join('/')))].sort()
  /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
  for (const rel of rels) {
    /** 中文说明：变量 abs 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const abs = resolve(scanRoot, rel)
    /** 中文说明：变量 sf 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sf = ts.createSourceFile(abs, readFileSync(abs, 'utf8'), ts.ScriptTarget.Latest, true, scriptKindOf(rel))
    /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
    for (const statement of sf.statements) {
      if (!ts.isInterfaceDeclaration(statement) && !ts.isTypeAliasDeclaration(statement)) continue
      if (!statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue
      /** 中文说明：变量 name 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const name = statement.name.text
      if (index.has(name)) {
        ambiguous.add(name)
        continue
      }
      index.set(name, {
        name,
        text: declarationText(statement, sf),
        source: `${rel}:${String(lineOf(sf, statement))}`,
      })
    }
  }
  /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
  for (const name of ambiguous) index.delete(name)
  return index
}

/**
 * Read every `SlotMap` member declared in one scanned file.
 * @param file - a file returned by {@link scanSlotFiles}.
 * @returns the declared slots, in source order.
 */
/* 中文说明：函数 slotDeclarations 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function slotDeclarations(file: ScannedFile): SlotDeclaration[] {
  /** 中文说明：变量 out 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const out: SlotDeclaration[] = []
  /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
  for (const body of slotModuleBodies(file.sf)) {
    /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
    for (const statement of body.statements) {
      if (!ts.isInterfaceDeclaration(statement) || statement.name.text !== 'SlotMap') continue
      /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
      for (const member of statement.members) {
        if (!ts.isPropertySignature(member) || member.type === undefined) continue
        /** 中文说明：变量 key 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const key = ts.isStringLiteral(member.name) || ts.isIdentifier(member.name)
          ? member.name.text
          : member.name.getText(file.sf)
        /** 中文说明：变量 entry 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const entry = ts.isTypeLiteralNode(member.type) ? member.type : undefined
        /** 中文说明：变量 ownerType 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const ownerType = memberTypeText(entry, 'owner', file.sf)
        /** 中文说明：变量 keyProps 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const keyProps = memberTypeText(entry, 'keyProps', file.sf)
        /** 中文说明：变量 hookContext 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const hookContext = memberTypeText(entry, 'hookContext', file.sf)
        /** 中文说明：变量 injectType 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const injectType = memberTypeText(entry, 'inject', file.sf)
        out.push({
          key,
          kind: literalMember(entry, 'kind'),
          scope: literalMember(entry, 'scope'),
          ...ownerType === undefined ? {} : { ownerType },
          ...keyProps === undefined ? {} : { keyProps },
          ...hookContext === undefined ? {} : { hookContext },
          ...injectType === undefined ? {} : { injectType },
          jsDoc: jsDocOf(member, file.sf),
          package: file.package,
          source: `${file.rel}:${String(lineOf(file.sf, member))}`,
        })
      }
    }
  }
  return out
}

/**
 * Read every registration call site in one scanned file: which slot it
 * occupies, with which component and cell identity, and which child slots it
 * declares. A call whose `name` is not a string literal is skipped — the
 * shipped composition always names its target literally, and a computed name
 * carries no catalog fact.
 * @param file - a file returned by {@link scanSlotFiles}.
 * @returns the registrations, in source order.
 */
/* 中文说明：函数 slotRegistrations 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function slotRegistrations(file: ScannedFile): SlotRegistration[] {
  /** 中文说明：变量 out 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const out: SlotRegistration[] = []
  /** 中文说明：函数值 visit 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === 'register'
      && isSlotsReceiver(node.expression.expression, file.sf)
      && node.arguments.length >= 1) {
      /** 中文说明：变量 options 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const options = node.arguments[0]
      if (options !== undefined && ts.isObjectLiteralExpression(options)) {
        /** 中文说明：变量 key 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const key = stringProperty(options, 'name')
        if (key !== undefined) {
          /** 中文说明：变量 id 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const id = stringProperty(options, 'id')
          /** 中文说明：变量 entryKey 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const entryKey = stringProperty(options, 'key')
          out.push({
            key,
            package: file.package,
            component: componentText(node.arguments[1], file.sf),
            ...id === undefined ? {} : { id },
            ...entryKey === undefined ? {} : { entryKey },
            children: childKeys(options),
            source: `${file.rel}:${String(lineOf(file.sf, node))}`,
          })
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file.sf)
  return out
}

/**
 * Read one standard-kit interface's members from the scanned files: the props
 * a slot component receives for free from the framework at a given scope.
 * @param files - scanned files to search.
 * @param interfaceName - `GlobalStandardProps`, `SessionStandardProps`, or `SessionMaybeStandardProps`.
 * @returns `member: type` texts in declaration order, merged across declaring files.
 */
/* 中文说明：函数 standardKitMembers 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function standardKitMembers(files: readonly ScannedFile[], interfaceName: string): string[] {
  /** 中文说明：变量 out 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const out: string[] = []
  /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
  for (const file of files) {
    /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
    for (const body of slotModuleBodies(file.sf)) {
      /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
      for (const statement of body.statements) {
        if (!ts.isInterfaceDeclaration(statement) || statement.name.text !== interfaceName) continue
        /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
        for (const member of statement.members) {
          if (!ts.isPropertySignature(member)) continue
          /** 中文说明：变量 type 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const type = member.type === undefined ? 'unknown' : member.type.getText(file.sf)
          out.push(`${member.name.getText(file.sf)}${member.questionToken === undefined ? '' : '?'}: ${collapse(type)}`)
        }
      }
    }
  }
  return out
}

/**
 * Names in the type index that seed texts mention, word-bounded — ONE level, not
 * a transitive closure. The catalog expands an owner-props contract exactly one
 * step: the owner interface carries the interaction protocol in its own member
 * documentation, while the shapes its fields reference belong to the subsystems
 * that own them and would otherwise drag the entire session model into a single
 * slot's report.
 * @param seeds - declaration or signature texts to search.
 * @param index - the type index from {@link indexExportedTypes}.
 * @returns the mentioned names, sorted.
 */
/* 中文说明：函数 referencedTypeNames 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function referencedTypeNames(
  seeds: readonly string[],
  index: ReadonlyMap<string, TypeDeclaration>,
): string[] {
  /** 中文说明：变量 found 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const found: string[] = []
  /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
  for (const name of index.keys()) {
    /** 中文说明：变量 pattern 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pattern = new RegExp(`\\b${name}\\b`)
    if (seeds.some(text => pattern.test(text))) found.push(name)
  }
  return found.sort()
}

/**
 * Resolve declarations by name, dropping names the index does not hold.
 * @param names - type names to resolve.
 * @param index - the type index from {@link indexExportedTypes}.
 * @returns the resolved declarations, sorted by name.
 */
/* 中文说明：函数 declaredTypes 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function declaredTypes(
  names: readonly string[],
  index: ReadonlyMap<string, TypeDeclaration>,
): TypeDeclaration[] {
  return [...names]
    .flatMap(name => index.get(name) ?? [])
    .sort((left, right) => left.name.localeCompare(right.name))
}

/** Every slot-contract module block in one file, in source order. */
/* 中文说明：函数 slotModuleBodies 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function slotModuleBodies(sf: ts.SourceFile): ts.ModuleBlock[] {
  /** 中文说明：变量 bodies 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const bodies: ts.ModuleBlock[] = []
  /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
  for (const statement of sf.statements) {
    if (!ts.isModuleDeclaration(statement) || !ts.isStringLiteral(statement.name)) continue
    if (statement.name.text !== SLOTS_MODULE) continue
    if (statement.body !== undefined && ts.isModuleBlock(statement.body)) bodies.push(statement.body)
  }
  return bodies
}

/**
 * Whether a `X.register(...)` receiver is the slots service. Every other
 * registry in the repo (`ctx.tools`, `ctx.commands`, `ctx.settings`, …) also
 * takes an options object with a `name`, so the receiver is what separates a
 * slot occupancy fact from an unrelated registration.
 */
/* 中文说明：函数 isSlotsReceiver 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function isSlotsReceiver(receiver: ts.Expression, sf: ts.SourceFile): boolean {
  /** 中文说明：变量 text 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const text = receiver.getText(sf)
  return text === 'slots' || text.endsWith('.slots')
}

/** The workspace package name owning a repo-relative file, memoized per package root. */
/* 中文说明：函数 packageNameOf 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function packageNameOf(scanRoot: string, rel: string, cache: Map<string, string>): string {
  /** 中文说明：变量 dir 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let dir = dirname(resolve(scanRoot, rel))
  while (dir.length > scanRoot.length) {
    /** 中文说明：变量 cached 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cached = cache.get(dir)
    if (cached !== undefined) return cached
    try {
      /** 中文说明：变量 manifest 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name?: unknown }
      if (typeof manifest.name === 'string') {
        cache.set(dir, manifest.name)
        return manifest.name
      }
    } catch {
      // No manifest at this level: keep walking up to the owning package root.
    }
    dir = dirname(dir)
  }
  return '(unknown package)'
}

/** TSX must parse as TSX; a `.ts` file with JSX-looking generics must not. */
/* 中文说明：函数 scriptKindOf 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function scriptKindOf(rel: string): ts.ScriptKind {
  return rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
}

/** 1-based line of a node's first character. */
/* 中文说明：函数 lineOf 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
}

/** Declaration text including leading JSDoc, with container indentation removed. */
/* 中文说明：函数 declarationText 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function declarationText(statement: ts.Node, sf: ts.SourceFile): string {
  return dedent(sf.text.slice(statement.getStart(sf, true), statement.getEnd()))
}

/** One member's JSDoc comment text, '' when the member has none. */
/* 中文说明：函数 jsDocOf 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function jsDocOf(member: ts.Node, sf: ts.SourceFile): string {
  // getStart(includeJsDoc) brackets exactly the doc comment: with it the range
  // opens at `/**`, without it at the member itself.
  /** 中文说明：变量 withDoc 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const withDoc = member.getStart(sf, true)
  /** 中文说明：变量 withoutDoc 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const withoutDoc = member.getStart(sf, false)
  if (withDoc >= withoutDoc) return ''
  return dedent(sf.text.slice(withDoc, withoutDoc).trimEnd())
}

/** Strip the shared leading indentation of a multi-line source slice. */
/* 中文说明：函数 dedent 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function dedent(text: string): string {
  /** 中文说明：变量 lines 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const lines = text.split('\n')
  /** 中文说明：函数值 indents 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const indents = lines.slice(1).filter(line => line.trim() !== '')
    .map(line => (/^\s*/.exec(line) as RegExpExecArray)[0].length)
  /** 中文说明：变量 shared 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const shared = indents.length === 0 ? 0 : Math.min(...indents)
  return [lines[0] ?? '', ...lines.slice(1).map(line => line.slice(shared))].join('\n').trimEnd()
}

/** Collapse a type text to one line so catalog rows stay one row. */
/* 中文说明：函数 collapse 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** A type-literal member's string-literal type text, '' when absent or computed. */
/* 中文说明：函数 literalMember 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function literalMember(entry: ts.TypeLiteralNode | undefined, name: string): string {
  /** 中文说明：变量 member 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const member = namedMember(entry, name)
  if (member?.type === undefined) return ''
  return ts.isLiteralTypeNode(member.type) && ts.isStringLiteral(member.type.literal)
    ? member.type.literal.text
    : ''
}

/** A type-literal member's type text on one line, absent when the member is. */
/* 中文说明：函数 memberTypeText 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function memberTypeText(
  entry: ts.TypeLiteralNode | undefined,
  name: string,
  sf: ts.SourceFile,
): string | undefined {
  /** 中文说明：变量 member 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const member = namedMember(entry, name)
  return member?.type === undefined ? undefined : collapse(member.type.getText(sf))
}

/** One named property signature of a type literal. */
/* 中文说明：函数 namedMember 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function namedMember(entry: ts.TypeLiteralNode | undefined, name: string): ts.PropertySignature | undefined {
  if (entry === undefined) return undefined
  /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
  for (const member of entry.members) {
    if (ts.isPropertySignature(member) && memberName(member.name) === name) return member
  }
  return undefined
}

/** A property name's text, quotes removed. */
/* 中文说明：函数 memberName 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function memberName(name: ts.PropertyName): string {
  return ts.isStringLiteral(name) || ts.isIdentifier(name) ? name.text : name.getText()
}

/** One string-literal property of an options object literal. */
/* 中文说明：函数 stringProperty 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function stringProperty(options: ts.ObjectLiteralExpression, name: string): string | undefined {
  /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
  for (const property of options.properties) {
    if (!ts.isPropertyAssignment(property)) continue
    if (memberName(property.name) !== name) continue
    if (ts.isStringLiteral(property.initializer)) return property.initializer.text
  }
  return undefined
}

/** The SlotMap keys a registration's `children` table declares. */
/* 中文说明：函数 childKeys 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function childKeys(options: ts.ObjectLiteralExpression): string[] {
  /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
  for (const property of options.properties) {
    if (!ts.isPropertyAssignment(property)) continue
    if (memberName(property.name) !== 'children') continue
    if (!ts.isObjectLiteralExpression(property.initializer)) return []
    return property.initializer.properties
      .flatMap(child => (child.name === undefined ? [] : [memberName(child.name)]))
  }
  return []
}

/** The component argument as written; a non-identifier expression is collapsed. */
/* 中文说明：函数 componentText 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function componentText(argument: ts.Expression | undefined, sf: ts.SourceFile): string {
  if (argument === undefined) return '(none)'
  /** 中文说明：变量 text 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const text = collapse(argument.getText(sf))
  return text.length > 60 ? `${text.slice(0, 57)}…` : text
}
