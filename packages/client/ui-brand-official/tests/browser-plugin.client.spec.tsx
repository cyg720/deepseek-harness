// @vitest-environment jsdom
/**
 * 文件职责：验证官方品牌的 browser-plugin.client.spec.tsx 行为。
 * 技术维度：Vitest、React 测试渲染和可控替身。
 * 产品维度：防止官方品牌用户流程发生回归。
 * 逻辑维度：构造输入、触发交互并断言输出与清理。
 * 关键边界：全局替身和异步任务必须在用例后清理。
 * 新手阅读建议：先读辅助函数，再按测试场景顺序阅读。
 */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { apply, inject } from '../src/client/index.ts'
import { OfficialBrandMark, OfficialBrandName } from '../src/client/Brand.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

/** 中文说明：测试场景的局部值 HOLES，由紧邻初始化决定。 */
const HOLES = [
  'sidebar.brand.mark',
  'sidebar.brand.name',
  'conversation.hero.brand.mark',
] as const

/** 中文说明：函数 bench 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
async function bench(declare = true) {
  /** 中文说明：测试场景的局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  /** 中文说明：测试场景的局部值 slots，由紧邻初始化决定。 */
  const slots = ctx.get('slots') as SlotRegistry
  /** 中文说明：测试场景的局部值 declareHoles，由紧邻初始化决定。 */
  const declareHoles = () => slots.register({
    name: 'root',
    children: Object.fromEntries(HOLES.map(name => [name, { kind: 'single', scope: 'root' }])),
  } as never, () => null)
  /** 中文说明：测试场景的局部值 disposeHoles，由紧邻初始化决定。 */
  const disposeHoles = declare ? declareHoles() : undefined
  return { ctx, slots, declareHoles, disposeHoles }
}

describe('official browser-brand plugin', () => {
  it('declares only the slot service it uses', () => {
    expect(inject).toEqual(['slots'])
  })

  it('leaves every slot empty outside the official build profile', async () => {
    vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'local')
    /** 中文说明：测试场景的局部值 subject，由紧邻初始化决定。 */
    const subject = await bench()
    await subject.ctx.plugin({ inject: [...inject], apply }).await()
    /** 中文说明：测试场景的局部值 hole，由紧邻初始化决定。 */
    for (const hole of HOLES) expect(subject.slots.entries(hole)).toHaveLength(0)
  })

  it('fills declarations before or after apply and removes every occupant on teardown', async () => {
    vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'official')
    /** 中文说明：测试场景的局部值 before，由紧邻初始化决定。 */
    const before = await bench()
    /** 中文说明：测试场景的局部值 fiber，由紧邻初始化决定。 */
    const fiber = before.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    /** 中文说明：测试场景的局部值 hole，由紧邻初始化决定。 */
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(1)

    before.disposeHoles?.()
    /** 中文说明：测试场景的局部值 hole，由紧邻初始化决定。 */
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(0)
    before.declareHoles()
    await Promise.resolve()
    /** 中文说明：测试场景的局部值 hole，由紧邻初始化决定。 */
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(1)

    await fiber.dispose()
    /** 中文说明：测试场景的局部值 hole，由紧邻初始化决定。 */
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(0)

    /** 中文说明：测试场景的局部值 after，由紧邻初始化决定。 */
    const after = await bench(false)
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    /** 中文说明：测试场景的局部值 hole，由紧邻初始化决定。 */
    for (const hole of HOLES) expect(after.slots.entries(hole)).toHaveLength(0)
    after.declareHoles()
    await Promise.resolve()
    /** 中文说明：测试场景的局部值 hole，由紧邻初始化决定。 */
    for (const hole of HOLES) expect(after.slots.entries(hole)).toHaveLength(1)
  })

  it('renders the official name independently from both requested mark sizes', () => {
    /** 中文说明：测试场景的局部值 name，由紧邻初始化决定。 */
    const name = render(<OfficialBrandName />)
    expect(name.container.querySelector('svg')?.getAttribute('viewBox')).toBe('26 0 156 24')
    name.unmount()

    /** 中文说明：测试场景的局部值 mark，由紧邻初始化决定。 */
    const mark = render(<OfficialBrandMark size={34} className="hero-mark" />)
    expect(mark.container.querySelector('svg')?.getAttribute('width')).toBe('34')
    expect(mark.container.querySelector('svg')?.getAttribute('class')).toBe('hero-mark')
    mark.rerender(<OfficialBrandMark size={24} />)
    expect(mark.container.querySelector('svg')?.getAttribute('width')).toBe('24')
  })
})
