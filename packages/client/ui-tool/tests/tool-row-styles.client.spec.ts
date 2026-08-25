/**
 * The one-line contract of the ToolRow summary line as CSS text. jsdom has no
 * layout, so the rendering specs (chat-tool-row.spec.tsx) can pin which spans
 * exist but not whether a narrow row still fits on one line; these read the
 * declarations the layout depends on.
 */
/*
 * 中文说明：
 * - 文件职责：直接读取 ToolRow CSS，验证摘要行在窄宽度下保持单行和正确截断职责。
 * - 技术维度：使用 Vitest、Node 文件读取、正则提取 CSS 声明和数组匹配。
 * - 产品维度：防止工具摘要的“+n”数量换行或省略，避免用户误判隐藏项数量。
 * - 逻辑维度：去除注释，按规则边界提取声明，再分别断言 suffix 不收缩和 summary 独自截断。
 * - 关键边界：jsdom 无布局能力，因此测试 CSS 文本；选择器必须存在且规则不含嵌套大括号。
 * - 新手阅读建议：先看 declarations 的正则锚点，再对照两个用例理解 summary 与 suffix 分工。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/** ToolRow 样式表的完整 UTF-8 文本。 */
const css = readFileSync(fileURLToPath(new URL('../src/client/tool/components/ToolRow.module.css', import.meta.url)), 'utf8')
/** Declarations only: the sheet's prose names the properties it explains. */
/* 中文：移除 CSS 注释后的声明文本，避免说明文字中的属性名影响匹配。 */
const declarationText = css.replace(/\/\*[\s\S]*?\*\//g, ' ')

/** 中文：提取 selector 基础规则的声明数组；找不到时抛错。示例：declarations('.summary')。 */
function declarations(selector: string): string[] {
  // Anchored at a rule boundary: an unanchored match would silently read a
  // compound rule that merely contains the selector (`.root:hover .summarySuffix`)
  // if one ever lands above the base rule.
  // 中文：从规则边界锚定，避免误读仅包含该选择器的复合规则。
  /** 当前选择器基础规则的正则匹配结果。 */
  const rule = new RegExp(`(?:^|\\})\\s*\\${selector}\\s*\\{([^{}]*)\\}`).exec(declarationText)
  if (rule === null) throw new Error(`ToolRow.module.css has no \`${selector}\` rule`)
  return (rule[1] ?? '').split(';').map(part => part.trim()).filter(Boolean)
}

/** 中文：ToolRow 摘要单行 CSS 契约测试组。 */
describe('ToolRow.module.css summary line', () => {
  /** 中文：后缀必须不收缩且不换行；无参数和返回值。 */
  it('keeps the summary suffix on one line and unshrunk', () => {
    // `flex: none` stops the box shrinking, not the text wrapping: without
    // `nowrap`, a row too narrow for title + separator + suffix wraps the `+n`
    // onto a second line — the exact case the slot exists to survive.
    // 中文：flex:none 只阻止盒子收缩，nowrap 才能避免空间不足时 +n 换到第二行。
    expect(declarations('.summarySuffix')).toEqual(expect.arrayContaining([
      'flex: none',
      'white-space: nowrap',
    ]))
  })

  /** 中文：只有摘要正文负责省略，数量后缀不得 ellipsis；无参数和返回值。 */
  it('leaves the truncation to the summary text alone', () => {
    // The suffix must never ellipsize: a clipped count reads as a smaller
    // number rather than as missing information.
    // 中文：数量若被省略会看起来像更小的数值，因此后缀绝不能使用 ellipsis。
    expect(declarations('.summary')).toEqual(expect.arrayContaining([
      'overflow: hidden',
      'text-overflow: ellipsis',
      'white-space: nowrap',
    ]))
    expect(declarations('.summarySuffix')).not.toEqual(expect.arrayContaining(['text-overflow: ellipsis']))
  })
})
