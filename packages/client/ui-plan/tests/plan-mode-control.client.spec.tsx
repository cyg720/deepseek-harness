// @vitest-environment jsdom
/*
 * 文件职责：验证计划模式的 plan-mode-control.client.spec.tsx 行为。
 * 技术维度：Vitest、React 渲染和可控服务替身。
 * 产品维度：防止计划模式用户流程回归。
 * 逻辑维度：构造状态，触发交互并断言输出与清理。
 * 关键边界：全局替身和异步任务必须在用例后恢复。
 * 新手阅读建议：先读辅助函数，再按场景顺序阅读。
 */
/**
 * PlanChip over the `plan` projection: nothing renders while the capability
 * is absent or the effective target is the default mode; while plan mode is
 * the target, the chip executes /plan off and remains visible through failures
 * until the projection confirms the exit.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import type { PlanProjection } from '@deepseek-ai/dsh-plan-mode/client'
import { PlanChip, type PlanChipProps } from '../src/client/PlanModeControl.tsx'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

// The framework-injected t seat, stubbed over the zh dictionaries (the default locale).
/** 中文说明：测试局部值 t，由紧邻初始化决定。 */
const t: PlanChipProps['t'] = makeTranslate(zh, commonZh)

/** 中文说明：函数 setup 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function setup(
  plan: PlanProjection | undefined,
  exitPlanMode = vi.fn(() => Promise.resolve<string | null>(null)),
  locked = false,
) {
  /** 中文说明：测试局部值 store，由紧邻初始化决定。 */
  const store = createSnapshotStore<{ value: PlanProjection | undefined }>({ value: plan })
  /** 中文说明：测试局部值 useProjection，由紧邻初始化决定。 */
  const useProjection = (_key: string, selector?: (v: unknown) => unknown) =>
    bindSnapshotSelector(store)(s => (selector ?? (v => v))(s.value))
  /** 中文说明：测试局部值 props，由紧邻初始化决定。 */
  const props = { useProjection, locked, exitPlanMode, t } as unknown as PlanChipProps
  /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
  const view = render(<PlanChip {...props} />)
  return { store, exitPlanMode, view }
}

/** 中文说明：测试局部值 chip，由紧邻初始化决定。 */
const chip = () => screen.getByRole('button', { name: 'plan mode 已开启，按下关闭' })

describe('PlanChip', () => {
  it('renders nothing for an absent capability or a default-mode target', () => {
    /** 中文说明：测试局部值 absent，由紧邻初始化决定。 */
    const absent = setup(undefined)
    expect(absent.view.container.innerHTML).toBe('')
    cleanup()
    /** 中文说明：测试局部值 inactive，由紧邻初始化决定。 */
    const inactive = setup({ active: false, pending: false })
    expect(inactive.view.container.innerHTML).toBe('')
    cleanup()
    /** 中文说明：测试局部值 leaving，由紧邻初始化决定。 */
    const leaving = setup({ active: true, pending: true })
    expect(leaving.view.container.innerHTML).toBe('')
  })

  it('renders the Plan status for active and pending-entry targets', () => {
    setup({ active: true, pending: false })
    expect(chip().textContent).toBe('Plan')
    cleanup()
    setup({ active: false, pending: true })
    expect(chip().textContent).toBe('Plan')
  })

  it('executes /plan off once and follows the projection down', async () => {
    /** 中文说明：测试局部值 resolve，由紧邻初始化决定。 */
    let resolve!: (value: string | null) => void
    /** 中文说明：测试局部值 exitPlanMode，由紧邻初始化决定。 */
    const exitPlanMode = vi.fn(() => new Promise<string | null>((done) => { resolve = done }))
    /** 中文说明：测试局部值 { store }，由紧邻初始化决定。 */
    const { store } = setup({ active: true, pending: false }, exitPlanMode)
    fireEvent.click(chip())
    expect(exitPlanMode).toHaveBeenCalledTimes(1)
    fireEvent.click(chip())
    expect(exitPlanMode).toHaveBeenCalledTimes(1)
    resolve(null)
    store.set({ value: { active: true, pending: true } })
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'plan mode 已开启，按下关闭' })).toBeNull()
    })
  })

  it('disables under the locked owner prop', () => {
    setup({ active: true, pending: false }, vi.fn(), true)
    expect((chip() as HTMLButtonElement).disabled).toBe(true)
  })

  it('surfaces admission and transport failures while staying visible', async () => {
    /** 中文说明：测试局部值 exitPlanMode，由紧邻初始化决定。 */
    const exitPlanMode = vi.fn()
      .mockResolvedValueOnce('host said no')
      .mockRejectedValueOnce(new Error('network down'))
      .mockRejectedValueOnce('socket closed')
    setup({ active: true, pending: false }, exitPlanMode)
    fireEvent.click(chip())
    expect((await screen.findByText('failed to exit plan mode')).getAttribute('title')).toBe('host said no')
    expect(chip()).toBeTruthy()

    fireEvent.click(chip())
    expect(await screen.findByTitle('network down')).toBeTruthy()

    fireEvent.click(chip())
    expect(await screen.findByTitle('socket closed')).toBeTruthy()
  })

  it('ignores in-flight fulfillment and rejection after unmount', () => {
    /** 中文说明：测试局部值 resolve，由紧邻初始化决定。 */
    let resolve!: (value: string | null) => void
    /** 中文说明：测试局部值 successful，由紧邻初始化决定。 */
    const successful = setup(
      { active: true, pending: false },
      vi.fn(() => new Promise<string | null>((done) => { resolve = done })),
    )
    fireEvent.click(chip())
    successful.view.unmount()
    expect(() => { resolve(null) }).not.toThrow()

    /** 中文说明：测试局部值 reject，由紧邻初始化决定。 */
    let reject!: (reason: unknown) => void
    /** 中文说明：测试局部值 exitPlanMode，由紧邻初始化决定。 */
    const exitPlanMode = vi.fn(() => new Promise<string | null>((_done, fail) => { reject = fail }))
    /** 中文说明：测试局部值 { view }，由紧邻初始化决定。 */
    const { view } = setup({ active: true, pending: false }, exitPlanMode)
    fireEvent.click(chip())
    view.unmount()
    expect(() => { reject(new Error('late')) }).not.toThrow()
  })
})
