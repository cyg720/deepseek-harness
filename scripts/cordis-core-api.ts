/** Generate detailed Cordis core API pages from pinned vendor declarations. */
/*
 * 文件职责：实现 cordis-core-api.ts 覆盖的仓库构建、校验或维护脚本职责。
 * 技术维度：使用 TypeScript、JavaScript、Vitest、Node.js 文件系统或构建工具。
 * 产品维度：通过仓库构建、校验或维护脚本保障项目开发、发布和 Agent 工作区行为一致。
 * 逻辑维度：解析参数和文件，执行检查或转换，再输出结果并处理错误。
 * 关键边界：脚本可能修改构建产物；路径和子进程输出不可信；失败必须以非零状态显式报告。
 * 新手阅读建议：先看命令入口和参数，再读文件遍历或转换，最后关注错误码和平台差异。
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { checkParams, checkReturns, parseJsDoc, parseTags, pointer, rawJsDoc, reportViolations } from './jsdoc.ts'
import { cordisModuleBody } from './cordis-walk.ts'

/** 中文说明：变量 root 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const root = resolve(import.meta.dirname, '..')
/** 中文说明：常量 FENCE 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const FENCE = 'ts cordis-catalog'

/** One declaration group rendered on a Cordis core API page. */
/* 中文说明：type CordisCoreApiSection 定义本模块所需的数据或行为，用于表达仓库构建、校验或维护脚本场景。 */
type CordisCoreApiSection =
  | { kind: 'class'; file: string; symbol: string; prefix?: string; heading?: string }
  | { kind: 'context-merge'; file: string; heading?: string }
  | { kind: 'decl'; file: string; symbol: string }

/** One generated Cordis core API page. */
/* 中文说明：interface CordisCoreApiPage 定义本模块所需的数据或行为，用于表达仓库构建、校验或维护脚本场景。 */
export interface CordisCoreApiPage {
  out: string
  title: string
  intro: string
  sections: CordisCoreApiSection[]
}

/** Explicit editorial grouping for the pinned Cordis core API. */
/* 中文说明：常量 CORDIS_CORE_API_PAGES 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
export const CORDIS_CORE_API_PAGES: CordisCoreApiPage[] = [
  {
    out: 'docs/cordis-api/context.md',
    title: 'Context',
    intro: 'The context is the core Cordis object: every service, event, and lifecycle API is reached through `ctx`. Event methods are documented on [Events](events.md), effects and the current fiber on [Fiber](fiber.md), and plugin loading on [Registry](registry.md).',
    sections: [
      { kind: 'class', file: 'vendor/cordis/src/context.ts', symbol: 'Context', prefix: 'ctx.' },
      { kind: 'context-merge', file: 'vendor/cordis/src/reflect.ts', heading: 'Service store and mixins' },
    ],
  },
  {
    out: 'docs/cordis-api/events.md',
    title: 'Events',
    intro: 'The event-dispatch API mixed into every context. Harness event declarations and their dispatch modes are generated into each owning [subsystem page](../subsystems/core.md).',
    sections: [
      { kind: 'context-merge', file: 'vendor/cordis/src/events.ts' },
      { kind: 'decl', file: 'vendor/cordis/src/events.ts', symbol: 'EventOptions' },
      { kind: 'decl', file: 'vendor/cordis/src/events.ts', symbol: 'DispatchMode' },
    ],
  },
  {
    out: 'docs/cordis-api/fiber.md',
    title: 'Fiber',
    intro: 'A fiber is one loaded plugin instance: its lifecycle state, validated config, and registered effects. `ctx.fiber` is the current fiber, and `ctx.effect()` delegates to it.',
    sections: [
      { kind: 'context-merge', file: 'vendor/cordis/src/fiber.ts' },
      { kind: 'class', file: 'vendor/cordis/src/fiber.ts', symbol: 'Fiber', heading: 'The Fiber class' },
      { kind: 'decl', file: 'vendor/cordis/src/fiber.ts', symbol: 'Effect' },
      { kind: 'decl', file: 'vendor/cordis/src/fiber.ts', symbol: 'Disposable' },
      { kind: 'decl', file: 'vendor/cordis/src/fiber.ts', symbol: 'EffectMeta' },
      { kind: 'decl', file: 'vendor/cordis/src/fiber.ts', symbol: 'CordisError' },
      { kind: 'decl', file: 'vendor/cordis/src/fiber.ts', symbol: 'ValidationError' },
    ],
  },
  {
    out: 'docs/cordis-api/registry.md',
    title: 'Registry',
    intro: 'Plugin loading and dependency injection.',
    sections: [
      { kind: 'context-merge', file: 'vendor/cordis/src/registry.ts' },
      { kind: 'decl', file: 'vendor/cordis/src/registry.ts', symbol: 'Plugin' },
      { kind: 'decl', file: 'vendor/cordis/src/registry.ts', symbol: 'Inject' },
    ],
  },
  {
    out: 'docs/cordis-api/service.md',
    title: 'Service',
    intro: 'The base class for context services. A subclass loaded as a plugin registers itself as `ctx.<name>`.',
    sections: [
      { kind: 'class', file: 'vendor/cordis/src/service.ts', symbol: 'Service' },
    ],
  },
]

/** 中文说明：interface MemberDoc 定义本模块所需的数据或行为，用于表达仓库构建、校验或维护脚本场景。 */
interface MemberDoc {
  name: string
  heading: string
  signatures: string[]
  jsDoc: string
  doc: string
  params: { name: string; text: string }[]
  returns: string | null
  source: string
}

/** 中文说明：interface RenderContext 定义本模块所需的数据或行为，用于表达仓库构建、校验或维护脚本场景。 */
interface RenderContext {
  scanRoot: string
  cache: Map<string, { sf: ts.SourceFile; text: string }>
  violations: string[]
}

/** 中文说明：函数 load 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function load(ctx: RenderContext, rel: string): { sf: ts.SourceFile; text: string } {
  /** 中文说明：变量 cached 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const cached = ctx.cache.get(rel)
  if (cached !== undefined) return cached
  /** 中文说明：变量 text 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const text = readFileSync(resolve(ctx.scanRoot, rel), 'utf8')
  /** 中文说明：变量 entry 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const entry = { sf: ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true), text }
  ctx.cache.set(rel, entry)
  return entry
}

/** 中文说明：函数 sourceJsDoc 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function sourceJsDoc(text: string, sf: ts.SourceFile, node: ts.Node): string {
  /** 中文说明：变量 raw 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const raw = rawJsDoc(text, node)
  if (raw === '') return ''
  const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
  /** 中文说明：变量 lineStart 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const lineStart = sf.getPositionOfLineAndCharacter(line, 0)
  /** 中文说明：变量 indent 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const indent = text.slice(lineStart, node.getStart(sf))
  return raw.split('\n')
    .map((sourceLine, index) => index > 0 && sourceLine.startsWith(indent)
      ? sourceLine.slice(indent.length)
      : sourceLine)
    .join('\n')
}

/** 中文说明：函数 signatureOf 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function signatureOf(member: ts.Node, sf: ts.SourceFile): string {
  /** 中文说明：变量 full 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const full = member.getText(sf)
  /** 中文说明：变量 tail 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const tail = (member as { body?: ts.Node; initializer?: ts.Node }).body
    ?? (member as { initializer?: ts.Node }).initializer
  /** 中文说明：变量 signature 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const signature = tail
    ? full.slice(0, full.length - tail.getText(sf).length).replace(/[=\s]+$/, '')
    : full
  return signature.replace(/\s*;?\s*$/, '').replace(/\s+/g, ' ').trim()
}

/** 中文说明：函数 headingParams 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function headingParams(parameters: readonly ts.ParameterDeclaration[], sf: ts.SourceFile): string {
  /** 中文说明：变量 names 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const names = parameters
    .filter(parameter => !(ts.isIdentifier(parameter.name) && parameter.name.text === 'this'))
    .map((parameter) => {
      /** 中文说明：变量 rest 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const rest = parameter.dotDotDotToken ? '...' : ''
      /** 中文说明：变量 optional 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const optional = parameter.questionToken || parameter.initializer ? '?' : ''
      return `${rest}${parameter.name.getText(sf)}${optional}`
    })
  return `(${names.join(', ')})`
}

/** 中文说明：函数 isPublicInstance 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function isPublicInstance(member: ts.ClassElement): boolean {
  /** 中文说明：变量 modifiers 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const modifiers = ts.getCombinedModifierFlags(member)
  if (modifiers & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected | ts.ModifierFlags.Static)) return false
  if (!member.name || ts.isComputedPropertyName(member.name) || ts.isPrivateIdentifier(member.name)) return false
  return !member.name.getText().startsWith('_')
}

/** 中文说明：函数 isPublicStatic 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function isPublicStatic(member: ts.ClassElement): boolean {
  /** 中文说明：变量 modifiers 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const modifiers = ts.getCombinedModifierFlags(member)
  if (modifiers & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) return false
  if (!(modifiers & ts.ModifierFlags.Static)) return false
  if (!member.name || ts.isComputedPropertyName(member.name) || ts.isPrivateIdentifier(member.name)) return false
  return !member.name.getText().startsWith('_')
}

/** 中文说明：type Member 定义本模块所需的数据或行为，用于表达仓库构建、校验或维护脚本场景。 */
type Member = ts.MethodDeclaration
  | ts.MethodSignature
  | ts.PropertyDeclaration
  | ts.PropertySignature
  | ts.GetAccessorDeclaration

/** 中文说明：函数 memberDoc 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function memberDoc(ctx: RenderContext, where: string, name: string, group: Member[], rel: string): MemberDoc {
  const { sf, text } = load(ctx, rel)
  /** 中文说明：变量 first 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const first = group[0]
  if (first === undefined) throw new Error(`cordis-core-api: empty member group for ${name}.`)
  /** 中文说明：函数值 rawDocs 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const rawDocs = group.map(member => sourceJsDoc(text, sf, member))
  /** 中文说明：函数值 docIndex 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const docIndex = rawDocs.findIndex(raw => parseJsDoc(raw).doc !== '')
  /** 中文说明：变量 raw 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const raw = docIndex === -1 ? '' : (rawDocs[docIndex] ?? '')
  /** 中文说明：变量 doc 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const doc = parseJsDoc(raw).doc
  if (doc === '') ctx.violations.push(`${where} has no JSDoc prose.`)
  const { params: tags, returns } = parseTags(raw)
  /** 中文说明：函数值 functionMembers 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const functionMembers = group.filter((member): member is ts.MethodDeclaration | ts.MethodSignature =>
    ts.isMethodDeclaration(member) || ts.isMethodSignature(member))
  /** 中文说明：变量 docCarrier 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const docCarrier = functionMembers[docIndex === -1 ? 0 : docIndex]
  /** 中文说明：变量 params 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const params: { name: string; text: string }[] = []
  if (docCarrier !== undefined) {
    checkParams(where, 'cordis-core-api', docCarrier.parameters, tags, sf,
      parameter => ts.isIdentifier(parameter.name) && parameter.name.text === 'this', ctx.violations)
    if (docCarrier.type !== undefined) {
      checkReturns(where, docCarrier.type, returns, sf, ctx.violations)
    } else if (returns === null && ts.isMethodDeclaration(docCarrier)) {
      ctx.violations.push(`${where} has no return type annotation; document the result with @returns.`)
    }
    /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
    for (const parameter of docCarrier.parameters) {
      if (!ts.isIdentifier(parameter.name) || parameter.name.text === 'this') continue
      /** 中文说明：变量 text 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const text = tags.get(parameter.name.text)
      if (text !== undefined) params.push({ name: parameter.name.text, text })
    }
  }
  /** 中文说明：变量 headingSource 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const headingSource = docCarrier ?? functionMembers[0]
  /** 中文说明：变量 signatures 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const signatures = ts.isMethodDeclaration(first) && functionMembers.length > 1
    ? functionMembers.filter(member => ts.isMethodDeclaration(member) && member.body === undefined)
    : group
  return {
    name,
    heading: headingSource === undefined ? '' : headingParams(headingSource.parameters, sf),
    signatures: signatures.map(member => signatureOf(member, sf)),
    jsDoc: raw,
    doc,
    params,
    returns,
    source: pointer(rel, sf, first),
  }
}

/** 中文说明：函数 heritageMembers 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function heritageMembers(
  statement: ts.InterfaceDeclaration,
  sf: ts.SourceFile,
  groups: Map<string, (ts.MethodSignature | ts.PropertySignature | ts.MethodDeclaration)[]>,
): void {
  /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
  for (const clause of statement.heritageClauses ?? []) {
    /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
    for (const type of clause.types) {
      if (!ts.isIdentifier(type.expression) || type.expression.text !== 'Pick') continue
      const [target, keys] = type.typeArguments ?? []
      if (target === undefined || keys === undefined || !ts.isTypeReferenceNode(target)) continue
      /** 中文说明：变量 targetName 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const targetName = target.typeName.getText(sf)
      /** 中文说明：变量 cls 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const cls = sf.statements.find(
        (entry): entry is ts.ClassDeclaration => ts.isClassDeclaration(entry) && entry.name?.text === targetName,
      )
      if (cls === undefined) continue
      /** 中文说明：变量 picked 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const picked = new Set<string>()
      /** 中文说明：函数值 collect 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
      const collect = (node: ts.TypeNode): void => {
        if (ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)) picked.add(node.literal.text)
        if (ts.isUnionTypeNode(node)) node.types.forEach(collect)
      }
      collect(keys)
      /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
      for (const member of cls.members) {
        if (!ts.isMethodDeclaration(member)) continue
        /** 中文说明：变量 name 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const name = member.name.getText(sf)
        if (!picked.has(name)) continue
        /** 中文说明：变量 group 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const group = groups.get(name) ?? []
        group.push(member)
        groups.set(name, group)
      }
    }
  }
}

/** 中文说明：函数 contextMergeMembers 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function contextMergeMembers(ctx: RenderContext, rel: string): MemberDoc[] {
  const { sf } = load(ctx, rel)
  /** 中文说明：变量 body 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const body = cordisModuleBody(sf)
  if (body === null) throw new Error(`cordis-core-api: ${rel} has no Context module merge.`)
  /** 中文说明：变量 groups 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const groups = new Map<string, (ts.MethodSignature | ts.PropertySignature | ts.MethodDeclaration)[]>()
  /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
  for (const statement of body.statements) {
    if (!ts.isInterfaceDeclaration(statement) || statement.name.text !== 'Context') continue
    heritageMembers(statement, sf, groups)
    /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
    for (const member of statement.members) {
      if (!ts.isMethodSignature(member) && !ts.isPropertySignature(member)) continue
      if (ts.isComputedPropertyName(member.name)) continue
      /** 中文说明：变量 name 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const name = member.name.getText(sf)
      /** 中文说明：变量 group 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const group = groups.get(name) ?? []
      group.push(member)
      groups.set(name, group)
    }
  }
  return [...groups.entries()].map(([name, group]) =>
    memberDoc(ctx, `ctx.${name} (${rel})`, name, group, rel))
}

/** 中文说明：函数 classMembers 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function classMembers(ctx: RenderContext, rel: string, className: string): {
  doc: string
  instance: MemberDoc[]
  statics: MemberDoc[]
  source: string
} {
  const { sf, text } = load(ctx, rel)
  /** 中文说明：变量 cls 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const cls = sf.statements.find(
    (statement): statement is ts.ClassDeclaration =>
      ts.isClassDeclaration(statement) && statement.name?.text === className,
  )
  if (cls === undefined) throw new Error(`cordis-core-api: class ${className} not found in ${rel}.`)
  /** 中文说明：变量 doc 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const doc = parseJsDoc(rawJsDoc(text, cls)).doc
  if (doc === '') ctx.violations.push(`class ${className} (${pointer(rel, sf, cls)}) has no JSDoc.`)
  /** 中文说明：变量 instance 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const instance = new Map<string, Member[]>()
  /** 中文说明：变量 statics 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const statics = new Map<string, Member[]>()
  /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
  for (const member of cls.members) {
    if (!ts.isMethodDeclaration(member) && !ts.isPropertyDeclaration(member) && !ts.isGetAccessorDeclaration(member)) continue
    /** 中文说明：变量 name 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const name = member.name.getText(sf)
    if (isPublicInstance(member)) {
      /** 中文说明：变量 group 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const group = instance.get(name) ?? []
      group.push(member)
      instance.set(name, group)
    } else if (isPublicStatic(member) && !ts.isGetAccessorDeclaration(member)) {
      /** 中文说明：变量 group 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const group = statics.get(name) ?? []
      group.push(member)
      statics.set(name, group)
    }
  }
  /** 中文说明：变量 declaration 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const declaration = sf.statements.find(
    (statement): statement is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(statement) && statement.name.text === className,
  )
  /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
  for (const member of declaration?.members ?? []) {
    if (!ts.isPropertySignature(member) || ts.isComputedPropertyName(member.name)) continue
    /** 中文说明：变量 name 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const name = member.name.getText(sf)
    /** 中文说明：变量 group 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const group = instance.get(name) ?? []
    group.push(member)
    instance.set(name, group)
  }
  /** 中文说明：函数值 render 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const render = (groups: Map<string, Member[]>, prefix: string): MemberDoc[] =>
    [...groups.entries()].map(([name, group]) => memberDoc(ctx, `${prefix}${name} (${rel})`, name, group, rel))
  return {
    doc,
    instance: render(instance, `${className}#`),
    statics: render(statics, `${className}.`),
    source: pointer(rel, sf, cls),
  }
}

/** 中文说明：函数 stripBodies 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function stripBodies(node: ts.Node, sf: ts.SourceFile): string {
  /** 中文说明：变量 cuts 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const cuts: { start: number; end: number }[] = []
  /** 中文说明：函数值 visit 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const visit = (entry: ts.Node): void => {
    /** 中文说明：变量 functionLike 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const functionLike = ts.isMethodDeclaration(entry)
      || ts.isConstructorDeclaration(entry)
      || ts.isFunctionDeclaration(entry)
      || ts.isGetAccessorDeclaration(entry)
      || ts.isSetAccessorDeclaration(entry)
    if (functionLike && entry.body !== undefined) {
      /** 中文说明：变量 signatureEnd 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const signatureEnd = (entry.type ?? entry.parameters.at(-1) ?? entry).getEnd()
      cuts.push({ start: signatureEnd, end: entry.body.getEnd() })
      return
    }
    entry.forEachChild(visit)
  }
  visit(node)
  /** 中文说明：变量 base 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const base = node.getStart(sf)
  /** 中文说明：变量 output 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let output = node.getText(sf)
  /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
  for (const cut of cuts.sort((left, right) => right.start - left.start)) {
    /** 中文说明：变量 head 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const head = output.slice(0, cut.start - base)
    /** 中文说明：变量 between 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const between = output.slice(cut.start - base, cut.end - base)
    /** 中文说明：变量 bodyBrace 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bodyBrace = between.indexOf('{')
    output = head + between.slice(0, bodyBrace).trimEnd() + output.slice(cut.end - base)
  }
  return output
}

/** 中文说明：函数 declarationPaste 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function declarationPaste(ctx: RenderContext, rel: string, symbol: string): { doc: string; code: string; source: string } {
  const { sf, text } = load(ctx, rel)
  /** 中文说明：函数值 matches 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const matches = sf.statements.filter((statement) => {
    /** 中文说明：变量 named 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const named = ts.isInterfaceDeclaration(statement)
      || ts.isTypeAliasDeclaration(statement)
      || ts.isClassDeclaration(statement)
      || ts.isEnumDeclaration(statement)
      || ts.isModuleDeclaration(statement)
    return named && statement.name?.getText(sf) === symbol
  })
  /** 中文说明：变量 first 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const first = matches[0]
  if (first === undefined) throw new Error(`cordis-core-api: declaration ${symbol} not found in ${rel}.`)
  /** 中文说明：变量 doc 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const doc = parseJsDoc(sourceJsDoc(text, sf, first)).doc
  /** 中文说明：函数值 code 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const code = matches.map((statement) => {
    /** 中文说明：变量 jsDoc 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const jsDoc = sourceJsDoc(text, sf, statement)
    /** 中文说明：变量 declaration 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const declaration = stripBodies(statement, sf).replace(/^export\s+(default\s+)?/, '')
    return jsDoc === '' ? declaration : `${jsDoc}\n${declaration}`
  }).join('\n\n')
  return { doc, code, source: pointer(rel, sf, first) }
}

/** 中文说明：函数 sourceLink 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function sourceLink(source: string): string {
  const [file, line] = source.split(':')
  return `[Source](../../${file}${line === undefined ? '' : `#L${line}`})`
}

/** 中文说明：函数 unlink 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function unlink(text: string): string {
  return text.replace(/\{@link\s+([^}|\s]+)\s*(?:[|\s]\s*([^}]*))?\}/g, (_match, target: string, label?: string) => {
    /** 中文说明：变量 name 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const name = label?.trim()
    return name && name !== '' ? name : `\`${target}\``
  })
}

/** 中文说明：函数 prose 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function prose(doc: string): string[] {
  /** 中文说明：变量 paragraphs 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const paragraphs = unlink(doc)
    .split(/\n\s*\n/)
    .map(paragraph => paragraph.replace(/\s*\n\s*/g, ' ').trim())
    .filter(paragraph => paragraph !== '')
  return paragraphs.flatMap((paragraph, index) => index === 0 ? [paragraph] : ['', paragraph])
}

/** 中文说明：函数 renderMember 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function renderMember(prefix: string, member: MemberDoc): string[] {
  /** 中文说明：变量 lines 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const lines = [`### ${prefix}${member.name}${member.heading}`, '', `\`\`\`${FENCE}`]
  if (member.jsDoc !== '') lines.push(member.jsDoc)
  lines.push(...member.signatures, '```', '')
  if (member.doc !== '') lines.push(...prose(member.doc), '')
  /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
  for (const parameter of member.params) lines.push(`- \`${parameter.name}\` — ${unlink(parameter.text)}`)
  if (member.params.length > 0) lines.push('')
  if (member.returns !== null && member.returns !== '') lines.push(`**Returns** ${unlink(member.returns)}`, '')
  lines.push(sourceLink(member.source), '')
  return lines
}

/** Render one detailed Cordis core API page and reject undocumented members. */
/* 中文说明：函数 renderCordisCoreApiPage 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export function renderCordisCoreApiPage(
  page: CordisCoreApiPage,
  scanRoot: string = root,
): string {
  /** 中文说明：变量 ctx 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx: RenderContext = { scanRoot, cache: new Map(), violations: [] }
  /** 中文说明：变量 lines 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const lines = [
    '<!-- Generated by scripts/gen-cordis-catalog.ts — do not edit by hand.',
    '     Run `pnpm run gen-cordis-catalog` to regenerate. -->',
    '',
    `# ${page.title}`,
    '',
    page.intro,
    '',
  ]
  /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
  for (const section of page.sections) {
    if (section.kind !== 'decl' && section.heading !== undefined) lines.push(`## ${section.heading}`, '')
    if (section.kind === 'context-merge') {
      /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
      for (const member of contextMergeMembers(ctx, section.file)) lines.push(...renderMember('ctx.', member))
    } else if (section.kind === 'class') {
      /** 中文说明：变量 cls 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const cls = classMembers(ctx, section.file, section.symbol)
      if (cls.doc !== '') lines.push(...prose(cls.doc), '')
      lines.push(sourceLink(cls.source), '')
      /** 中文说明：变量 prefix 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const prefix = section.prefix ?? `${section.symbol.toLowerCase()}.`
      /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
      for (const member of cls.instance) lines.push(...renderMember(prefix, member))
      if (cls.statics.length > 0) {
        lines.push('## Static members', '')
        /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
        for (const member of cls.statics) lines.push(...renderMember(`${section.symbol}.`, member))
      }
    } else {
      /** 中文说明：变量 declaration 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const declaration = declarationPaste(ctx, section.file, section.symbol)
      lines.push(`## ${section.symbol}`, '')
      if (declaration.doc !== '') lines.push(...prose(declaration.doc), '')
      lines.push(`\`\`\`${FENCE}`, declaration.code, '```', '', sourceLink(declaration.source), '')
    }
  }
  reportViolations('gen-cordis-catalog', ctx.violations)
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`
}

/** Render every detailed Cordis core API page. */
/* 中文说明：函数 renderCordisCoreApiPages 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export function renderCordisCoreApiPages(scanRoot: string = root): Map<string, string> {
  return new Map(CORDIS_CORE_API_PAGES.map(page => [page.out, renderCordisCoreApiPage(page, scanRoot)]))
}
