// @vitest-environment jsdom
/**
 * 文件职责：验证会话输入的 safari.client.spec.ts 行为。
 * 技术维度：Vitest、React 渲染、事件模拟和服务替身。
 * 产品维度：防止会话输入用户流程回归。
 * 逻辑维度：构造状态，触发行为并断言结果和清理。
 * 关键边界：异步任务、全局替身和 DOM 必须在用例后恢复。
 * 新手阅读建议：先读辅助函数，再按场景顺序阅读。
 */

import { describe, expect, it } from 'vitest'
import { isSafariBrowser, repairSafariTextareaLayout } from '../src/client/skeleton/safari.ts'

describe('Safari browser detection', () => {
  it.each([
    {
      name: 'desktop Safari',
      vendor: 'Apple Computer, Inc.',
      userAgent: 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Safari/605.1.15',
      expected: true,
    },
    {
      name: 'mobile Safari',
      vendor: 'Apple Computer, Inc.',
      userAgent: 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
      expected: true,
    },
    {
      name: 'desktop Chromium',
      vendor: 'Google Inc.',
      userAgent: 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
      expected: false,
    },
    {
      name: 'Chrome on iOS',
      vendor: 'Apple Computer, Inc.',
      userAgent: 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1',
      expected: false,
    },
    {
      name: 'Edge on iOS with Safari tokens',
      vendor: 'Apple Computer, Inc.',
      userAgent: 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 EdgiOS/140.0 Mobile/15E148 Safari/604.1',
      expected: false,
    },
    {
      name: 'Opera on iOS with Safari tokens',
      vendor: 'Apple Computer, Inc.',
      userAgent: 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 OPiOS/6.0 Mobile/15E148 Safari/604.1',
      expected: false,
    },
    {
      name: 'Apple web view',
      vendor: 'Apple Computer, Inc.',
      userAgent: 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
      expected: false,
    },
  ])('identifies $name', ({ vendor, userAgent, expected }) => {
    expect(isSafariBrowser({ vendor, userAgent })).toBe(expected)
  })
})

describe('Safari textarea layout recovery', () => {
  it('does nothing while the textarea owns no scrollable overflow', () => {
    /** 中文说明：测试局部值 input，由紧邻初始化决定。 */
    const input = document.createElement('textarea')
    Object.defineProperty(input, 'clientHeight', { value: 28 })
    Object.defineProperty(input, 'scrollHeight', { value: 28 })

    repairSafariTextareaLayout(input)

    expect(input.style.height).toBe('')
  })

  it('invalidates a stale native layout and restores the owned height', () => {
    /** 中文说明：测试局部值 input，由紧邻初始化决定。 */
    const input = document.createElement('textarea')
    /** 中文说明：测试局部值 scrollport，由紧邻初始化决定。 */
    const scrollport = document.createElement('div')
    scrollport.setAttribute('data-input-scroll', '')
    scrollport.appendChild(input)
    input.value = 'abcdef'
    input.setSelectionRange(3, 3)
    input.style.height = '100%'
    scrollport.style.height = '100%'
    /** 中文说明：测试局部值 inputRepaired，由紧邻初始化决定。 */
    let inputRepaired = false
    /** 中文说明：测试局部值 scrollportRepaired，由紧邻初始化决定。 */
    let scrollportRepaired = false
    /** 中文说明：测试局部值 inputLayouts，由紧邻初始化决定。 */
    const inputLayouts: string[] = []
    /** 中文说明：测试局部值 scrollportLayouts，由紧邻初始化决定。 */
    const scrollportLayouts: string[] = []
    Object.defineProperty(input, 'clientHeight', {
      get: () => input.style.height === '29px' ? 29 : 28,
    })
    Object.defineProperty(input, 'scrollHeight', {
      get: () => inputRepaired ? 28 : 52,
    })
    Object.defineProperty(input, 'offsetHeight', {
      get: () => {
        inputLayouts.push(input.style.height)
        if (input.style.height === '100%') inputRepaired = true
        return input.clientHeight
      },
    })
    Object.defineProperty(scrollport, 'clientHeight', {
      get: () => {
        if (scrollport.style.height === '53px') return 53
        if (inputRepaired && !scrollportRepaired) return 52
        return 28
      },
    })
    Object.defineProperty(scrollport, 'offsetHeight', {
      get: () => {
        scrollportLayouts.push(scrollport.style.height)
        if (scrollport.style.height === '100%') scrollportRepaired = true
        return scrollport.clientHeight
      },
    })

    repairSafariTextareaLayout(input)

    expect(inputLayouts).toEqual(['29px', '100%'])
    expect(scrollportLayouts).toEqual(['53px', '100%'])
    expect(input.style.height).toBe('100%')
    expect(scrollport.style.height).toBe('100%')
    expect(input.scrollHeight).toBe(input.clientHeight)
    expect(scrollport.clientHeight).toBe(28)
    expect([input.selectionStart, input.selectionEnd]).toEqual([3, 3])
  })

  it('does nothing outside the composer scrollport', () => {
    /** 中文说明：测试局部值 input，由紧邻初始化决定。 */
    const input = document.createElement('textarea')
    Object.defineProperty(input, 'clientHeight', { value: 28 })
    Object.defineProperty(input, 'scrollHeight', { value: 52 })

    repairSafariTextareaLayout(input)

    expect(input.style.height).toBe('')
  })

  it('accepts an absent textarea during teardown', () => {
    expect(() => { repairSafariTextareaLayout(null) }).not.toThrow()
  })
})
