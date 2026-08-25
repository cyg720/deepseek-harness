/**
 * Gate for the invariant `FALLBACK_LOCALE` rests on: every shipped dictionary
 * declares the same keys in `zh` and `en`.
 *
 * The locale runtime resolves a key through the active locale, then through
 * the single fallback locale (`en`), then surfaces the key itself. With
 * symmetric dictionaries that middle step always resolves, so one constant can
 * serve as both the opening locale and the dictionary fallback. A key added to
 * only one side breaks that: a reader of the other language sees a bare key
 * such as `list.aria` instead of text. This gate fails on the asymmetry rather
 * than waiting for the bare key to reach a UI.
 *
 * Discovery is deliberately broad, because a gate that silently narrows is
 * worse than no gate. It sweeps every workspace package (not just
 * `packages/client`), reads dictionaries wherever they are declared —
 * `locales.ts`, a `locales/` directory, or inline in the plugin body — and
 * pairs `zh`/`en` across sibling files as well as within one module. A `zh`
 * dictionary whose `en` counterpart cannot be found anywhere is an error, not
 * a skip.
 */
/**
 * 文件职责：验证 locale-dictionary-parity.spec.ts 覆盖的仓库生成、校验或维护职责。
 * 技术维度：使用 TypeScript、JavaScript、Vitest、Node.js 文件系统、AST 或项目图分析。
 * 产品维度：保障源码、生成目录、文档和发布元数据在开发与 CI 中保持一致。
 * 逻辑维度：读取仓库输入，构建中间模型，执行生成或校验，再报告差异和失败。
 * 关键边界：生成结果必须确定；路径与源码文本不可信；校验失败必须以非零状态显式报告。
 * 新手阅读建议：先看命令入口和输入目录，再读模型转换，最后关注输出文件与失败条件。
 */

import type { Dirent } from 'node:fs'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const root = fileURLToPath(new URL('..', import.meta.url))

/** Repo-relative path with `/` separators, so messages and suffix tests match on every OS. */
/** 中文说明：函数 relative 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function relative(file: string): string {
  return file.slice(root.length).replaceAll('\\', '/')
}

/** Every `.ts` source file under each workspace package's `src`, excluding declarations. */
/** 中文说明：函数 sourceFiles 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function sourceFiles(): string[] {
  /** 中文说明：变量 files 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const files: string[] = []
  /** 中文说明：变量 packagesRoot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const packagesRoot = resolve(root, 'packages')
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const group of directories(packagesRoot)) {
    /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
    for (const pkg of directories(resolve(packagesRoot, group))) {
      walk(resolve(packagesRoot, group, pkg, 'src'), files)
    }
  }
  return files.sort()
}

/** Immediate subdirectory names, or none when the path is not a directory. */
/** 中文说明：函数 directories 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function directories(dir: string): string[] {
  return readEntries(dir).filter(entry => entry.isDirectory()).map(entry => entry.name)
}

/**
 * Directory entries, treating only a genuinely absent directory as empty.
 * Any other failure (`EACCES`, I/O) rethrows: silently reading it as "absent"
 * would narrow the sweep and let the gate pass while checking less.
 * @param dir - absolute directory path.
 * @returns entries, or none when the directory does not exist.
 */
/** 中文说明：函数 readEntries 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function readEntries(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

/** 中文说明：函数 walk 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function walk(dir: string, out: string[]): void {
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const entry of readEntries(dir)) {
    /** 中文说明：变量 full 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const full = resolve(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) out.push(full)
  }
}

/** One discovered dictionary: which file and export name declared it. */
/** 中文说明：interface Dictionary 定义本测试所需的数据或行为，用于表达仓库脚本场景。 */
interface Dictionary {
  /** Repo-relative declaring file. */
  file: string
  /** Export name, or the registration site for an inline literal. */
  name: string
  /** Declared keys, sorted. */
  keys: string[]
}

/**
 * Keys of every top-level `export const <name> = { ... }` object literal whose
 * name identifies a locale dictionary, plus inline `register(ns, locale, {...})`
 * literals. Read from the AST so the gate never executes package code.
 * @param file - absolute path of a candidate module.
 * @returns discovered dictionaries, keyed by locale-bearing name.
 */
/** 中文说明：函数 dictionariesIn 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function dictionariesIn(file: string): Dictionary[] {
  /** 中文说明：变量 text 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const text = readFileSync(file, 'utf8')
  // Cheap pre-filter: parsing every package source is wasteful. The pattern
  // must admit every shape `localeOf` accepts, or a file would be skipped
  // before parsing — the silent narrowing this gate exists to prevent. A bare
  // `\b(zh|en)\b` misses `zhSettings`/`accessZh`, because `\b` does not hold
  // between `h` and an uppercase letter.
  if (!/\b(zh|en)\b|\b(zh|en)[A-Z]|(Zh|En)\b/.test(text)) return []
  /** 中文说明：变量 source 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true)
  /** 中文说明：变量 found 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const found: Dictionary[] = []
  /** 中文说明：变量 rel 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const rel = relative(file)

  // Module-scope variable declarations, keyed by name. A 3-arg
  // `register(NS, 'zh'|'en', dict)` whose third argument is an identifier —
  // e.g. a local dictionary variable rather than an inline literal — resolves
  // through here so the gate still verifies its symmetry.
  /** 中文说明：变量 moduleConsts 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const moduleConsts = new Map<string, ts.Expression>()
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue
    /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
    for (const decl of statement.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.initializer !== undefined) {
        moduleConsts.set(decl.name.text, decl.initializer)
      }
    }
  }

  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue
    if (statement.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) !== true) continue
    /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
    for (const decl of statement.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name)) continue
      /** 中文说明：变量 literal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const literal = unwrap(decl.initializer)
      if (literal === undefined || !ts.isObjectLiteralExpression(literal)) continue
      if (localeOf(decl.name.text) === undefined) continue
      found.push({ file: rel, name: decl.name.text, keys: keysOf(literal) })
    }
  }

  // A 3-arg `register(ns, 'zh'|'en', dict)` call whose dictionary argument we
  // cannot turn into an object literal. We refuse instead of skipping: a
  // registration we cannot measure is exactly the silent narrowing this gate
  // exists to catch.
  /** 中文说明：函数值 refuse 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  const refuse = (ns: string, tag: string, why: string): never => {
    throw new Error(`cannot verify register('${ns}', '${tag}', ...) in ${rel}: ${why}`)
  }

  // Inline registrations, two shapes. A `[['zh', {...}], ['en', {...}]]` pair
  // handed to a registration loop keys off the enclosing array; separate
  // `register(NS, 'zh', {...})` / `register(NS, 'en', {...})` calls key off the
  // namespace argument, so the two calls pair with each other.
  /** 中文说明：函数值 visit 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      /** 中文说明：变量 callee 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const callee = node.expression
      /** 中文说明：变量 name 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const name = ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : ts.isIdentifier(callee) && callee.text === 'register' ? 'register' : undefined
      if (name === 'register' && node.arguments.length >= 3) {
        const [ns, tag, dict] = node.arguments
        if (ns === undefined || tag === undefined || !ts.isStringLiteral(tag)) return
        if (tag.text !== 'zh' && tag.text !== 'en') return
        /** 中文说明：变量 raw 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const raw = unwrap(dict)
        /** 中文说明：变量 literal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const literal = raw !== undefined && ts.isIdentifier(raw)
          ? (() => {
            /** 中文说明：变量 resolved 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
            const resolved = moduleConsts.get(raw.text)
            return resolved === undefined ? undefined : unwrap(resolved)
          })()
          : raw
        /** 中文说明：变量 why 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const why = raw !== undefined && ts.isIdentifier(raw)
          ? `third argument ${raw.text} does not resolve to an inline or module-scope object literal`
          : 'third argument is neither an object literal nor a resolvable dictionary variable'
        if (literal === undefined || !ts.isObjectLiteralExpression(literal)) {
          // The dictionary argument must resolve to an object literal; the
          // gate refuses rather than skips, so the symmetry it verifies never
          // silently narrows.
          refuse(ns.getText(source), tag.text, why)
        }
        /** 中文说明：变量 dictionary 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const dictionary: ts.ObjectLiteralExpression = literal as ts.ObjectLiteralExpression
        // The namespace expression's source text identifies the pair, so the
        // zh and en calls for one namespace meet and calls for different
        // namespaces stay apart.
        found.push({ file: rel, name: `${tag.text}@register:${ns.getText(source)}`, keys: keysOf(dictionary) })
      }
    }
    if (ts.isArrayLiteralExpression(node) && node.elements.length === 2) {
      /** 中文说明：变量 site 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const site = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
      /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
      for (const element of node.elements) {
        if (!ts.isArrayLiteralExpression(element) || element.elements.length !== 2) continue
        const [tag, dict] = element.elements
        /** 中文说明：变量 literal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const literal = unwrap(dict)
        if (tag === undefined || !ts.isStringLiteral(tag)) continue
        if (literal === undefined || !ts.isObjectLiteralExpression(literal)) continue
        if (tag.text !== 'zh' && tag.text !== 'en') continue
        found.push({ file: rel, name: `${tag.text}@inline:${site}`, keys: keysOf(literal) })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

/** Declared property names of an object literal, sorted. */
/** 中文说明：函数 keysOf 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function keysOf(literal: ts.ObjectLiteralExpression): string[] {
  /** 中文说明：变量 keys 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const keys: string[] = []
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const prop of literal.properties) {
    if (!ts.isPropertyAssignment(prop)) continue
    if (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) keys.push(prop.name.text)
  }
  return keys.sort()
}

/** Look through `satisfies`/`as`/parenthesized wrappers to the literal. */
/** 中文说明：函数 unwrap 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function unwrap(node: ts.Expression | undefined): ts.Expression | undefined {
  /** 中文说明：变量 current 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let current = node
  while (
    current !== undefined
    && (ts.isSatisfiesExpression(current) || ts.isAsExpression(current) || ts.isParenthesizedExpression(current))
  ) {
    current = current.expression
  }
  return current
}

/**
 * The locale a dictionary name declares, and the namespace-ish remainder that
 * identifies which pair it belongs to. `zh`/`en`, `zhSettings`/`enSettings`,
 * and `settingsZh`/`settingsEn` are the shapes this repo uses. A name-prefix
 * shape requires an uppercase ASCII letter at the third position (`[A-Z]`),
 * matching the admission of the cheap pre-filter, so `zh2Foo`/`zh_probe`
 * cannot be treated as dictionaries in one place and skipped in another.
 * @param name - export name or synthetic inline name.
 * @returns locale plus pair key, or undefined when the name names no locale.
 */
/** 中文说明：函数 localeOf 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function localeOf(name: string): { locale: 'zh' | 'en'; pair: string } | undefined {
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const locale of ['zh', 'en'] as const) {
    /** 中文说明：变量 other 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const other = locale === 'zh' ? 'Zh' : 'En'
    if (name === locale) return { locale, pair: '' }
    // Synthetic names for inline shapes carry their own pair key after the
    // first ':' (the enclosing array's line, or the namespace expression).
    if (name.startsWith(`${locale}@`)) return { locale, pair: name.slice(name.indexOf(':')) }
    if (name.startsWith(locale) && name.length > 2 && /[A-Z]/.test(name[2] ?? '')) {
      return { locale, pair: name.slice(2) }
    }
    if (name.endsWith(other)) return { locale, pair: name.slice(0, -2) }
  }
  return undefined
}

describe('shipped locale dictionaries', () => {
  it('declares the same keys in zh and en, so the single fallback locale always resolves', () => {
    /** 中文说明：变量 files 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const files = sourceFiles()
    // Guard the discovery itself: an empty or narrowed sweep would pass every
    // assertion below while checking nothing.
    expect(files.length).toBeGreaterThan(500)

    // Pair within a file first; a dictionary whose counterpart is not in the
    // same module then pairs with a sibling in the same directory. Both shapes
    // ship here: `locales/settings.ts` exports zh+en together, while
    // `locales/zh.ts` + `locales/en.ts` split the common pair across files.
    /** 中文说明：变量 perFile 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const perFile = new Map<string, Dictionary[]>()
    /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
    for (const file of files) {
      /** 中文说明：变量 dicts 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const dicts = dictionariesIn(file)
      if (dicts.length > 0) perFile.set(relative(file), dicts)
    }

    /** 中文说明：变量 groups 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const groups = new Map<string, Map<'zh' | 'en', Dictionary>>()
    /** 中文说明：函数值 place 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const place = (key: string, locale: 'zh' | 'en', dict: Dictionary): void => {
      /** 中文说明：变量 slot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const slot = groups.get(key) ?? new Map<'zh' | 'en', Dictionary>()
      if (slot.has(locale)) {
        throw new Error(`two ${locale} dictionaries claim pair ${key}: ${slot.get(locale)?.file} and ${dict.file}`)
      }
      slot.set(locale, dict)
      groups.set(key, slot)
    }

    /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
    for (const [rel, dicts] of perFile) {
      /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
      for (const dict of dicts) {
        /** 中文说明：变量 parsed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const parsed = localeOf(dict.name)
        if (parsed === undefined) continue
        /** 中文说明：函数值 sameFileCounterpart 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
        const sameFileCounterpart = dicts.some((other) => {
          /** 中文说明：变量 otherParsed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const otherParsed = localeOf(other.name)
          return otherParsed !== undefined
            && otherParsed.pair === parsed.pair
            && otherParsed.locale !== parsed.locale
        })
        // Same-file pairs key by file so two pairs in one directory stay
        // distinct; split pairs key by directory so siblings meet.
        /** 中文说明：变量 key 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const key = sameFileCounterpart ? `${rel}::${parsed.pair}` : `${dirname(rel)}::${parsed.pair}`
        place(key, parsed.locale, dict)
      }
    }

    /** 中文说明：变量 problems 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const problems: string[] = []
    /** 中文说明：变量 comparedPairs 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let comparedPairs = 0
    /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
    for (const [key, slot] of [...groups].sort()) {
      /** 中文说明：变量 zh 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const zh = slot.get('zh')
      /** 中文说明：变量 en 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const en = slot.get('en')
      if (zh === undefined || en === undefined) {
        /** 中文说明：变量 present 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const present = zh ?? en
        problems.push(`${present?.file} declares ${present?.name} with no counterpart for pair ${key}`)
        continue
      }
      comparedPairs++
      /** 中文说明：函数值 zhOnly 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
      const zhOnly = zh.keys.filter(k => !en.keys.includes(k))
      /** 中文说明：函数值 enOnly 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
      const enOnly = en.keys.filter(k => !zh.keys.includes(k))
      if (zhOnly.length > 0) problems.push(`${zh.file} ${zh.name} has keys absent from ${en.name}: ${zhOnly.join(', ')}`)
      if (enOnly.length > 0) problems.push(`${en.file} ${en.name} has keys absent from ${zh.name}: ${enOnly.join(', ')}`)
    }

    // The shipped dictionary count only grows; a collapse means discovery or
    // pairing broke, which would hide real asymmetry.
    expect(comparedPairs).toBeGreaterThan(25)
    expect(problems).toEqual([])
  })
})
