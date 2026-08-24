// @vitest-environment jsdom
/**
 * 文件职责：验证UI 基础组件的 icons.client.spec.tsx 行为。
 * 技术维度：Vitest、React 测试渲染、DOM 事件和服务替身。
 * 产品维度：防止UI 基础组件的展示、作用域或交互回归。
 * 逻辑维度：构造上下文与属性，渲染后断言状态和清理。
 * 关键边界：Provider、订阅、全局 DOM 与异步任务必须释放。
 * 新手阅读建议：先读辅助夹具，再按场景顺序阅读。
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import {
  IconApiOutline14, IconArchiveOutline20, IconFolderClose16, IconGoalOutline16, IconSendOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'

afterEach(cleanup)

// Icon components all share the IconProps signature; the barrel also exports
// non-icon atoms (different props shapes), so filter by prefix BEFORE typing.
/** 中文说明：测试局部值 icons，由紧邻初始化决定。 */
const icons = Object.fromEntries(
  Object.entries(primitives).filter(([name]) => name.startsWith('Icon')),
) as Record<string, (p: primitives.IconProps) => React.JSX.Element>
/** 中文说明：测试局部值 iconNames，由紧邻初始化决定。 */
const iconNames = Object.keys(icons)

describe('ic_ds_ icon set', () => {
  it('exports the full icon set (46 deepsuite + 20 figma extracts + four product glyphs outside those sets)', () => {
    expect(iconNames.length).toBe(70)
  })

  it.each(iconNames)('%s renders an svg with currentColor fills and no hardcoded palette', (name) => {
    /** 中文说明：测试局部值 Icon，由紧邻初始化决定。 */
    const Icon = icons[name]!
    /** 中文说明：测试局部值 { container }，由紧邻初始化决定。 */
    const { container } = render(<Icon />)
    /** 中文说明：测试局部值 svg，由紧邻初始化决定。 */
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    /** 中文说明：测试局部值 markup，由紧邻初始化决定。 */
    const markup = container.innerHTML
    expect(markup).not.toMatch(/#[0-9a-fA-F]{3,8}"/)
    expect(markup).toContain('currentColor')
  })

  it('size and className props land on the root svg', () => {
    /** 中文说明：测试局部值 { container }，由紧邻初始化决定。 */
    const { container } = render(<IconSendOutline16 size={20} className="x" />)
    /** 中文说明：测试局部值 svg，由紧邻初始化决定。 */
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('width')).toBe('20')
    expect(svg.getAttribute('height')).toBe('20')
    expect(svg.classList.contains('x')).toBe(true)
  })

  it('each glyph defaults to its own drawn size, not one set-wide default', () => {
    /** 中文说明：测试局部值 api，由紧邻初始化决定。 */
    const api = render(<IconApiOutline14 />)
    expect(api.container.querySelector('svg')!.getAttribute('width')).toBe('14')
    /** 中文说明：测试局部值 folder，由紧邻初始化决定。 */
    const folder = render(<IconFolderClose16 />)
    expect(folder.container.querySelector('svg')!.getAttribute('width')).toBe('16')
    /** 中文说明：测试局部值 archive，由紧邻初始化决定。 */
    const archive = render(<IconArchiveOutline20 />)
    expect(archive.container.querySelector('svg')!.getAttribute('width')).toBe('20')
  })

  it('renders reusable goal glyphs without document-global ids', () => {
    /** 中文说明：测试局部值 { container }，由紧邻初始化决定。 */
    const { container } = render(<><IconGoalOutline16 /><IconGoalOutline16 /></>)
    expect(container.querySelector('[id]')).toBeNull()
    expect(container.querySelector('[clip-path]')).toBeNull()
  })
})

describe('FishLogo', () => {
  it('renders the fish path in currentColor at the native ratio', () => {
    /** 中文说明：测试局部值 { container }，由紧邻初始化决定。 */
    const { container } = render(<primitives.FishLogo />)
    /** 中文说明：测试局部值 svg，由紧邻初始化决定。 */
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('width')).toBe('24')
    expect(Number(svg.getAttribute('height'))).toBeCloseTo(17.66, 1)
    expect(svg.getAttribute('viewBox')).toBe('0 0 23.16 17.04')
    expect(container.querySelectorAll('path')).toHaveLength(1)
    expect(container.innerHTML).toContain('currentColor')
    expect(container.innerHTML).not.toContain('M0 0L23.16')
  })
})

describe('BrandWordmark', () => {
  it('can render the name artwork with or without its leading mark', () => {
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<primitives.BrandWordmark />)
    /** 中文说明：测试局部值 svg，由紧邻初始化决定。 */
    const svg = view.container.querySelector('svg')!
    expect(svg.getAttribute('width')).toBe('182')
    expect(svg.getAttribute('viewBox')).toBe('0 0 182 24')

    view.rerender(<primitives.BrandWordmark includeMark={false} />)
    expect(svg.getAttribute('width')).toBe('156')
    expect(svg.getAttribute('viewBox')).toBe('26 0 156 24')
  })
})
