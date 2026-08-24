// @vitest-environment jsdom
/**
 * 文件职责：验证附件拖放遮罩 portal 位置、可选说明文案和禁用状态插图切换。
 * 技术维度：使用 jsdom、Testing Library 和 Vitest 查询无障碍 status 元素与 SVG。
 * 产品维度：确保拖入文件时提示准确，达到限制后隐藏误导说明并更换不可用插图。
 * 逻辑维度：每例清理 DOM；分别检查完整文案、无 desc、disabled 文案与 SVG 差异。
 * 关键边界：遮罩必须 portal 到 body；disabled 时 desc 始终丢弃。
 * 新手阅读建议：先看 afterEach，再按三个用例比较 labels、disabled、textContent 和 SVG。
 */

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { DropOverlay } from '../src/DropOverlay.tsx'

// 每个测试后卸载全部 React 树和 portal 节点。
afterEach(cleanup)

// 拖放遮罩组件测试套件。
describe('DropOverlay', () => {
  // 验证遮罩 portal 到 body 且显示标题和说明。
  it('portals the invitation with its title and limits desc to the body', () => {
    // 已渲染遮罩视图查询器。
    const view = render(
      <DropOverlay disabled={false} labels={{ title: '图片拖动到此处即可添加', desc: '最多 20 张，每张 5MB' }} />,
    )
    // role=status 的遮罩根元素。
    const overlay = view.getByRole('status')
    expect(overlay.parentElement).toBe(document.body)
    expect(overlay.textContent).toContain('图片拖动到此处即可添加')
    expect(overlay.textContent).toContain('最多 20 张，每张 5MB')
  })

  // 验证未解析 desc 时只渲染标题。
  it('omits the desc line when none is resolved', () => {
    // 仅带标题的遮罩视图。
    const view = render(<DropOverlay disabled={false} labels={{ title: '图片拖动到此处即可添加' }} />)
    expect(view.getByRole('status').textContent).toBe('图片拖动到此处即可添加')
  })

  // 验证 disabled 状态丢弃说明并切换插图。
  it('drops the desc and switches the illustration while disabled', () => {
    // 可用状态视图，用于取得基准 SVG。
    const enabled = render(
      <DropOverlay disabled={false} labels={{ title: '拖入', desc: '限制' }} />,
    )
    // 可用插图的 SVG 内部标记。
    const enabledSvg = enabled.getByRole('status').querySelector('svg')!.innerHTML
    enabled.unmount()
    // 禁用状态视图。
    const disabled = render(
      <DropOverlay disabled labels={{ title: '当前无法添加图片', desc: '限制' }} />,
    )
    // 禁用遮罩根元素。
    const overlay = disabled.getByRole('status')
    expect(overlay.textContent).toBe('当前无法添加图片')
    expect(overlay.querySelector('svg')!.innerHTML).not.toBe(enabledSvg)
  })
})
