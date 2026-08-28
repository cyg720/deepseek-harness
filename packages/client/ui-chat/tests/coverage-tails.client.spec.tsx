// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { AssistantMarkdown, type AssistantMarkdownProps } from '../src/client/chat/AssistantMarkdown.tsx'
import { zh } from '../src/client/locale.ts'

const t: AssistantMarkdownProps['t'] = makeTranslate(zh, commonZh)
/** 中文说明：当前数据 renderMessageImages，取值由紧邻初始化决定。 */
const renderMessageImages: AssistantMarkdownProps['renderMessageImages'] = () => null

afterEach(cleanup)

describe('tails', () => {
  it('AssistantMarkdown renders reasoning as a Think row and unknown blocks as JSON fallback', () => {
    /** 中文说明：测试局部值 view，取值由紧邻初始化决定。 */
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[
          { kind: 'reasoning', text: 'thinking hard\nsecond line' },
          { kind: 'tool-call', callId: 'c', name: 'bash', argsRaw: '{}' },
          { kind: 'other', block: { type: 'mystery' } },
        ]}
        streaming
        renderMessageImages={renderMessageImages}
      />,
    )
    expect(view.getByText('思考')).toBeTruthy()
    expect(view.getByText('thinking hard')).toBeTruthy()
    expect(view.getByText(/未知内容块/)).toBeTruthy()
    /** 中文说明：清理函数 stopped，取值由紧邻初始化决定。 */
    const stopped = render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'text', text: 'partial words' }]}
        streaming={false}
        interrupted
        renderMessageImages={renderMessageImages}
      />,
    )
    expect(stopped.getByText('已停止')).toBeTruthy()
  })

  it('AssistantMarkdown skips the root shell when only tool-call heads remain', () => {
    // Tool heads are drawn by ChatView's tool groups; an empty root between
    // groups is layout noise (no text, no pulse, no interrupted marker).
    /** 中文说明：测试局部值 empty，取值由紧邻初始化决定。 */
    const empty = render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'tool-call', callId: 'c', name: 'todo_write', argsRaw: '{}' }]}
        streaming={false}
        renderMessageImages={renderMessageImages}
      />,
    )
    expect(empty.container.firstChild).toBeNull()
    /** 中文说明：测试局部值 blank，取值由紧邻初始化决定。 */
    const blank = render(
      <AssistantMarkdown t={t} blocks={[]} streaming={false} renderMessageImages={renderMessageImages} />,
    )
    expect(blank.container.firstChild).toBeNull()
  })

})
