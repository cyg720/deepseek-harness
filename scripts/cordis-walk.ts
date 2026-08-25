/**
 * AST helpers shared by the Cordis generators: locate the Cordis module merge
 * in a source file and enumerate the `interface Context` keys it declares.
 * The vendored core API projector consumes the merge body; the per-subsystem
 * region generator's exhaustiveness backstop consumes the key scan.
 */
/*
 * 文件职责：实现 cordis-walk.ts 覆盖的仓库构建、校验或维护脚本职责。
 * 技术维度：使用 TypeScript、JavaScript、Vitest、Node.js 文件系统或构建工具。
 * 产品维度：通过仓库构建、校验或维护脚本保障项目开发、发布和 Agent 工作区行为一致。
 * 逻辑维度：解析参数和文件，执行检查或转换，再输出结果并处理错误。
 * 关键边界：脚本可能修改构建产物；路径和子进程输出不可信；失败必须以非零状态显式报告。
 * 新手阅读建议：先看命令入口和参数，再读文件遍历或转换，最后关注错误码和平台差异。
 */

import { globSync, readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import ts from 'typescript'

/** Cheap textual prefilter for a cordis module merge, quote-style agnostic
 * (the AST match below reads `stmt.name.text` and never sees the quotes). */
/* 中文说明：常量 MERGE_HEAD 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const MERGE_HEAD = /declare module ['"](?:@deepseek-ai\/cordis|\.\/context\.ts)['"]/

/**
 * Parse every file matching `patterns` (repo-relative, sorted, `/`-normalized)
 * that textually contains a cordis module merge, yielding one entry per merge
 * BLOCK — a file may legally hold several `declare module '@deepseek-ai/cordis'` blocks
 * (the Typert analyzer reads them all), so the exhaustiveness scan must too.
 * Files without a merge are skipped.
 * @param scanRoot - Repository root the patterns are resolved against.
 * @param patterns - Glob(s) selecting the TypeScript files to scan.
 * @returns One entry per cordis module block, in path then source order.
 */
/* 中文说明：函数 contextMergeFiles 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export function contextMergeFiles(
  scanRoot: string,
  patterns: string | readonly string[],
): { rel: string; sf: ts.SourceFile; text: string; body: ts.ModuleBlock }[] {
  /** 中文说明：变量 out 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const out: { rel: string; sf: ts.SourceFile; text: string; body: ts.ModuleBlock }[] = []
  /** 中文说明：函数值 rels 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const rels = [...new Set(globSync(patterns as string | string[], { cwd: scanRoot }).map(s => s.split(sep).join('/')))].sort()
  /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
  for (const rel of rels) {
    /** 中文说明：变量 abs 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const abs = resolve(scanRoot, rel)
    /** 中文说明：变量 text 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const text = readFileSync(abs, 'utf8')
    if (!MERGE_HEAD.test(text)) continue
    /** 中文说明：变量 sf 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sf = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true)
    /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
    for (const body of cordisModuleBodies(sf)) out.push({ rel, sf, text, body })
  }
  return out
}

/** Every cordis module-merge body in `sf`: `declare module '@deepseek-ai/cordis'` (harness
 * packages) or `declare module './context.ts'` (vendor core), in source order.
 * Module-local: consumers walk blocks through {@link contextMergeFiles}. */
/* 中文说明：函数 cordisModuleBodies 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function cordisModuleBodies(sf: ts.SourceFile): ts.ModuleBlock[] {
  /** 中文说明：变量 bodies 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const bodies: ts.ModuleBlock[] = []
  /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
  for (const stmt of sf.statements) {
    if (!ts.isModuleDeclaration(stmt) || !ts.isStringLiteral(stmt.name)) continue
    if (stmt.name.text !== '@deepseek-ai/cordis' && stmt.name.text !== './context.ts') continue
    if (stmt.body && ts.isModuleBlock(stmt.body)) bodies.push(stmt.body)
  }
  return bodies
}

/** The FIRST cordis module-merge body in `sf`, or null without one — for the
 * vendor core-API renderer whose input files carry exactly one merge; the
 * exhaustiveness scan uses {@link cordisModuleBodies} to read them all. */
/* 中文说明：函数 cordisModuleBody 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export function cordisModuleBody(sf: ts.SourceFile): ts.ModuleBlock | null {
  return cordisModuleBodies(sf)[0] ?? null
}

/**
 * Every `key: Type` property a `declare module '@deepseek-ai/cordis'` Context merge
 * declares in one module body.
 * @param body - The cordis module augmentation block.
 * @param sf - Owning source file (for text extraction).
 * @returns key → declared type-name text, in declaration order.
 */
/* 中文说明：函数 contextKeyMap 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export function contextKeyMap(body: ts.ModuleBlock, sf: ts.SourceFile): Map<string, string> {
  /** 中文说明：变量 keyToType 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const keyToType = new Map<string, string>()
  /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
  for (const stmt of body.statements) {
    if (!ts.isInterfaceDeclaration(stmt) || stmt.name.text !== 'Context') continue
    /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
    for (const member of stmt.members) {
      if (!ts.isPropertySignature(member) || !member.type) continue
      keyToType.set(member.name.getText(sf), member.type.getText(sf))
    }
  }
  return keyToType
}

/**
 * Every event name a `declare module '@deepseek-ai/cordis'` Events merge declares in one
 * module body. Names are the literal member keys (`'agent/created'`), read
 * from method and property members alike so a declaration form the projector
 * would reject still enters the exhaustiveness scan.
 * @param body - The cordis module augmentation block.
 * @param sf - Owning source file (for computed-name text extraction).
 * @returns Declared event names, in declaration order.
 */
/* 中文说明：函数 eventNameList 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export function eventNameList(body: ts.ModuleBlock, sf: ts.SourceFile): string[] {
  /** 中文说明：变量 names 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const names: string[] = []
  /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
  for (const stmt of body.statements) {
    if (!ts.isInterfaceDeclaration(stmt) || stmt.name.text !== 'Events') continue
    /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
    for (const member of stmt.members) {
      if (!member.name) continue
      names.push(ts.isStringLiteral(member.name) || ts.isIdentifier(member.name)
        ? member.name.text
        : member.name.getText(sf))
    }
  }
  return names
}
