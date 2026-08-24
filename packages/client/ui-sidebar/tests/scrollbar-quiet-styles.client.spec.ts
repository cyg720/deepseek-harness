/**
 * The quiet-column rule as CSS text: the state SidebarRoot toggles
 * (pointer-scrollbars.spec.tsx) hides a scrollbar only through this rule, and
 * ui-theme's gate checks the rebinding contract's shape without knowing which
 * sheet states which half.
 */
/**
 * 文件职责：以 CSS 文本验证侧栏静默滚动条状态同时重绑定默认和悬停拇指颜色。
 * 技术维度：使用 Vitest、正则提取 CSS 规则并规范化声明列表。
 * 产品维度：隐藏滚动条时避免鼠标经过突然显色，同时保持列表宽度不跳动。
 * 逻辑维度：读取样式并移除注释；第一例解析 quietBars 声明，第二例确认不在本列设置 gutter。
 * 关键边界：测试只比较声明文本；滚动空间预留由 ui-workspace 列表拥有。
 * 新手阅读建议：先看 css/declarationText，再理解 rule 捕获组和 declarations 的拆分排序。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// SidebarRoot CSS 原始文本。
const css = readFileSync(fileURLToPath(new URL('../src/client/SidebarRoot.module.css', import.meta.url)), 'utf8')
/** Declarations only: the sheet's prose names the properties it explains. */
/** 去除块注释后的纯声明文本，避免说明文字中的属性名影响正则断言。 */
const declarationText = css.replace(/\/\*[\s\S]*?\*\//g, ' ')

// 静默侧栏 CSS 规则测试套件。
describe('SidebarRoot.module.css quiet column', () => {
  // 验证普通和 hover 两个间接变量都重绑定为透明色。
  it('rebinds the ui-theme indirection pair to transparent', () => {
    // The pair, not the resting thumb alone: rebinding one leaves the other
    // painting its base-surface colour the moment the pointer reaches the bar.
    // 必须同时重绑定两个变量；只改静止拇指会在鼠标进入时重新显示底色。
    // quietBars 规则的声明体正则结果；未匹配时为 null。
    const rule = /\.root\.quietBars\s*\{([^{}]*)\}/.exec(declarationText)
    expect(rule).not.toBeNull()
    // 规范化的单条 CSS 声明列表；去空、裁剪并排序后比较。
    const declarations = (rule![1] ?? '').split(';').map(part => part.trim()).filter(Boolean).sort()
    expect(declarations).toEqual([
      '--dsh-scrollbar-thumb-hover: transparent',
      '--dsh-scrollbar-thumb: transparent',
    ].sort())
  })

  // 验证本样式不拥有 scrollbar-gutter，隐藏拇指不会改变行布局。
  it('leaves the gutter reservation to the scrolling region', () => {
    // Hiding the thumb must not move a row: the reservation lives on the list
    // (ui-workspace), so the column states colour only.
    // 滚动空间由 ui-workspace 列表预留，本列只改变颜色。
    expect(declarationText).not.toMatch(/scrollbar-gutter/)
  })
})
