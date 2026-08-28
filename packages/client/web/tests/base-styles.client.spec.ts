/** Shell base styles stay independent from the dynamically loaded theme bundle. */
/*
 * 文件职责：验证 Web 壳基础样式不静态导入动态加载的主题包。
 * 技术维度：使用 Node.js 读取 CSS、正则提取 @import 顺序并通过 Vitest 断言。
 * 产品维度：允许主题插件在运行时选择和切换，避免基础壳提前绑定某个主题。
 * 逻辑维度：读取 base.css，提取所有导入，要求列表为空且文本不含主题包名。
 * 关键边界：解析器只关注 @import 说明符，保留重复项；不会理解完整 CSS 语法树。
 * 新手阅读建议：先看 baseCss 的文件来源，再看 importOrder 如何把正则匹配转换为路径数组。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// THEME_PACKAGE：基础样式中明确禁止出现的动态主题包名。
const THEME_PACKAGE = '@deepseek-ai/dsh-client-ui-theme'
// baseCss：从相邻源码文件同步读取的完整 UTF-8 样式文本。
const baseCss = readFileSync(fileURLToPath(new URL('../src/base.css', import.meta.url)), 'utf8')

/**
 * Import specifiers of the sheet, in source order. Quote style and surrounding
 * whitespace are intentionally irrelevant; duplicate imports remain visible.
 * @param css - stylesheet text.
 * @returns import specifiers in declaration order.
 */
/*
 * 按源码顺序提取样式表中的 @import 说明符。
 * @param css - 待扫描的完整 CSS 文本。
 * @returns 导入路径数组；引号和周围空白不影响结果，重复项保留。
 * @example importOrder("@import 'a.css';") 返回 ['a.css']。
 */
function importOrder(css: string): string[] {
  return [...css.matchAll(/@import\s+['"]([^'"]+)['"]/g)].map(([, specifier = '']) => specifier)
}

// imports：base.css 中按声明顺序出现的所有静态导入路径。
const imports = importOrder(baseCss)
const normalizedCss = baseCss
  .replaceAll(/\/\*[\s\S]*?\*\//g, '')
  .replaceAll(/\s+/g, ' ')
const literalContentSelectors = [
  'code',
  'pre',
  '[data-diff]',
  '[data-read]',
  '[data-search]',
  '[data-terminal]',
]

// 测试组：描述 Web 壳基础样式与动态主题的依赖隔离。
describe('web shell base.css', () => {
  /** 功能描述：确认基础样式没有主题导入；参数：无；返回：无；示例：imports 应为空。 */
  it('leaves theme styles to the dynamic ui-theme client entry', () => {
    expect(imports).toEqual([])
    expect(baseCss).not.toContain(THEME_PACKAGE)
  })

  it('auto-spaces prose while preserving literal content', () => {
    expect(baseCss).toMatch(/body\s*\{[^}]*text-autospace:\s*normal;/)
    expect(normalizedCss).toContain(
      `${literalContentSelectors.join(', ')} { text-autospace: no-autospace; }`,
    )
  })
})
