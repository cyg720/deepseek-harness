// @vitest-environment jsdom
/**
 * 文件职责：验证附件的 message-image.client.spec.tsx 行为。
 * 技术维度：Vitest、React 测试渲染和可控替身。
 * 产品维度：防止附件用户流程发生回归。
 * 逻辑维度：构造输入、触发交互并断言输出与清理。
 * 关键边界：全局替身和异步任务必须在用例后清理。
 * 新手阅读建议：先读辅助函数，再按测试场景顺序阅读。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { EMPTY_CHAT_SNAPSHOT, type MessageImagesProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import { EMPTY_CONVERSATION_SNAPSHOT } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ImageGallery, MessageImage } from '../src/MessageImage.tsx'
import type { MessageImageLabels } from '../src/MessageImage.tsx'
import { MessageImages } from '../src/client/MessageImages.tsx'

afterEach(cleanup)

/** 中文说明：测试场景的局部值 labels，由紧邻初始化决定。 */
const labels: MessageImageLabels = {
  image: '图片',
  open: '查看原图',
  openNamed: label => `${label}，点击查看原图`,
  loading: '图片加载中…',
  loadFailed: '图片加载失败，点击重试',
  lightbox: { dialog: '原图预览', close: '关闭原图预览' },
}

/** 中文说明：测试场景的局部值 attachment，由紧邻初始化决定。 */
const attachment = {
  attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
  mediaType: 'image/png' as const,
  bytes: 68,
  width: 640,
  height: 320,
  name: 'history.png',
}

type AttentionSnapshot = Parameters<Parameters<MessageImagesProps['useSessionPendingInteraction']>[0]>[0]
type TrajectorySnapshot = Parameters<Parameters<MessageImagesProps['useTrajectory']>[0]>[0]

const noAttention: AttentionSnapshot = new Map()
const emptyTrajectory: TrajectorySnapshot = {
  eventNodes: [],
  eventLocations: new Map(),
  requests: [],
  callSchemas: new Map(),
  partial: null,
  runningCalls: [],
}
const useSessionPendingInteraction: MessageImagesProps['useSessionPendingInteraction'] = selector => selector(noAttention)
const useConversation: MessageImagesProps['useConversation'] = selector => selector(EMPTY_CONVERSATION_SNAPSHOT)
const useChat: MessageImagesProps['useChat'] = selector => selector(EMPTY_CHAT_SNAPSHOT)
const useTrajectory: MessageImagesProps['useTrajectory'] = selector => selector(emptyTrajectory)

describe('MessageImage', () => {
  it('renders a cached URL on the first frame while refreshing it', () => {
    const load = Object.assign(vi.fn(() => new Promise<string>(() => {})), {
      peek: vi.fn(() => 'blob:seeded'),
    })
    const view = render(<MessageImage image={{ attachment }} load={load} variant="single" labels={labels} />)
    expect(view.queryByText('图片加载中…')).toBeNull()
    expect((view.getByAltText('history.png') as HTMLImageElement).src).toContain('blob:seeded')
    expect(load).toHaveBeenCalledWith(attachment)
  })

  it('loads a session-authorized URL, bounds the thumbnail, and clicks into the original', async () => {
    /** 中文说明：测试场景的局部值 load，由紧邻初始化决定。 */
    const load = vi.fn().mockResolvedValue('blob:history')
    const view = render(<MessageImage image={{ attachment }} load={load} variant="single" labels={labels} />)
    const frame = view.getByRole('button', { name: 'history.png，点击查看原图' })
    expect(frame.getAttribute('style')).toContain('width: 240px')
    expect(frame.getAttribute('style')).toContain('height: 120px')
    expect(frame.getAttribute('title')).toBe('查看原图')
    await waitFor(() => { expect(view.getByAltText('history.png')).toBeTruthy() })
    expect(load).toHaveBeenCalledWith(attachment)
    fireEvent.click(frame)
    expect(view.getByRole('dialog', { name: '原图预览' })).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: '关闭原图预览' }))
    expect(view.queryByRole('dialog', { name: '原图预览' })).toBeNull()
  })

  it('ignores a click while the thumbnail is still loading', () => {
    /** 中文说明：测试场景的局部值 load，由紧邻初始化决定。 */
    const load = vi.fn(() => new Promise<string>(() => {}))
    const view = render(<MessageImage image={{ attachment }} load={load} variant="single" labels={labels} />)
    const frame = view.getByRole('button', { name: 'history.png，点击查看原图' })
    expect(view.getByText('图片加载中…')).toBeTruthy()
    fireEvent.click(frame)
    expect(view.queryByRole('dialog')).toBeNull()
  })

  it('falls back to the image label for an unnamed attachment', async () => {
    /** 中文说明：测试场景的局部值 { name，由紧邻初始化决定。 */
    const { name: _named, ...unnamed } = attachment
    /** 中文说明：测试场景的局部值 load，由紧邻初始化决定。 */
    const load = vi.fn().mockResolvedValue('blob:unnamed')
    const view = render(<MessageImage image={{ attachment: unnamed }} load={load} variant="single" labels={labels} />)
    await waitFor(() => { expect(view.getByAltText('图片')).toBeTruthy() })
    expect(view.getByRole('button', { name: '图片，点击查看原图' })).toBeTruthy()
  })

  it('surfaces a retry control when durable bytes cannot be read, including a failed retry', async () => {
    /** 中文说明：测试场景的局部值 load，由紧邻初始化决定。 */
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('still offline'))
      .mockResolvedValueOnce('blob:retry')
    const view = render(<MessageImage image={{ attachment }} load={load} variant="single" labels={labels} />)
    const retry = await view.findByRole('button', { name: '图片加载失败，点击重试' })
    fireEvent.click(retry)
    /** 中文说明：测试场景的局部值 retryAgain，由紧邻初始化决定。 */
    const retryAgain = await view.findByRole('button', { name: '图片加载失败，点击重试' })
    fireEvent.click(retryAgain)
    await waitFor(() => { expect(view.getByAltText('history.png')).toBeTruthy() })
    expect(load).toHaveBeenCalledTimes(3)
  })

  it('clamps extreme aspect ratios and anchors the crop toward the informative edge', async () => {
    /** 中文说明：测试场景的局部值 load，由紧邻初始化决定。 */
    const load = vi.fn().mockResolvedValue('blob:ratio')
    /** 中文说明：测试场景的局部值 tall，由紧邻初始化决定。 */
    const tall = render(
      <MessageImage image={{ attachment: { ...attachment, width: 100, height: 2000 } }} load={load} variant="single" labels={labels} />,
    )
    /** 中文说明：测试场景的局部值 tallFrame，由紧邻初始化决定。 */
    const tallFrame = tall.getByRole('button', { name: 'history.png，点击查看原图' })
    expect(tallFrame.getAttribute('style')).toContain('width: 60px')
    expect(tallFrame.getAttribute('style')).toContain('height: 240px')
    await waitFor(() => { expect(tall.getByAltText('history.png')).toBeTruthy() })
    expect(tall.getByAltText('history.png').style.objectPosition).toBe('center top')
    tall.unmount()
    /** 中文说明：测试场景的局部值 wide，由紧邻初始化决定。 */
    const wide = render(
      <MessageImage image={{ attachment: { ...attachment, width: 4000, height: 100 } }} load={load} variant="single" labels={labels} />,
    )
    /** 中文说明：测试场景的局部值 wideFrame，由紧邻初始化决定。 */
    const wideFrame = wide.getByRole('button', { name: 'history.png，点击查看原图' })
    expect(wideFrame.getAttribute('style')).toContain('width: 240px')
    expect(wideFrame.getAttribute('style')).toContain('height: 60px')
    await waitFor(() => { expect(wide.getByAltText('history.png')).toBeTruthy() })
    expect(wide.getByAltText('history.png').style.objectPosition).toBe('left center')
    wide.unmount()
    /** 中文说明：测试场景的局部值 small，由紧邻初始化决定。 */
    const small = render(
      <MessageImage image={{ attachment: { ...attachment, width: 100, height: 100 } }} load={load} variant="single" labels={labels} />,
    )
    /** 中文说明：测试场景的局部值 smallFrame，由紧邻初始化决定。 */
    const smallFrame = small.getByRole('button', { name: 'history.png，点击查看原图' })
    expect(smallFrame.getAttribute('style')).toContain('width: 100px')
    expect(smallFrame.getAttribute('style')).toContain('height: 100px')
  })

  it('renders a tile at the fixed square without inline sizing', () => {
    /** 中文说明：测试场景的局部值 load，由紧邻初始化决定。 */
    const load = vi.fn(() => new Promise<string>(() => {}))
    const view = render(<MessageImage image={{ attachment }} load={load} variant="tile" labels={labels} />)
    const frame = view.getByRole('button', { name: 'history.png，点击查看原图' })
    expect(frame.getAttribute('data-variant')).toBe('tile')
    expect(frame.getAttribute('style')).toBeNull()
  })

  it('keeps the tile variant on the failed-load retry control', async () => {
    /** 中文说明：测试场景的局部值 load，由紧邻初始化决定。 */
    const load = vi.fn().mockRejectedValue(new Error('offline'))
    const view = render(<MessageImage image={{ attachment }} load={load} variant="tile" labels={labels} />)
    const retry = await view.findByRole('button', { name: '图片加载失败，点击重试' })
    expect(retry.getAttribute('data-variant')).toBe('tile')
  })

  it('ignores a load settling after unmount', async () => {
    /** 中文说明：测试场景的局部值 resolve，由紧邻初始化决定。 */
    let resolve: ((url: string) => void) | undefined
    /** 中文说明：测试场景的局部值 load，由紧邻初始化决定。 */
    const load = vi.fn(() => new Promise<string>((r) => { resolve = r }))
    const view = render(<MessageImage image={{ attachment }} load={load} variant="single" labels={labels} />)
    view.unmount()
    resolve?.('blob:late')
    await Promise.resolve()
    /** 中文说明：测试场景的局部值 reject，由紧邻初始化决定。 */
    let reject: ((error: Error) => void) | undefined
    /** 中文说明：测试场景的局部值 failing，由紧邻初始化决定。 */
    const failing = vi.fn(() => new Promise<string>((_r, rej) => { reject = rej }))
    const second = render(<MessageImage image={{ attachment }} load={failing} variant="single" labels={labels} />)
    second.unmount()
    reject?.(new Error('late failure'))
    await Promise.resolve()
  })
})

describe('MessageImage preview arm', () => {
  it('displays a local preview immediately, without the loader, sized by its probed dimensions', () => {
    const load = vi.fn()
    const view = render(
      <MessageImage
        image={{ preview: { url: 'blob:echo', name: 'echo.png', width: 640, height: 320 } }}
        load={load}
        variant="single"
        labels={labels}
      />,
    )
    expect(load).not.toHaveBeenCalled()
    const img = view.getByAltText('echo.png') as HTMLImageElement
    expect(img.src).toContain('blob:echo')
    const frame = img.closest('button') as HTMLButtonElement
    expect(frame.style.width).toBe('240px')
    expect(frame.style.height).toBe('120px')
  })

  it('sizes an unprobed lone preview as a square crop and falls back to the image label', () => {
    const load = vi.fn()
    const view = render(
      <MessageImage image={{ preview: { url: 'blob:unprobed' } }} load={load} variant="single" labels={labels} />,
    )
    const img = view.getByAltText('图片') as HTMLImageElement
    const frame = img.closest('button') as HTMLButtonElement
    expect(frame.style.width).toBe('240px')
    expect(frame.style.height).toBe('240px')
  })

  it('opens the lightbox from a preview thumbnail', () => {
    const view = render(
      <MessageImage image={{ preview: { url: 'blob:box' } }} load={vi.fn(async () => '')} variant="tile" labels={labels} />,
    )
    fireEvent.click(view.getByRole('button', { name: '图片，点击查看原图' }))
    expect(view.getByRole('dialog', { name: '原图预览' })).toBeTruthy()
  })
})

describe('ImageGallery', () => {
  it('renders nothing without images and an aligned wrapping group with them', async () => {
    /** 中文说明：测试场景的局部值 load，由紧邻初始化决定。 */
    const load = vi.fn().mockResolvedValue('blob:gallery')
    /** 中文说明：测试场景的局部值 empty，由紧邻初始化决定。 */
    const empty = render(<ImageGallery images={[]} load={load} align="start" labels={labels} />)
    expect(empty.container.firstChild).toBeNull()
    /** 中文说明：测试场景的局部值 view，由紧邻初始化决定。 */
    const view = render(
      <ImageGallery
        images={[{ attachment }, { preview: { url: 'blob:echo', name: 'echo.png' } }, { attachment }]}
        load={load}
        align="end"
        labels={labels}
      />,
    )
    expect(view.container.querySelector('[data-align="end"]')).not.toBeNull()
    await waitFor(() => { expect(view.getAllByAltText('history.png')).toHaveLength(2) })
    expect(view.getByAltText('echo.png')).toBeTruthy()
  })

  it('renders a lone image large and compact or grouped images as square tiles', () => {
    const load = vi.fn(() => new Promise<string>(() => {}))
    /** 中文说明：测试场景的局部值 lone，由紧邻初始化决定。 */
    const lone = render(<ImageGallery images={[{ attachment }]} load={load} align="start" labels={labels} />)
    expect(lone.container.querySelectorAll('[data-variant="single"]')).toHaveLength(1)
    lone.unmount()
    const compact = render(
      <ImageGallery images={[{ attachment }]} load={load} align="end" compact labels={labels} />,
    )
    expect(compact.container.querySelectorAll('[data-variant="tile"]')).toHaveLength(1)
    compact.unmount()
    const several = render(
      <ImageGallery images={[{ attachment }, { attachment }, { attachment }]} load={load} align="end" labels={labels} />,
    )
    expect(several.container.querySelectorAll('[data-variant="tile"]')).toHaveLength(3)
  })

  it('renders the conversation slot entry with translated labels', async () => {
    /** 中文说明：测试场景的局部值 t，由紧邻初始化决定。 */
    const t = ((key: string, params?: Readonly<Record<string, unknown>>) => {
      /** 中文说明：测试场景的局部值 translated，由紧邻初始化决定。 */
      const translated: Record<string, string> = {
        'image.label': '图片',
        'image.openOriginal': '查看原图',
        'image.loading': '图片加载中…',
        'image.loadFailed': '图片加载失败，点击重试',
        'image.preview': '原图预览',
        'image.closePreview': '关闭原图预览',
      }
      if (key === 'image.openOriginalLabel') {
        /** 中文说明：测试场景的局部值 label，由紧邻初始化决定。 */
        const label = params?.label
        return `${typeof label === 'string' ? label : ''}，点击查看原图`
      }
      return translated[key] ?? key
    }) as MessageImagesProps['t']
    /** 中文说明：测试场景的局部值 loadImage，由紧邻初始化决定。 */
    const loadImage = vi.fn().mockResolvedValue('blob:slot-image')
    /** 中文说明：测试场景的局部值 useSession，由紧邻初始化决定。 */
    const useSession: MessageImagesProps['useSession'] = () => {
      throw new Error('MessageImages does not read the session snapshot')
    }
    /** 中文说明：测试场景的局部值 useInput，由紧邻初始化决定。 */
    const useInput: MessageImagesProps['useInput'] = () => {
      throw new Error('MessageImages does not read the input snapshot')
    }
    /** 中文说明：测试场景的局部值 useSessions，由紧邻初始化决定。 */
    const useSessions: MessageImagesProps['useSessions'] = () => {
      throw new Error('MessageImages does not read the session list snapshot')
    }
    /** 中文说明：测试场景的局部值 useWorkspaces，由紧邻初始化决定。 */
    const useWorkspaces: MessageImagesProps['useWorkspaces'] = () => {
      throw new Error('MessageImages does not read the workspace list snapshot')
    }
    /** 中文说明：测试场景的局部值 props，由紧邻初始化决定。 */
    const props: MessageImagesProps = {
      sessionId: 'message-images-test' as MessageImagesProps['sessionId'],
      useSession,
      useSessions,
      useSessionPendingInteraction,
      useWorkspaces,
      useProjection: () => undefined,
      useConversation,
      useChat,
      useTrajectory,
      useInput,
      inputActions: {
        setDraft: vi.fn(),
        addAttachments: vi.fn(() => true),
        removeAttachment: vi.fn(),
        pruneAttachments: vi.fn(),
        submit: vi.fn(),
      },
      images: [{ attachment }],
      loadImage,
      align: 'end',
      t,
    }
    /** 中文说明：测试场景的局部值 view，由紧邻初始化决定。 */
    const view = render(<MessageImages {...props} />)
    await waitFor(() => { expect(view.getByAltText('history.png')).toBeTruthy() })
    expect(view.getByRole('button', { name: 'history.png，点击查看原图' })).toBeTruthy()
    expect(view.container.querySelector('[data-align="end"]')).not.toBeNull()
  })
})
