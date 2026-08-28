// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { Context } from '@deepseek-ai/cordis'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { buildRenderApp } from '../src/client/app.tsx'

/** 当前用例持有的插槽测试运行时。 */
let runtime: SlotTestRuntime | undefined

/** 中文：每例后卸载 DOM、释放运行时、清理标题和环境替身。 */
afterEach(async () => {
  cleanup()
  await runtime?.dispose()
  runtime = undefined
})

/** 中文：创建声明最小 root 插槽的测试台；无参数，返回 runtime 和 renderApp。 */
async function bench() {
  runtime = await SlotTestRuntime.create()
  await runtime.root.declare({}, () => <div data-testid="frame" />)
  return { runtime, renderApp: buildRenderApp({ ctx: runtime.ctx }) }
}

/** 中文：buildRenderApp 客户端装配测试组。 */
describe('buildRenderApp', () => {
  it('fails loud when the slot registry is unavailable', () => {
    const renderApp = buildRenderApp({ ctx: new Context() })
    expect(() => renderApp()).toThrow()
  })

  /** 中文：完整测试台应渲染 root 插槽内容；无参数和返回值。 */
  it('renders the root slot tree', async () => {
    /** 当前用例的测试台。 */
    const b = await bench()
    /** 渲染应用后的 Testing Library 句柄。 */
    const view = render(<>{b.renderApp()}</>)
    expect(view.getByTestId('frame')).toBeTruthy()
  })

})
