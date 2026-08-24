// @vitest-environment jsdom
// Branch tails the acceptance specs do not reach: the node-half apply
// without a settings service and AssistantMarkdown reasoning/unknown block arms.
/**
 * 文件职责：验证会话界面的 coverage-tails.client.spec.tsx 行为和边界。
 * 技术维度：Vitest、React 测试渲染、事件模拟与可控服务替身。
 * 产品维度：防止会话界面交互和展示在扩展后回归。
 * 逻辑维度：构造状态，触发渲染或交互，再断言输出和清理。
 * 关键边界：全局替身、计时器和异步任务必须在用例后恢复。
 * 新手阅读建议：先读辅助夹具，再按 describe 场景顺序阅读。
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { cleanup, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { apply as nodeApply } from '../src/index.ts'
import { AssistantMarkdown, type AssistantMarkdownProps } from '../src/client/chat/AssistantMarkdown.tsx'
import { zh } from '../src/client/locales.ts'

// Mirrors the real lookup chain (conversation namespace, then common).
/** 中文说明：测试局部值 t，取值由紧邻初始化决定。 */
const t: AssistantMarkdownProps['t'] = makeTranslate(zh, commonZh)
/** 中文说明：当前数据 renderMessageImages，取值由紧邻初始化决定。 */
const renderMessageImages: AssistantMarkdownProps['renderMessageImages'] = () => null

afterEach(cleanup)

describe('tails', () => {
  it('node-half apply tolerates a Host without settings', () => {
    expect(() => { nodeApply(new Context()) }).not.toThrow()
  })

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
    expect(view.getByText('Think')).toBeTruthy()
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
