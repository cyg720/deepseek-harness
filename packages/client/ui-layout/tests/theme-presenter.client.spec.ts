// @vitest-environment jsdom
// ThemePresenter behavior account: root color-scheme and the palette attribute
// follow active.colorScheme only, token variables replace the previous apply's
// set, theme-color metadata follows the rendered body background, and dispose
// retracts everything the presenter wrote.
/**
 * 文件职责：验证应用布局的 theme-presenter.client.spec.ts 行为。
 * 技术维度：Vitest、React 渲染和可控服务替身。
 * 产品维度：防止应用布局用户流程回归。
 * 逻辑维度：构造状态，触发交互并断言输出与清理。
 * 关键边界：全局替身和异步任务必须在用例后恢复。
 * 新手阅读建议：先读辅助函数，再按场景顺序阅读。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
import { DARK_ATTRIBUTE, ThemePresenter } from '@deepseek-ai/dsh-client-ui-layout/src/client/theme-presenter.ts'

/** 中文说明：测试局部值 LIGHT_THEME_COLOR，由紧邻初始化决定。 */
const LIGHT_THEME_COLOR = 'rgb(255, 255, 255)'
/** 中文说明：测试局部值 DARK_THEME_COLOR，由紧邻初始化决定。 */
const DARK_THEME_COLOR = 'rgb(21, 21, 23)'

/** 中文说明：函数 snapshot 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function snapshot(colorScheme: 'light' | 'dark', tokens: Record<string, string> = {}): ThemeSnapshot {
  // The presenter must key off colorScheme, not the id — keep them distinct.
  /** 中文说明：测试局部值 active，由紧邻初始化决定。 */
  const active = { id: `${colorScheme}-test`, colorScheme, tokens }
  return { preference: colorScheme, active, themes: [active], revision: 1 }
}

/** 中文说明：函数 clearThemePresentation 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function clearThemePresentation(): void {
  document.head.querySelectorAll('meta[name="theme-color"], style[data-theme-presenter-test]').forEach((node) => { node.remove() })
}

/** 中文说明：函数 themeColorMeta 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function themeColorMeta(): HTMLMetaElement | null {
  return document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
}

beforeEach(() => {
  clearThemePresentation()
  document.documentElement.style.removeProperty('color-scheme')
  document.body.removeAttribute(DARK_ATTRIBUTE)
  document.body.removeAttribute('style')
  /** 中文说明：测试局部值 style，由紧邻初始化决定。 */
  const style = document.createElement('style')
  style.dataset.themePresenterTest = ''
  style.textContent = `
    body { background-color: ${LIGHT_THEME_COLOR}; }
    body[${DARK_ATTRIBUTE}] { background-color: ${DARK_THEME_COLOR}; }
  `
  document.head.append(style)
})

afterEach(clearThemePresentation)

describe('ThemePresenter', () => {
  it('light scheme sets root color-scheme and leaves the dark attribute absent', () => {
    /** 中文说明：测试局部值 presenter，由紧邻初始化决定。 */
    const presenter = new ThemePresenter()
    presenter.apply(snapshot('light'))
    expect(document.documentElement.style.colorScheme).toBe('light')
    expect(document.body.hasAttribute(DARK_ATTRIBUTE)).toBe(false)
    expect(themeColorMeta()?.content).toBe(LIGHT_THEME_COLOR)
  })

  it('dark scheme sets root color-scheme, the attribute, and metadata; switching to light updates one node', () => {
    /** 中文说明：测试局部值 presenter，由紧邻初始化决定。 */
    const presenter = new ThemePresenter()
    presenter.apply(snapshot('dark'))
    /** 中文说明：测试局部值 meta，由紧邻初始化决定。 */
    const meta = themeColorMeta()
    expect(document.documentElement.style.colorScheme).toBe('dark')
    expect(document.body.hasAttribute(DARK_ATTRIBUTE)).toBe(true)
    expect(meta?.content).toBe(DARK_THEME_COLOR)
    presenter.apply(snapshot('light'))
    expect(document.documentElement.style.colorScheme).toBe('light')
    expect(document.body.hasAttribute(DARK_ATTRIBUTE)).toBe(false)
    expect(themeColorMeta()).toBe(meta)
    expect(meta?.content).toBe(LIGHT_THEME_COLOR)
    expect(document.head.querySelectorAll('meta[name="theme-color"]')).toHaveLength(1)
  })

  it('applies tokens as inline variables and clears the previous set on theme change', () => {
    /** 中文说明：测试局部值 presenter，由紧邻初始化决定。 */
    const presenter = new ThemePresenter()
    presenter.apply(snapshot('dark', { '--dsw-alias-bg': '#111', '--dsw-alias-fg': '#eee' }))
    expect(document.body.style.getPropertyValue('--dsw-alias-bg')).toBe('#111')
    expect(document.body.style.getPropertyValue('--dsw-alias-fg')).toBe('#eee')
    presenter.apply(snapshot('light', { '--dsw-alias-bg': '#fff' }))
    expect(document.body.style.getPropertyValue('--dsw-alias-bg')).toBe('#fff')
    // The old theme's extra variable is gone, not merged.
    expect(document.body.style.getPropertyValue('--dsw-alias-fg')).toBe('')
  })

  it('dispose removes color-scheme, the attribute, and every applied variable, sparing foreign inline styles', () => {
    document.body.style.setProperty('--foreign', 'kept')
    /** 中文说明：测试局部值 presenter，由紧邻初始化决定。 */
    const presenter = new ThemePresenter()
    presenter.apply(snapshot('dark', { '--dsw-alias-bg': '#111' }))
    /** 中文说明：测试局部值 meta，由紧邻初始化决定。 */
    const meta = themeColorMeta()
    presenter.dispose()
    expect(document.documentElement.style.colorScheme).toBe('')
    expect(document.body.hasAttribute(DARK_ATTRIBUTE)).toBe(false)
    expect(document.body.style.getPropertyValue('--dsw-alias-bg')).toBe('')
    expect(document.body.style.getPropertyValue('--foreign')).toBe('kept')
    expect(meta?.isConnected).toBe(false)
  })
})
