/**
 * Cordis YAML parsing and Loader-entry classification shared by repository checks.
 * @module scripts/cordis-yaml
 */
/**
 * 文件职责：为仓库检查解析 Cordis YAML，并把 Loader !!js 表达式保留为数据而不执行。
 * 技术维度：使用 js-yaml 自定义 Type、扩展 JSON_SCHEMA 和 TypeScript 类型谓词分类 Loader 条目。
 * 产品维度：让静态门禁安全检查动态配置文本，避免在分析阶段运行用户 JavaScript。
 * 逻辑维度：jsExprType 解析表达式，loadCordisYaml 使用扩展 schema，两个谓词识别表达式和分组条目。
 * 关键边界：!!js 必须是标量字符串；本模块只解析/分类，不验证完整业务配置。
 * 新手阅读建议：先看 JsExpr 与 jsExprType，再看 schema/load，最后比较两个类型谓词的条件。
 */

import * as yaml from 'js-yaml'

/** A Loader `!!js` expression preserved as data instead of executed. */
/** Loader !!js 表达式的数据表示，字段保存原始源码文本。 */
export interface JsExpr {
  // 未执行的 JavaScript 标量字符串。
  __jsExpr: string
}

// js-yaml 自定义 !!js 类型；只接受标量并构造成 JsExpr。
const jsExprType = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  resolve: data => typeof data === 'string',
  // data 是待构造标量；非字符串属于模式使用错误。
  construct: (data: unknown): JsExpr => {
    if (typeof data !== 'string') throw new TypeError('!!js requires a scalar string')
    return { __jsExpr: data }
  },
})
// 支持 !!js 数据保留的 JSON YAML 模式。
const schema = yaml.JSON_SCHEMA.extend(jsExprType)

/**
 * Parse a Cordis config while preserving Loader `!!js` expressions as data.
 * @param source - Cordis YAML source text.
 * @returns the parsed YAML value.
 */
/** 解析 Cordis YAML。@param source YAML 文本。@returns 未知解析值，!!js 为 JsExpr。@example loadCordisYaml('config: {}')。 */
export function loadCordisYaml(source: string): unknown {
  return yaml.load(source, { schema })
}

/**
 * Test whether a value is a preserved Loader `!!js` expression.
 * @param value - parsed YAML value.
 * @returns whether the value contains one preserved expression.
 */
/** 判断保留表达式。@param value YAML 值。@returns 是否为 JsExpr。@example isJsExpr(value)。 */
export function isJsExpr(value: unknown): value is JsExpr {
  return typeof value === 'object'
    && value !== null
    && typeof (value as Record<string, unknown>).__jsExpr === 'string'
}

/**
 * Test whether a Loader entry owns nested entries in its `config` array.
 * @param value - parsed Loader entry.
 * @returns whether the entry is an explicit or package-named Cordis group.
 */
/** 判断 Cordis 分组条目。@param value Loader 条目。@returns 是否含 config 数组且显式标组或使用 group 包名。@example isCordisGroupEntry(value)。 */
export function isCordisGroupEntry(value: unknown): value is Record<string, unknown> & { config: unknown[] } {
  return typeof value === 'object'
    && value !== null
    && Array.isArray((value as Record<string, unknown>).config)
    && ((value as Record<string, unknown>).group === true
      || (value as Record<string, unknown>).name === '@deepseek-ai/cordis-plugin-group')
}
