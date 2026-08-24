// @vitest-environment jsdom
/**
 * 文件职责：验证客户端渲染器的 ui-renderer.client.spec.tsx 行为。
 * 技术维度：Vitest、React 测试渲染、DOM 事件和服务替身。
 * 产品维度：防止客户端渲染器的展示、作用域或交互回归。
 * 逻辑维度：构造上下文与属性，渲染后断言状态和清理。
 * 关键边界：Provider、订阅、全局 DOM 与异步任务必须释放。
 * 新手阅读建议：先读辅助夹具，再按场景顺序阅读。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup } from '@testing-library/react'
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { TestSessions, TestWorkspaces } from '@deepseek-ai/dsh-client-test-runtime'
import type { Stabilizer } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as nodeApply } from '@deepseek-ai/dsh-client-ui-renderer'
import * as UiRenderer from '../src/client/index.ts'

/** 中文说明：测试局部值 mounted，由紧邻初始化决定。 */
const mounted: (() => void)[] = []

afterEach(() => {
  act(() => { for (const unmount of mounted.splice(0)) unmount() })
  vi.restoreAllMocks()
  cleanup()
  document.body.innerHTML = ''
})

/** 中文说明：测试局部值 stabilize，由紧邻初始化决定。 */
const stabilize: Stabilizer = async (fn) => { await act(async () => { await fn() }) }

/** 中文说明：函数 bench 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function bench() {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  /** 中文说明：测试局部值 slots，由紧邻初始化决定。 */
  const slots = ctx.get('slots') as SlotRegistry
  ctx.provide('sessions', new TestSessions(stabilize, ctx))
  ctx.provide('workspaces', new TestWorkspaces(stabilize))
  /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
  const fiber = ctx.plugin({ inject: [...UiRenderer.inject], apply: UiRenderer.apply })
  await fiber.await()
  return { ctx, slots, fiber }
}

/** 中文说明：函数 container 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function container(): HTMLElement {
  /** 中文说明：测试局部值 el，由紧邻初始化决定。 */
  const el = document.createElement('div')
  document.body.append(el)
  return el
}

describe('UI renderer plugin', () => {
  it('provides no host-side behavior', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })

  it('installs the renderer and mounts the assembled application', async () => {
    /** 中文说明：测试局部值 { ctx, slots }，由紧邻初始化决定。 */
    const { ctx, slots } = await bench()
    slots.register({ name: 'root' }, () => <div data-testid="root-probe" />)
    /** 中文说明：测试局部值 renderer，由紧邻初始化决定。 */
    const renderer = ctx.get('uiRenderer')
    expect(renderer).toBeDefined()
    /** 中文说明：测试局部值 el，由紧邻初始化决定。 */
    const el = container()
    act(() => { mounted.push(renderer!.mount(el)) })
    expect(el.querySelector('[data-testid="root-probe"]')).toBeTruthy()
  })

  it('hydrates the boot page before switching to the assembled application', async () => {
    /** 中文说明：测试局部值 { ctx, slots }，由紧邻初始化决定。 */
    const { ctx, slots } = await bench()
    slots.register({ name: 'root' }, () => <div data-testid="root-probe" />)
    /** 中文说明：测试局部值 el，由紧邻初始化决定。 */
    const el = container()
    el.innerHTML = '<div class="boot" data-dsh-boot=""><div><div class="spinner" data-dsh-boot-spinner="" style="--dsh-boot-arc: 180deg"></div><div>Loading plugins…</div></div></div>'
    /** 中文说明：测试局部值 boot，由紧邻初始化决定。 */
    const boot = el.firstElementChild
    /** 中文说明：测试局部值 observer，由紧邻初始化决定。 */
    const observer = new MutationObserver(() => {})
    observer.observe(el, { childList: true, subtree: true })
    /** 中文说明：测试局部值 error，由紧邻初始化决定。 */
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    act(() => { mounted.push(ctx.get('uiRenderer')!.mount(el)) })

    /** 中文说明：测试局部值 records，由紧邻初始化决定。 */
    const records = observer.takeRecords()
    observer.disconnect()
    expect(error).not.toHaveBeenCalled()
    error.mockRestore()
    expect(el.querySelector('[data-testid="root-probe"]')).toBeTruthy()
    expect(records.some(record => record.target === boot)).toBe(false)
  })

  it('returns an unmount disposer', async () => {
    /** 中文说明：测试局部值 { ctx, slots }，由紧邻初始化决定。 */
    const { ctx, slots } = await bench()
    slots.register({ name: 'root' }, () => <div data-testid="root-probe" />)
    /** 中文说明：测试局部值 el，由紧邻初始化决定。 */
    const el = container()
    /** 中文说明：测试局部值 unmount，由紧邻初始化决定。 */
    let unmount: () => void = () => {}
    act(() => { unmount = ctx.get('uiRenderer')!.mount(el) })
    act(() => { unmount() })
    expect(el.querySelector('[data-testid="root-probe"]')).toBeNull()
  })

  it('retracts the service and renderer with its fiber', async () => {
    /** 中文说明：测试局部值 { ctx, slots, fiber }，由紧邻初始化决定。 */
    const { ctx, slots, fiber } = await bench()
    await stabilize(() => fiber.dispose())
    expect(ctx.get('uiRenderer')).toBeUndefined()
    expect(() => slots.renderSlot('root', {})).toThrow('not installed')
  })
})
