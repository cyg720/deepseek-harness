// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { RenderMessageImages } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { AssistantMarkdown } from '../src/client/chat/AssistantMarkdown.tsx'
import { zh } from '../src/client/locale.ts'

afterEach(cleanup)

/** 中文说明：测试局部值 t，取值由紧邻初始化决定。 */
const t = makeTranslate(zh, commonZh)

/** 中文说明：测试局部值 attachment，取值由紧邻初始化决定。 */
const attachment = {
  attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
  mediaType: 'image/png' as const,
  bytes: 68,
  width: 640,
  height: 320,
  name: 'history.png',
}

/** 中文说明：类型或类 MessageImagesRenderOwner 约束本文件的数据或组件职责。 */
type MessageImagesRenderOwner = Parameters<RenderMessageImages>[0]

/** 中文说明：函数 imageRenderer 的参数见签名，返回结果供相邻流程使用；示例见本文件调用处。 */
function imageRenderer(calls: MessageImagesRenderOwner[]): RenderMessageImages {
  return (owner) => {
    calls.push(owner)
    return (
      <div data-testid="message-images" data-align={owner.align} data-count={owner.images.length}>
        {owner.images.map((entry, index) => {
          if (!('attachment' in entry)) throw new Error('assistant flow images are always durable references')
          const image = entry.attachment
          return <span key={`${image.attachmentId}:${String(index)}`}>{image.name}</span>
        })}
      </div>
    )
  }
}

describe('assistant image slot handoff', () => {
  it('passes one image group and its message alignment to the renderer', () => {
    /** 中文说明：有序集合 calls，取值由紧邻初始化决定。 */
    const calls: MessageImagesRenderOwner[] = []
    /** 中文说明：测试局部值 view，取值由紧邻初始化决定。 */
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'image', attachment }]}
        streaming={false}
        renderMessageImages={imageRenderer(calls)}
      />,
    )
    expect(view.getByTestId('message-images').getAttribute('data-align')).toBe('start')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.images).toEqual([{ attachment }])
  })

  it('merges consecutive image blocks into one group and splits groups at text', () => {
    /** 中文说明：有序集合 calls，取值由紧邻初始化决定。 */
    const calls: MessageImagesRenderOwner[] = []
    /** 中文说明：测试局部值 view，取值由紧邻初始化决定。 */
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[
          { kind: 'image', attachment },
          { kind: 'image', attachment },
          { kind: 'text', text: 'between' },
          { kind: 'image', attachment },
        ]}
        streaming={false}
        renderMessageImages={imageRenderer(calls)}
      />,
    )
    /** 中文说明：测试局部值 galleries，取值由紧邻初始化决定。 */
    const galleries = view.getAllByTestId('message-images')
    expect(galleries).toHaveLength(2)
    expect(galleries.map(gallery => gallery.getAttribute('data-count'))).toEqual(['2', '1'])
    expect(calls.map(call => call.images.length)).toEqual([2, 1])
  })

  it('keeps the renderer output at the image block position between text blocks', () => {
    /** 中文说明：有序集合 calls，取值由紧邻初始化决定。 */
    const calls: MessageImagesRenderOwner[] = []
    /** 中文说明：测试局部值 view，取值由紧邻初始化决定。 */
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[
          { kind: 'text', text: 'before' },
          { kind: 'image', attachment },
          { kind: 'text', text: 'after' },
        ]}
        streaming={false}
        renderMessageImages={imageRenderer(calls)}
      />,
    )
    /** 中文说明：测试局部值 image，取值由紧邻初始化决定。 */
    const image = view.getByTestId('message-images')
    /** 中文说明：测试局部值 before，取值由紧邻初始化决定。 */
    const before = view.getByText('before')
    /** 中文说明：测试局部值 after，取值由紧邻初始化决定。 */
    const after = view.getByText('after')
    expect(before.compareDocumentPosition(image) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    expect(image.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
  })
})
