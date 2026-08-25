/**
 * Matcher shared by both hook dialects. Claude treats alphanumeric/underscore/
 * pipe patterns as literal alternatives and other patterns as regex; Codex
 * treats every non-empty pattern as an unanchored regex. Missing, empty, and
 * `*` match all. Runtime matching contains invalid regexes as non-matches;
 * config parsers use {@link matcherDiagnostic} to reject them with a diagnostic.
 * @module @deepseek-ai/dsh-hook-protocol/matcher
 */
/*
 * 文件职责：实现Hook 线协议的 matcher.ts 模块。
 * 技术维度：TypeScript、Cordis、JSON 编解码、子进程、事件匹配和严格联合类型。
 * 产品维度：保证Hook 线协议可预测地传递事件、限制循环或适配外部工具。
 * 逻辑维度：解析配置，匹配事件，执行处理器并合并输出。
 * 关键边界：线协议输入必须校验；外部 Hook 失败不得破坏会话日志或核心循环。
 * 新手阅读建议：先读 types/events，再看 codec/matcher/runner，最后阅读桥接配置。
 */

import type { MatcherMode } from './types.ts'

/** True for an absent / empty / `'*'` pattern — the match-all sentinels. */
/* 中文说明：函数 isMatchAll 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function isMatchAll(matcher: string | undefined): boolean {
  return matcher === undefined || matcher === '' || matcher === '*'
}

/** A Claude-literal pattern is purely word chars + `|` (the regex-vs-literal discriminator). */
/* 中文说明：协议局部值 CLAUDE_LITERAL，由紧邻初始化决定。 */
const CLAUDE_LITERAL = /^[A-Za-z0-9_|]+$/

/** Compile an unanchored matcher regex; invalid patterns return `undefined`. */
/* 中文说明：函数 compileRegex 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function compileRegex(pattern: string): RegExp | undefined {
  try {
    return new RegExp(pattern)
  } catch (_syntaxError) {
    // RegExp construction is the try's only operation, so malformed pattern
    // syntax is the only expected failure.
    return undefined
  }
}

/**
 * Validate one matcher before a bridge accepts its config group.
 * @param matcher - configured pattern; match-all sentinels are valid.
 * @param mode - dialect deciding whether a word-and-pipe pattern is literal.
 * @returns `undefined` for a valid matcher, otherwise a stable diagnostic.
 */
/*
 * 中文说明：函数 matcherDiagnostic 的参数见签名，返回结果供相邻流程使用；示例见本文件。
 * @param matcher 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param mode 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function matcherDiagnostic(matcher: string | undefined, mode: MatcherMode): string | undefined {
  if (isMatchAll(matcher)) return undefined
  /** 中文说明：协议局部值 pattern，由紧邻初始化决定。 */
  const pattern = matcher as string
  if (mode === 'claude-code' && CLAUDE_LITERAL.test(pattern)) return undefined
  return compileRegex(pattern) === undefined
    ? `invalid ${mode} regex matcher ${JSON.stringify(pattern)}`
    : undefined
}

/**
 * Whether `matcher` selects `query` under the given dialect. Claude literal
 * patterns exact-match pipe-separated alternatives; all other patterns are
 * unanchored regexes. Invalid regexes return `false` rather than throwing;
 * bridge config parsers surface them through {@link matcherDiagnostic} before use.
 * @param matcher - the configured pattern; absent/empty/`'*'` are the match-all sentinels.
 * @param query - the candidate value (a tool name, a session source, …).
 * @param mode - the dialect deciding literal-vs-regex interpretation of the pattern.
 * @returns `true` when the pattern selects the query; `false` on a non-match or an invalid
 *   regex.
 */
/*
 * 中文说明：函数 matchesMatcher 的参数见签名，返回结果供相邻流程使用；示例见本文件。
 * @param matcher 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param query 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param mode 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function matchesMatcher(matcher: string | undefined, query: string, mode: MatcherMode): boolean {
  if (isMatchAll(matcher)) return true
  // matcher is a non-empty string past the match-all guard.
  /** 中文说明：协议局部值 pattern，由紧邻初始化决定。 */
  const pattern = matcher as string
  if (mode === 'claude-code' && CLAUDE_LITERAL.test(pattern)) {
    return pattern.split('|').includes(query)
  }
  return compileRegex(pattern)?.test(query) ?? false
}
