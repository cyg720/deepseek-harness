/**
 * WorkspaceBrowser spacing contract, asserted against the CSS text on disk:
 * row fills share the shell's trailing inset, the stable scrollbar counts
 * inside it, and flat, grouped, and search views keep their intended rhythm.
 */
/*
 * 文件职责：验证工作区浏览的 browser-styles.client.spec.ts 行为。
 * 技术维度：Vitest、React 渲染、虚拟列表和服务替身。
 * 产品维度：防止工作区浏览展示与操作流程回归。
 * 逻辑维度：构造状态，触发交互并断言输出和清理。
 * 关键边界：计时器、观察器、DOM 尺寸和异步请求必须恢复。
 * 新手阅读建议：先读夹具，再按加载、交互和异常场景阅读。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/rows/WorkspaceBrowser.module.css', import.meta.url)), 'utf8')
const rowsCss = readFileSync(fileURLToPath(new URL('../src/client/rows/Rows.module.css', import.meta.url)), 'utf8')

/**
 * Declarations of one selector rule, keyed by property with whitespace collapsed.
 * Declaration order and trailing semicolons are normalized away.
 * @param selector - one exact selector, including a leading dot for local classes.
 * @returns the rule's declarations, or undefined when no such rule exists.
 */
/* 中文说明：函数 declarationsFrom 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function declarationsFrom(source: string, selector: string): Map<string, string> | undefined {
  /** 中文说明：测试局部值 withoutComments，由紧邻初始化决定。 */
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, ' ')
  /** 中文说明：测试局部值 found，由紧邻初始化决定。 */
  const found = new Map<string, string>()
  /** 中文说明：测试局部值 [，由紧邻初始化决定。 */
  for (const [, selectorList = '', body = ''] of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectorList.split(',').map(value => value.trim()).includes(selector)) continue
    /** 中文说明：测试局部值 part，由紧邻初始化决定。 */
    for (const part of body.split(';')) {
      /** 中文说明：测试局部值 colon，由紧邻初始化决定。 */
      const colon = part.indexOf(':')
      if (colon === -1) continue
      found.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim().replace(/\s+/g, ' '))
    }
  }
  return found.size === 0 ? undefined : found
}

/** 中文说明：测试局部值 declarations，由紧邻初始化决定。 */
const declarations = (selector: string): Map<string, string> | undefined => declarationsFrom(css, selector)
/** 中文说明：测试局部值 rowDeclarations，由紧邻初始化决定。 */
const rowDeclarations = (selector: string): Map<string, string> | undefined => declarationsFrom(rowsCss, selector)

describe('WorkspaceBrowser.module.css list', () => {
  /** 中文说明：测试局部值 root，由紧邻初始化决定。 */
  const root = declarations('.root')
  /** 中文说明：测试局部值 listArea，由紧邻初始化决定。 */
  const listArea = declarations('.listArea')
  /** 中文说明：测试局部值 list，由紧邻初始化决定。 */
  const list = declarations('.list')

  it('is the scrolling region', () => {
    expect(list).toBeDefined()
    expect(list!.get('overflow-y')).toBe('auto')
  })

  it('counts the themed scrollbar inside the shell trailing inset', () => {
    expect(root?.get('--dsh-session-list-edge-inset')).toBe('var(--dsh-sidebar-inline-padding)')
    expect(root?.get('--dsh-session-list-scrollbar-width')).toBe('8px')
    expect(root?.get('--dsh-session-list-scrollbar-offset')).toBe('2px')
    expect(root?.get('padding-right')).toBe('var(--dsh-session-list-edge-inset)')
    expect(listArea?.get('margin-left')).toBe('-4px')
    expect(listArea?.get('padding-left')).toBe('4px')
    expect(listArea?.get('margin-right')).toBe('calc(-1 * var(--dsh-session-list-edge-inset))')
    expect(declarations('.fade')?.get('right')).toBe('var(--dsh-session-list-edge-inset)')
    expect(list?.get('margin-right')).toBe('var(--dsh-session-list-scrollbar-offset)')
    expect(list?.get('margin-left')).toBe('-4px')
    expect(list?.get('padding-left')).toBe('4px')
    expect(list?.get('padding-right')).toBe([
      'calc(',
      'var(--dsh-session-list-edge-inset)',
      '- var(--dsh-session-list-scrollbar-width)',
      '- var(--dsh-session-list-scrollbar-offset)',
      ')',
    ].join(' '))
    expect(declarations('.list::-webkit-scrollbar')).toBeUndefined()
  })

  it('reserves the scrollbar whether or not the list overflows', () => {
    expect(list!.get('scrollbar-gutter')).toBe('stable')
  })

  it('keeps 2px between rows and 4px between workspace groups', () => {
    expect(declarations('.flatList > * + *')?.get('margin-top')).toBe('2px')
    expect(declarations(".searchTree > [role='treeitem'] + [role='treeitem']")?.get('margin-top')).toBe('2px')
    expect(declarations('.groupSection > * + *')?.get('margin-top')).toBe('2px')
    expect(declarations('.groupSection + .groupSection')?.get('margin-top')).toBe('4px')
  })

  it('draws drag targets as a leading chevron joined to the insertion line', () => {
    /** 中文说明：测试局部值 listTopMarker，由紧邻初始化决定。 */
    const listTopMarker = declarations('.listTopDropIndicator')
    /** 中文说明：测试局部值 workspaceMarker，由紧邻初始化决定。 */
    const workspaceMarker = declarations('.workspaceDropBefore::before')
    /** 中文说明：测试局部值 sessionMarker，由紧邻初始化决定。 */
    const sessionMarker = rowDeclarations('.sessionRow.dropBefore::before')
    expect(listTopMarker?.get('top')).toBe('-8px')
    expect(listTopMarker?.get('left')).toBe('0')
    expect(workspaceMarker?.get('left')).toBe('0')
    expect(sessionMarker?.get('left')).toBe('0')
    /** 中文说明：测试局部值 marker，由紧邻初始化决定。 */
    for (const marker of [listTopMarker, workspaceMarker, sessionMarker]) {
      expect(marker?.get('height')).toBe('12px')
      expect(marker?.get('background')).not.toContain('radial-gradient')
      expect(marker?.get('background')).toContain('55deg')
      expect(marker?.get('background')).toContain('125deg')
      expect(marker?.get('background')).toContain('calc(50% - 1px) calc(50% + 1px)')
      expect(marker?.get('background')).toContain('0 0 / 5px 7px')
      expect(marker?.get('background')).toContain('0 5px / 5px 7px')
      expect(marker?.get('background')).toContain('4px 5px / calc(100% - 4px) 2px')
    }
  })

  it('keeps the compact fade, overflow control, search field, and row heights', () => {
    expect(declarations('.fade')?.get('height')).toBe('24px')
    expect(declarations('.sessionOverflowButton')?.get('height')).toBe('28px')
    expect(declarations('.searchExpanded')?.get('height')).toBe('30px')
    expect(rowDeclarations('.projectRow')?.get('height')).toBe('34px')
    expect(rowDeclarations('.sessionRow')?.get('height')).toBe('32px')
    expect(rowDeclarations('.flatSessionRowWithoutStatus .title')?.get('margin-left')).toBe('0')
    expect(rowDeclarations('.searchResultRow')?.get('min-height')).toBe('48px')
    expect(rowDeclarations('.sessionRow.selected')?.get('background'))
      .toBe('var(--dsw-alias-interactive-bg-hover)')
  })

  it('pins both rail controls to the shared left anchor during the column slide', () => {
    expect(declarations('.rail .sectionHeader')?.get('justify-content')).toBe('flex-start')
    expect(declarations('.rail .iconButton')?.get('width')).toBe('36px')
    expect(declarations('.rail .search')?.get('width')).toBe('36px')
  })
})
