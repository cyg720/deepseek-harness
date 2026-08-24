// @vitest-environment jsdom
// 中文：使用 jsdom 验证应用根渲染和 document.title 投影。
/**
 * 中文说明：
 * - 文件职责：验证 buildRenderApp 的服务前置条件、根插槽渲染和当前会话标题同步。
 * - 技术维度：使用 Vitest、Testing Library、SlotTestRuntime、jsdom 环境变量替身和响应式会话表。
 * - 产品维度：确保客户端只在依赖就绪后启动，并让浏览器标签始终反映当前会话和产品名。
 * - 逻辑维度：bench 建立根插槽测试台，四个用例覆盖缺服务、渲染、标题变化和孤立 current id。
 * - 关键边界：没有会话服务立即失败；无有效选中行时标题退回产品名。
 * - 新手阅读建议：先看 bench 返回的 runtime/renderApp，再按 document.title 的状态变化阅读用例。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { Context } from '@deepseek-ai/cordis'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { buildRenderApp } from '../src/client/app.tsx'

/** 当前用例持有的插槽测试运行时。 */
let runtime: SlotTestRuntime | undefined

/** 中文：每例后卸载 DOM、释放运行时、清理标题和环境替身。 */
afterEach(async () => {
  cleanup()
  await runtime?.dispose()
  runtime = undefined
  document.title = ''
  vi.unstubAllEnvs()
})

/** 中文：创建声明最小 root 插槽的测试台；无参数，返回 runtime 和 renderApp。 */
async function bench() {
  runtime = await SlotTestRuntime.create()
  await runtime.root.declare({}, () => <div data-testid="frame" />)
  return { runtime, renderApp: buildRenderApp({ ctx: runtime.ctx }) }
}

/** 中文：buildRenderApp 客户端装配测试组。 */
describe('buildRenderApp', () => {
  /** 中文：上下文缺少 sessions 服务时应立即失败；无参数和返回值。 */
  it('fails loud when the sessions service is unavailable', () => {
    expect(() => buildRenderApp({ ctx: new Context() })).toThrow('sessions service unavailable')
  })

  /** 中文：完整测试台应渲染 root 插槽内容；无参数和返回值。 */
  it('renders the root slot tree', async () => {
    /** 当前用例的测试台。 */
    const b = await bench()
    /** 渲染应用后的 Testing Library 句柄。 */
    const view = render(<>{b.renderApp()}</>)
    expect(view.getByTestId('frame')).toBeTruthy()
  })

  /** 中文：选中会话标题应与产品名组合，取消或无标题时回退产品名；无参数和返回值。 */
  it('projects the selected durable session title', async () => {
    vi.stubEnv('DSH_CLIENT_TITLE', 'Product')
    document.title = 'stale title'
    /** 当前用例的测试台。 */
    const b = await bench()
    render(<>{b.renderApp()}</>)
    expect(document.title).toBe('Product')
    await b.runtime.sessions.add({ id: 's1', summary: { title: 'First' } })
    expect(document.title).toBe('First — Product')
    await b.runtime.sessions.setCurrent(undefined)
    expect(document.title).toBe('Product')
    await b.runtime.sessions.add({ id: 's2' })
    expect(document.title).toBe('Product')
  })

  /** 中文：current id 在列表中无对应行时标题回退产品名；无参数和返回值。 */
  it('falls back when the selected id has no list row', async () => {
    vi.stubEnv('DSH_CLIENT_TITLE', 'Product')
    document.title = 'stale title'
    /** 当前用例的测试台。 */
    const b = await bench()
    await b.runtime.sessions.add({ id: 's1', summary: { title: 'First' } })
    render(<>{b.renderApp()}</>)
    expect(document.title).toBe('First — Product')
    b.runtime.sessions.list.update((draft) => { draft.current = 'ghost' as SessionId })
    await b.runtime.flush()
    expect(document.title).toBe('Product')
  })
})
