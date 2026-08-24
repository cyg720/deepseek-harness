// @vitest-environment jsdom
/**
 * 文件职责：验证附件的 composer-attachments.client.spec.tsx 行为。
 * 技术维度：Vitest、React 测试渲染和可控替身。
 * 产品维度：防止附件用户流程发生回归。
 * 逻辑维度：构造输入、触发交互并断言输出与清理。
 * 关键边界：全局替身和异步任务必须在用例后清理。
 * 新手阅读建议：先读辅助函数，再按测试场景顺序阅读。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type {
  ComposerAttachment, ComposerAttachmentsOwnerProps, ComposerAttachmentsProps,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ComposerAttachments } from '../src/client/ComposerAttachments.tsx'

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** 中文说明：测试场景的局部值 t，由紧邻初始化决定。 */
const t = ((key: string, params?: Readonly<Record<string, unknown>>): string => {
  /** 中文说明：测试场景的局部值 messages，由紧邻初始化决定。 */
  const messages: Record<string, string> = {
    'image.pending': '待发送图片',
    'image.original': '原图',
    'image.preview': '原图预览',
    'image.closePreview': '关闭原图预览',
    'image.openOriginal': '查看原图',
    'image.scrollLeft': '向左滚动图片',
    'image.scrollRight': '向右滚动图片',
    'image.dropBlocked': '当前无法添加图片',
    'image.dropTitle': '图片拖动到此处即可添加',
  }
  if (key === 'image.remove') {
    /** 中文说明：测试场景的局部值 name，由紧邻初始化决定。 */
    const name = params?.name
    return `移除图片 ${typeof name === 'string' ? name : ''}`
  }
  if (key === 'image.dropDesc') {
    /** 中文说明：测试场景的局部值 count，由紧邻初始化决定。 */
    const count = params?.count
    /** 中文说明：测试场景的局部值 size，由紧邻初始化决定。 */
    const size = params?.size
    return `最多 ${typeof count === 'number' ? String(count) : ''} 张，每张 ${typeof size === 'string' ? size : ''}`
  }
  return messages[key] ?? key
}) as ComposerAttachmentsProps['t']

/** 中文说明：函数 attachment 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
function attachment(id: string, name = `${id}.png`): ComposerAttachment {
  return {
    kind: 'image',
    id: id as ComposerAttachment['id'],
    file: new File([Uint8Array.of(1)], name, { type: 'image/png' }),
    previewUrl: `blob:${id}`,
  }
}

/** 中文说明：函数 props 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
function props(overrides: Partial<ComposerAttachmentsOwnerProps> = {}): ComposerAttachmentsProps {
  return {
    attachments: [],
    canAcceptDrop: true,
    onAddImages: () => {},
    onRemoveImage: () => {},
    t,
    ...overrides,
  } as unknown as ComposerAttachmentsProps
}

describe('ComposerAttachments', () => {
  it('accepts file drops anywhere on the document and keeps non-file drags native', () => {
    /** 中文说明：测试场景的局部值 onAddImages，由紧邻初始化决定。 */
    const onAddImages = vi.fn()
    /** 中文说明：测试场景的局部值 view，由紧邻初始化决定。 */
    const view = render(<ComposerAttachments {...props({
      onAddImages,
      dropLimits: { count: 20, size: '5MB' },
    })} />)

    expect(fireEvent.dragEnter(document.body, { dataTransfer: null })).toBe(true)
    /** 中文说明：测试场景的局部值 textTransfer，由紧邻初始化决定。 */
    const textTransfer = { types: ['text/plain'], files: [], dropEffect: 'none' }
    expect(fireEvent.dragEnter(document.body, { dataTransfer: textTransfer })).toBe(true)
    expect(fireEvent.dragOver(document.body, { dataTransfer: textTransfer })).toBe(true)
    expect(fireEvent.drop(document.body, { dataTransfer: textTransfer })).toBe(true)
    expect(view.queryByRole('status')).toBeNull()

    /** 中文说明：测试场景的局部值 image，由紧邻初始化决定。 */
    const image = attachment('dropped').file
    /** 中文说明：测试场景的局部值 dataTransfer，由紧邻初始化决定。 */
    const dataTransfer = { types: ['Files'], files: [image], dropEffect: 'none' }
    expect(fireEvent.dragEnter(document.body, { dataTransfer })).toBe(false)
    expect(view.getByRole('status').textContent).toContain('图片拖动到此处即可添加')
    expect(view.getByRole('status').textContent).toContain('最多 20 张，每张 5MB')
    expect(fireEvent.dragOver(document.body, { dataTransfer })).toBe(false)
    expect(dataTransfer.dropEffect).toBe('copy')
    expect(fireEvent.drop(document.body, { dataTransfer })).toBe(false)
    expect(onAddImages).toHaveBeenCalledWith([image])
    expect(view.queryByRole('status')).toBeNull()
  })

  it('tracks nested file drags and clears an aborted drag', () => {
    /** 中文说明：测试场景的局部值 view，由紧邻初始化决定。 */
    const view = render(<ComposerAttachments {...props()} />)
    /** 中文说明：测试场景的局部值 dataTransfer，由紧邻初始化决定。 */
    const dataTransfer = { types: ['Files'], files: [], dropEffect: 'none' }
    fireEvent.dragLeave(document.body, {
      dataTransfer: { types: ['text/plain'], files: [], dropEffect: 'none' },
    })
    fireEvent.dragEnter(document.body, { dataTransfer })
    fireEvent.dragEnter(document.body, { dataTransfer })
    fireEvent.dragLeave(document.body, { dataTransfer, clientX: 5, clientY: 5 })
    expect(view.getByRole('status')).toBeTruthy()
    fireEvent.dragLeave(document.body, { dataTransfer, clientX: 5, clientY: 5 })
    expect(view.queryByRole('status')).toBeNull()
    fireEvent.dragEnter(document.documentElement, { dataTransfer })
    /** 中文说明：测试场景的局部值 leftViewport，由紧邻初始化决定。 */
    const leftViewport = new Event('dragleave', { bubbles: true, cancelable: true })
    Object.defineProperties(leftViewport, {
      dataTransfer: { value: dataTransfer },
      clientX: { value: -1 },
      clientY: { value: 5 },
    })
    fireEvent(document.documentElement, leftViewport)
    expect(view.queryByRole('status')).toBeNull()
    fireEvent.dragEnter(document.body, { dataTransfer })
    fireEvent.dragEnd(window, { dataTransfer })
    expect(view.queryByRole('status')).toBeNull()
  })

  it('shows a blocked drop without forwarding its files', () => {
    /** 中文说明：测试场景的局部值 onAddImages，由紧邻初始化决定。 */
    const onAddImages = vi.fn()
    /** 中文说明：测试场景的局部值 view，由紧邻初始化决定。 */
    const view = render(<ComposerAttachments {...props({ canAcceptDrop: false, onAddImages })} />)
    /** 中文说明：测试场景的局部值 image，由紧邻初始化决定。 */
    const image = attachment('blocked').file
    /** 中文说明：测试场景的局部值 dataTransfer，由紧邻初始化决定。 */
    const dataTransfer = { types: ['Files'], files: [image], dropEffect: 'copy' }
    fireEvent.dragEnter(document.body, { dataTransfer })
    expect(view.getByRole('status').textContent).toBe('当前无法添加图片')
    fireEvent.dragOver(document.body, { dataTransfer })
    expect(dataTransfer.dropEffect).toBe('none')
    fireEvent.drop(document.body, { dataTransfer })
    expect(onAddImages).not.toHaveBeenCalled()
    expect(view.queryByRole('status')).toBeNull()
  })

  it('routes rail removal and closes previews on Escape or attachment removal', () => {
    /** 中文说明：测试场景的局部值 onRemoveImage，由紧邻初始化决定。 */
    const onRemoveImage = vi.fn()
    /** 中文说明：测试场景的局部值 image，由紧邻初始化决定。 */
    const image = attachment('draft-1', 'pixel.png')
    /** 中文说明：测试场景的局部值 initial，由紧邻初始化决定。 */
    const initial = props({ attachments: [image], onRemoveImage })
    /** 中文说明：测试场景的局部值 view，由紧邻初始化决定。 */
    const view = render(<ComposerAttachments {...initial} />)

    fireEvent.click(view.getByRole('button', { name: '移除图片 pixel.png' }))
    expect(onRemoveImage).toHaveBeenCalledWith(image.id)
    fireEvent.click(view.getByTitle('查看原图'))
    expect(view.getByRole('dialog', { name: '原图预览' })).toBeTruthy()
    view.rerender(<ComposerAttachments {...props({ attachments: [], onRemoveImage })} />)
    expect(view.queryByRole('dialog', { name: '原图预览' })).toBeNull()

    view.rerender(<ComposerAttachments {...initial} />)
    fireEvent.click(view.getByTitle('查看原图'))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(view.queryByRole('dialog', { name: '原图预览' })).toBeNull()
  })

  it('labels an unnamed attachment and its original-image preview', () => {
    /** 中文说明：测试场景的局部值 image，由紧邻初始化决定。 */
    const image = attachment('unnamed', '')
    /** 中文说明：测试场景的局部值 view，由紧邻初始化决定。 */
    const view = render(<ComposerAttachments {...props({ attachments: [image] })} />)
    expect(view.getByAltText('待发送图片')).toBeTruthy()
    fireEvent.click(view.getByTitle('查看原图'))
    expect(view.getByAltText('原图')).toBeTruthy()
  })
})
