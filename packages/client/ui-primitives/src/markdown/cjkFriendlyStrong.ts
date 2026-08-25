/**
 * ================================ 文件注释 ================================
 * 【文件职责】提供一个 micromark 语法扩展 cjkFriendlyStrong()：让"星号加粗"在中文语境下
 *             也能正确闭合。中文行文不用空格，标点后紧跟 **词** 时，CommonMark 默认规则
 *             不会把星号当作加粗结束，导致强调"吞掉"后面整段文字。
 * 【技术维度】micromark 扩展体系（text 构造）；复用官方 attention（星号强调）解析器的
 *             resolveAll，重写 tokenize 加入 CJK 闭合判定；用 Unicode Script_Extensions
 *             正则识别中日韩文字。
 * 【产品维度】AI 对话中的中文回复常用 **关键词** 强调；本扩展让中文用户看到正确的渲染，
 *             同时不破坏英文与 Markdown 标准行为。
 * 【逻辑维度】1) cjkCharacter 正则识别 CJK；2) tokenizeCjkFriendlyAttention 状态机
 *             （start / inside）计算 open 与 close；3) cjkStrongClose 判定：≥2 个星号、
 *             前字符是 Unicode 标点、后字符是 CJK 时强制闭合；4) 组装成 Extension 导出。
 * 【关键边界】只影响星号（asterisk）标记；仅 ≥2 星号启用 CJK 闭合豁免，避免破坏强调
 *             开头的判定；依赖 micromark 的 attentionMarkers 配置存在，缺失时抛错。
 * 【新手阅读建议】先理解 CommonMark 强调规则"前可开、后可关"，再看 cjkStrongClose
 *             三个条件的含义。
 * ==========================================================================
 */
/** Let asterisk strong emphasis close after punctuation when CJK prose continues without whitespace. */

import { attention } from 'micromark-core-commonmark'
import { unicodePunctuation } from 'micromark-util-character'
import { classifyCharacter } from 'micromark-util-classify-character'
import { codes, constants } from 'micromark-util-symbol'
import type { Construct, Extension, State, Tokenizer } from 'micromark-util-types'

// 匹配中日韩文字的 Unicode 正则：汉字、假名、谚文、注音符号，用于识别"CJK 语境"。
const cjkCharacter = new RegExp([
  '\\p{Script_Extensions=Han}',
  '\\p{Script_Extensions=Hiragana}',
  '\\p{Script_Extensions=Katakana}',
  '\\p{Script_Extensions=Hangul}',
  '\\p{Script_Extensions=Bopomofo}',
].join('|'), 'u')

/** 判断一个字符码点是否为 CJK 字符（供强调闭合判定使用）。 */
function isCjkCharacter(code: number | null): boolean {
  return code !== null && code >= 0 && cjkCharacter.test(String.fromCodePoint(code))
}

/**
 * 重写的"星号强调"分词器：在 CommonMark 的 open / close 判定之外，追加"标点 + CJK 续写"
 * 时的强制闭合规则。micromark 分词器是一个状态机：start 开启，inside 消费并结算。
 */
const tokenizeCjkFriendlyAttention: Tokenizer = function (effects, ok, nok) {
  const configuredAttentionMarkers = this.parser.constructs.attentionMarkers.null
  if (configuredAttentionMarkers === undefined) {
    throw new Error('micromark CommonMark attention markers are unavailable')
  }
  const attentionMarkers = configuredAttentionMarkers
  // 强调序列前的字符及其分类（标点 / 空白 / 其它），用于 CommonMark 的开闭判定。
  const previous = this.previous
  const before = classifyCharacter(previous)
  let marker: number | null = codes.eof

  return start

  function start(code: number | null): State | undefined {
    /* v8 ignore next -- this text construct is dispatched only for an asterisk. */
    if (code !== codes.asterisk) return nok(code)
    marker = code
    effects.enter('attentionSequence')
    return inside(code)
  }

  function inside(code: number | null): State | undefined {
    if (code === marker) {
      effects.consume(code)
      return inside
    }

    const token = effects.exit('attentionSequence')
    const after = classifyCharacter(code)
    // CommonMark 的"可开"规则：后面没有字符、或后是标点且前有字符、或后是强调标记字符。
    const open = !after || (after === constants.characterGroupPunctuation && Boolean(before))
      || attentionMarkers.includes(code)
    // CommonMark 的"可关"规则：前面没有字符、或前是标点且后有字符、或前是强调标记字符。
    const commonMarkClose = !before
      || (before === constants.characterGroupPunctuation && Boolean(after))
      || attentionMarkers.includes(previous)
    const markerCount = token.end.offset - token.start.offset
    // CJK 友好闭合：至少两个星号、且前字符是 Unicode 标点、后字符是 CJK——
    // 中文正文"标点后紧跟 **词**"的模式应当把星号视为加粗结束。
    const cjkStrongClose = markerCount >= 2
      && unicodePunctuation(previous)
      && isCjkCharacter(code)
    const close = commonMarkClose || cjkStrongClose

    token._open = open
    token._close = close
    return ok(code)
  }
}

// 组装好的星号强调构造：解析逻辑复用官方 attention 的 resolveAll，分词用上面的改造版。
const cjkFriendlyAttention: Construct = {
  name: 'cjkFriendlyAttention',
  resolveAll: attention.resolveAll,
  tokenize: tokenizeCjkFriendlyAttention,
}

// 注册进 micromark 的 text 阶段：只有星号触发该构造。
const cjkFriendlyStrongExtension: Extension = {
  text: { [codes.asterisk]: cjkFriendlyAttention },
}

/**
 * Extend CommonMark asterisk strong emphasis for punctuation-delimited CJK
 * prose, as a micromark syntax extension for `fromMarkdown`.
 * @returns The micromark syntax extension.
 */
/*
 * 生成"CJK 友好加粗"micromark 语法扩展，供 fromMarkdown 的 extensions 数组使用。
 * 使用示例：fromMarkdown(text, { extensions: [gfm(), cjkFriendlyStrong()] })。
 * @returns micromark 语法扩展对象。
 */
export function cjkFriendlyStrong(): Extension {
  return cjkFriendlyStrongExtension
}
