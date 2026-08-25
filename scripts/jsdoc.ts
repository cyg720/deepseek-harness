/**
 * Shared JSDoc parsing and completeness checks for the Cordis, persistence,
 * and config catalogs and the exported-API gate.
 */
/**
 * 文件职责：实现 jsdoc.ts 覆盖的仓库生成、校验或维护职责。
 * 技术维度：使用 TypeScript、JavaScript、Vitest、Node.js 文件系统、AST 或项目图分析。
 * 产品维度：保障源码、生成目录、文档和发布元数据在开发与 CI 中保持一致。
 * 逻辑维度：读取仓库输入，构建中间模型，执行生成或校验，再报告差异和失败。
 * 关键边界：生成结果必须确定；路径与源码文本不可信；校验失败必须以非零状态显式报告。
 * 新手阅读建议：先看命令入口和输入目录，再读模型转换，最后关注输出文件与失败条件。
 */

import ts from 'typescript'

/** Repo-relative source pointer `file:line` for a node's first character. */
/** 中文说明：函数 pointer 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function pointer(rel: string, sf: ts.SourceFile, node: ts.Node): string {
  const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
  return `${rel}:${line + 1}`
}

/** The raw `/** … *​/` JSDoc block immediately preceding a node, or '' if none. */
/** 中文说明：函数 rawJsDoc 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function rawJsDoc(text: string, node: ts.Node): string {
  /** 中文说明：变量 ranges 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ranges = ts.getLeadingCommentRanges(text, node.getFullStart()) ?? []
  /** 中文说明：函数值 jsdoc 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const jsdoc = ranges.filter(r => text.slice(r.pos, r.pos + 3) === '/**').at(-1)
  return jsdoc ? text.slice(jsdoc.pos, jsdoc.end) : ''
}

/** A dispatch mode, rendered as the badge after an event name in the catalog. */
/** 中文说明：type Mode 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
export type Mode = 'emit' | 'waterfall' | 'parallel' | 'serial' | 'bail'

/**
 * Parse a raw JSDoc block into description prose and an optional `@mode`. Prose
 * ends at the first block tag, paragraphs collapse to one line, bullet items
 * remain separate lines, and `{@link X}` renders as `X`.
 * @param raw - the raw comment text including the JSDoc delimiters.
 * @returns the collapsed description prose, parsed valid `@mode` (or null),
 *   and whether any `@mode` tag was present.
 */
/** 中文说明：函数 parseJsDoc 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function parseJsDoc(raw: string): { doc: string; mode: Mode | null; hasMode: boolean } {
  /** 中文说明：变量 inner 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const inner = raw
    .replace(/^\/\*\*/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map(l => l.replace(/^\s*\*?\s?/, '').replace(/\s+$/, ''))
  /** 中文说明：变量 mode 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let mode: Mode | null = null
  /** 中文说明：变量 hasMode 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let hasMode = false
  /** 中文说明：变量 inTags 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let inTags = false
  /** 中文说明：变量 blocks 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const blocks: string[] = []
  /** 中文说明：变量 para 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let para: string[] = []
  /** 中文说明：变量 list 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let list: string[] = []
  /** 中文说明：变量 item 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let item: string[] = []
  /** 中文说明：函数值 join 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const join = (parts: string[]): string => parts.join(' ').replace(/\s+/g, ' ').trim()
  /** 中文说明：函数值 flushItem 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const flushItem = (): void => {
    if (item.length) list.push(join(item))
    item = []
  }
  /** 中文说明：函数值 flushList 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const flushList = (): void => {
    flushItem()
    if (list.length) blocks.push(list.join('\n')) // one block, items on own lines
    list = []
  }
  /** 中文说明：函数值 flushPara 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const flushPara = (): void => {
    flushList()
    if (para.length) blocks.push(join(para))
    para = []
  }
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const line of inner) {
    /** 中文说明：变量 tagLine 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const tagLine = line.trimStart()
    /** 中文说明：变量 m 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const m = /^@mode\s+(emit|waterfall|parallel|serial|bail)\s*$/.exec(tagLine)
    if (m) { mode = m[1] as Mode; hasMode = true; flushPara(); inTags = true; continue }
    if (/^@mode\b/.test(tagLine)) { hasMode = true; flushPara(); inTags = true; continue }
    if (tagLine.startsWith('@')) { flushPara(); inTags = true; continue }
    if (inTags) continue // block-tag territory: continuations are never prose
    if (line.trim() === '') { flushPara(); continue }
    if (/^-\s+/.test(line)) {
      // A list item starts: a pending paragraph (e.g. an intro line directly
      // above the list, no blank between) flushes FIRST so it renders above.
      flushItem()
      if (para.length) { blocks.push(join(para)); para = [] }
      item.push(line)
      continue
    }
    if (item.length) { item.push(line); continue } // continuation of current item
    para.push(line)
  }
  flushPara()
  /** 中文说明：变量 doc 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const doc = blocks.join('\n\n').replace(/\{@link\s+([^}]+)\}/g, '$1').trim()
  return { doc, mode, hasMode }
}

/**
 * Parse `@param` and `@returns` descriptions, including continuation lines.
 * Parameter separators are optional and `[optional]` names unwrap.
 * @param raw - the raw comment text including the JSDoc delimiters.
 * @returns the `@param` name→description map plus the `@returns` description
 * (null when the tag is absent, '' when present but empty).
 */
/** 中文说明：函数 parseTags 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function parseTags(raw: string): { params: Map<string, string>; returns: string | null } {
  /** 中文说明：变量 inner 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const inner = raw
    .replace(/^\/\*\*/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map(l => l.replace(/^\s*\*?\s?/, '').replace(/\s+$/, ''))
  /** 中文说明：变量 params 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const params = new Map<string, string>()
  /** 中文说明：变量 returns 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let returns: string | null = null
  /** 中文说明：函数值 sink 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  let sink: ((text: string) => void) | null = null
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const line of inner) {
    /** 中文说明：变量 param 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const param = /^@param\s+(\[?[\w$]+\]?)\s*(?:[-—–]\s*)?(.*)$/.exec(line)
    if (param) {
      /** 中文说明：变量 name 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const name = (param[1] ?? '').replace(/^\[|\]$/g, '')
      /** 中文说明：变量 acc 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      let acc = param[2] ?? ''
      params.set(name, acc)
      sink = (t) => { acc = acc ? `${acc} ${t}` : t; params.set(name, acc) }
      continue
    }
    /** 中文说明：变量 ret 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ret = /^@returns?(?:\s+[-—–]?\s*(.*))?$/.exec(line)
    if (ret) {
      /** 中文说明：变量 acc 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      let acc = ret[1] ?? ''
      returns = acc
      sink = (t) => { acc = acc ? `${acc} ${t}` : t; returns = acc }
      continue
    }
    if (line.startsWith('@') || line.trim() === '') { sink = null; continue }
    sink?.(line.trim())
  }
  return { params, returns }
}

/**
 * Require a non-empty tag for each non-exempt identifier parameter, reject
 * binding-pattern parameters, and reject stale tags. Exempt parameters may
 * still be documented.
 * @param where - the offender label violations open with, e.g. `event 'x' (file:1)`.
 * @param apiKind - API kind used in binding-pattern diagnostics.
 * @param parameters - the declaration's parameter list.
 * @param tags - the parsed `@param` name→description map from parseTags.
 * @param sf - source file used to render binding patterns.
 * @param isExempt - parameters whose tag is optional, such as `this` or waterfall `next`.
 * @param violations - the aggregate list violations append to.
 */
/** 中文说明：函数 checkParams 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function checkParams(
  where: string,
  apiKind: string,
  parameters: readonly ts.ParameterDeclaration[],
  tags: Map<string, string>,
  sf: ts.SourceFile,
  isExempt: (p: ts.ParameterDeclaration) => boolean,
  violations: string[],
): void {
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const p of parameters) {
    if (!ts.isIdentifier(p.name)) {
      violations.push(`${where}: parameter '${p.name.getText(sf)}' is a binding pattern; the ${apiKind} API needs simple identifier parameters so @param can name them.`)
      continue
    }
    if (isExempt(p)) continue
    /** 中文说明：变量 desc 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const desc = tags.get(p.name.text)
    if (desc === undefined) violations.push(`${where} is missing @param ${p.name.text}.`)
    else if (!desc.trim()) violations.push(`${where}: @param ${p.name.text} has an empty description.`)
  }
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const tag of tags.keys()) {
    if (!parameters.some(p => ts.isIdentifier(p.name) && p.name.text === tag)) {
      violations.push(`${where}: @param ${tag} does not match any parameter (stale tag?).`)
    }
  }
}

/**
 * Check the `@returns` half of the completeness contract: a non-`void` / `Promise<void>`
 * return needs a non-empty `@returns`, and the return type must be ANNOTATED — a pure-AST
 * walk cannot classify an inferred return. Void returns may still carry an
 * optional tag, for example to document resolution timing.
 * @param where - the offender label violations open with.
 * @param typeNode - the declared return type annotation, or undefined when inferred.
 * @param returns - the parsed `@returns` description from parseTags (null when absent).
 * @param sf - the source file (for rendering the annotation's text).
 * @param violations - the aggregate list violations append to.
 */
/** 中文说明：函数 checkReturns 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function checkReturns(
  where: string,
  typeNode: ts.TypeNode | undefined,
  returns: string | null,
  sf: ts.SourceFile,
  violations: string[],
): void {
  if (typeNode === undefined) {
    violations.push(`${where} has no return type annotation; annotate it explicitly so the gate can classify the result.`)
    return
  }
  /** 中文说明：变量 rt 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const rt = typeNode.getText(sf).replace(/\s+/g, ' ')
  if (/^(void|Promise<void>)$/.test(rt)) return
  if (returns === null) violations.push(`${where} is missing @returns (return type: ${rt}).`)
  else if (!returns.trim()) violations.push(`${where}: @returns has an empty description.`)
}

/**
 * Throw one aggregate error for every completeness violation a walk collected.
 * Aggregation (vs failing fast) is deliberate: a remediation pass sees the
 * whole list at once instead of replaying the gate once per offender.
 * @param gate - the reporting gate's name, prefixed to the error message.
 * @param violations - the collected violation lines; no-op when empty.
 */
/** 中文说明：函数 reportViolations 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function reportViolations(gate: string, violations: string[]): void {
  if (violations.length === 0) return
  throw new Error(
    `${gate}: ${violations.length} JSDoc completeness violation(s) (see AGENTS.md):\n`
    + violations.map(v => `  ${v}`).join('\n'),
  )
}
