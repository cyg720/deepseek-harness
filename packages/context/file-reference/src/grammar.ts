/**
 * ================================ 文件注释 ================================
 * 【文件职责】定义 `@` 文件提及（file mention）语法：解析编辑器光标处的 `@路径`
 *             标记，并把选中的路径格式化为提示词文本。该语法需在终端与 Web
 *             客户端之间保持一致，故本模块必须不依赖浏览器特有 API。
 * 【技术维度】纯正则表达式解析 + 字符串格式化，无任何依赖，可在浏览器安全运行；
 *             与 types.ts 的 FileReferenceCandidate 配合使用。
 * 【产品维度】用户输入 @ 后出现的文件补全：编辑器要判断"当前是否处于 @ 标记中"
 *             （activeAtToken），用户选中候选后要生成插入文本（formatFileMention）。
 * 【逻辑维度】1) activeAtToken：解析光标左侧文本，识别带引号（@"...）或不带引号
 *             （@...）两种 @ 标记；2) formatFileMention：按路径是否含空格/引号
 *             决定用引号包裹，并保持目录后的斜杠使补全能继续下钻。
 * 【关键边界】@ 出现在其他 token 内部（如邮箱地址）时不作为补全触发；含控制字符
 *             或引号的路径无法安全表示，返回 undefined 拒绝插入。
 * 【新手阅读建议】先看两个正则的含义（quoted 优先于 plain），再看返回结构
 *                 ActiveAtToken，最后看格式化逻辑中的引号分支。
 * ==========================================================================
 */

/**
 * Browser-safe `@file` token grammar shared by terminal and web clients.
 *
 * @module @deepseek-ai/dsh-file-reference/grammar
 */

import type { FileReferenceCandidate } from './types.ts'

/** Active `@` token ending at the editor cursor. */
/* 当前正处于编辑器光标处的 @ 标记：编辑器据此判断是否弹出补全。 */
export interface ActiveAtToken {
  /** Complete token replaced when the user accepts a completion. */
  /* 完整的标记文本（含 @ 或 @");用户确认补全时整体替换掉它。 */
  prefix: string
  /** Path query after `@` or `@"`. */
  /* @ 或 @" 之后的路径查询文本，即补全关键字。 */
  query: string
  /** Whether the user opened a quoted path. */
  /* 用户是否已输入左引号（@" 形式），影响后续补全与格式化行为。 */
  quoted: boolean
}

/**
 * Extract an `@path` or `@"path with spaces` token at the cursor. An `@`
 * inside another token, such as an email address, is not a completion trigger.
 * @param line - current editor line.
 * @param cursorCol - cursor column within that line.
 * @returns the active token, or `undefined` outside an `@` token.
 */
/*
 * 提取光标处的 @ 标记。两个正则都要求 @ 前面是行首或空白，因此邮箱等
 * "嵌在其他 token 中间的 @" 不会误触发补全。
 * @param line 当前编辑器行文本
 * @param cursorCol 光标在该行内的列号
 * @returns 光标处正在输入的活动标记；若不在 @ 标记中则返回 undefined
 * @example activeAtToken('read @src/ma', 11) // 返回 { prefix: '@src/ma', query: 'src/ma', quoted: false }
 */
export function activeAtToken(line: string, cursorCol: number): ActiveAtToken | undefined {
  const beforeCursor = line.slice(0, cursorCol)
  const quoted = /(?:^|\s)(@"([^"]*))$/u.exec(beforeCursor)
  if (quoted?.[1] !== undefined && quoted[2] !== undefined) {
    return { prefix: quoted[1], query: quoted[2], quoted: true }
  }
  const plain = /(?:^|\s)(@([^\s]*))$/u.exec(beforeCursor)
  if (plain?.[1] === undefined || plain[2] === undefined) return undefined
  return { prefix: plain[1], query: plain[2], quoted: false }
}

/**
 * Format a selected path as prompt text. Whitespace uses the quoted
 * `@"path"` grammar; a quoted directory keeps that quote open after its
 * trailing slash so completion can descend another level.
 * @param candidate - selected file or directory.
 * @param preserveQuote - retain an explicitly opened quote even when unnecessary.
 * @returns the insertion value, or `undefined` for a path the editor grammar cannot represent safely.
 */
/*
 * 把用户选中的候选路径格式化为可插入的提示词文本。含空白时用 @"path" 引号语法；
 * 目录在引号内保留尾部斜杠且不闭合引号，方便补全继续进入下一层。
 * @param candidate 被选中的文件或目录候选
 * @param preserveQuote 即使路径不含空白也保留已打开的引号（用户主动开的引号不擅自关闭）
 * @returns 可直接插入编辑器的文本；路径含控制字符或引号（语法无法安全表示）时返回 undefined
 * @example formatFileMention({ path: 'a b.ts', kind: 'file' }, false) // '@"a b.ts"'
 */
export function formatFileMention(
  candidate: FileReferenceCandidate,
  preserveQuote: boolean,
): string | undefined {
  // 目录路径末尾补斜杠，让补全语义停留在"目录内部"
  const path = candidate.kind === 'directory' ? `${candidate.path}/` : candidate.path
  // 控制字符（含换行）或双引号会破坏 @ 语法，直接拒绝
  if (/[\u0000-\u001f\u007f-\u009f"]/u.test(path)) return undefined
  // 用户已开引号或路径含空白时才用引号包裹
  const quoted = preserveQuote || /\s/u.test(path)
  if (!quoted) return `@${path}`
  if (candidate.kind === 'directory') return `@"${path}`
  return `@"${path}"`
}
