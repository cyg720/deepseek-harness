// @vitest-environment jsdom
/**
 * 文件职责：验证 DocumentTitle 把会话标题投影到浏览器并在更新或卸载时恢复产品标题。
 * 技术维度：使用 jsdom、Testing Library、Vitest 环境变量替身和 React 重渲染。
 * 产品维度：让浏览器标签准确显示当前会话，同时在无构建标题时提供本地构建后备名称。
 * 逻辑维度：每例清理 DOM 与环境；第一例覆盖标题多次变化，第二例覆盖空产品标题后备。
 * 关键边界：每次测试必须恢复 document.title 和环境变量；组件卸载后不能留下会话标题。
 * 新手阅读建议：先看 afterEach，再沿 mounted.rerender/unmount 观察文档标题变化。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { DocumentTitle } from '../src/client/DocumentTitle.tsx'

// 测试后清理渲染树、标题和所有环境变量替身。
afterEach(() => {
  cleanup()
  document.title = ''
  vi.unstubAllEnvs()
})

// 文档标题组件测试套件。
describe('DocumentTitle', () => {
  // 验证构建产品标题与会话标题组合、更新和恢复。
  it('projects a durable title and restores the product title', () => {
    vi.stubEnv('DSH_CLIENT_TITLE', 'DeepSeek Harness')
    document.title = 'stale title'
    const mounted = render(<DocumentTitle productTitle="DeepSeek Harness" />)
    expect(document.title).toBe('DeepSeek Harness')
    mounted.rerender(<DocumentTitle title="First title" productTitle="DeepSeek Harness" />)
    expect(document.title).toBe('First title — DeepSeek Harness')
    mounted.rerender(<DocumentTitle title="Revised title" productTitle="DeepSeek Harness" />)
    expect(document.title).toBe('Revised title — DeepSeek Harness')
    mounted.rerender(<DocumentTitle productTitle="DeepSeek Harness" />)
    expect(document.title).toBe('DeepSeek Harness')
    mounted.unmount()
    expect(document.title).toBe('DeepSeek Harness')
  })

  // 验证构建未提供标题时使用 DSH Local Build。
  it('uses the generic title when the build provides no title', () => {
    vi.stubEnv('DSH_CLIENT_TITLE', '')
    delete process.env.DSH_CLIENT_TITLE
    const mounted = render(<DocumentTitle title="First title" productTitle="DSH Local Build" />)
    expect(document.title).toBe('First title — DSH Local Build')
    mounted.unmount()
    expect(document.title).toBe('DSH Local Build')
  })
})
