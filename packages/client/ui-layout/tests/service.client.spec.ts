/**
 * LayoutController behavior: the cross-plugin panel-action face. Geometry
 * lives in the entry store (layout-store.spec.ts) — here we assert the
 * delegation contract: attachPanels wiring, the three actions forwarding, the
 * unwired fail-loud, and re-attach overwriting a stale action set.
 */
/*
 * 中文说明：
 * - 文件职责：验证 LayoutController 对面板操作的挂接、转发、未接线报错和重新挂接行为。
 * - 技术维度：使用 Vitest 模拟函数和客户端服务类的真实方法调用。
 * - 产品维度：保障侧栏与详情面板操作总是送到当前布局入口，不会调用已卸载界面。
 * - 逻辑维度：fakePanels 生成操作探针，再分别测试正常转发、无绑定失败和新绑定覆盖旧绑定。
 * - 关键边界：几何状态由其他测试负责；此处只验证跨插件动作接口，不测试渲染。
 * - 新手阅读建议：先看 PanelActions 的六个探针，再比较 stale/fresh 用例如何证明覆盖关系。
 */
import { describe, expect, it, vi } from 'vitest'
import { LayoutController } from '@deepseek-ai/dsh-client-ui-layout/src/client/service.ts'
import type { PanelActions } from '@deepseek-ai/dsh-client-ui-layout/src/client/service.ts'

/** 中文：创建六个面板动作均为 Vitest 探针的假对象；无参数，返回 PanelActions。 */
function fakePanels(): PanelActions {
  return {
    setSidebar: vi.fn(),
    setDetails: vi.fn(),
    toggleSidebar: vi.fn(),
    setNarrow: vi.fn(),
    openDetails: vi.fn(),
    closeDetails: vi.fn(),
  }
}

/** 中文：LayoutController 面板动作服务测试组。 */
describe('LayoutController', () => {
  /** 中文：绑定动作后，三个公开操作应各转发一次且不触碰状态设置器；无参数和返回值。 */
  it('forwards the three panel actions to the attached set', () => {
    /** 当前用例的新布局控制器。 */
    const service = new LayoutController()
    /** 接收转发并记录调用的面板动作集。 */
    const panels = fakePanels()
    service.attachPanels(panels)

    service.toggleSidebar()
    service.openDetails()
    service.closeDetails()

    expect(panels.toggleSidebar).toHaveBeenCalledTimes(1)
    expect(panels.openDetails).toHaveBeenCalledTimes(1)
    expect(panels.closeDetails).toHaveBeenCalledTimes(1)
    expect(panels.setSidebar).not.toHaveBeenCalled()
    expect(panels.setDetails).not.toHaveBeenCalled()
  })

  /** 中文：根入口尚未接线时，三个操作都应明确抛错；无参数和返回值。 */
  it('fails loud before the root entry wired its actions', () => {
    /** 尚未 attachPanels 的布局控制器。 */
    const service = new LayoutController()
    expect(() => { service.toggleSidebar() }).toThrow(/panel actions not wired/)
    expect(() => { service.openDetails() }).toThrow(/panel actions not wired/)
    expect(() => { service.closeDetails() }).toThrow(/panel actions not wired/)
  })

  /** 中文：再次 attachPanels 后只调用新动作集；无参数和返回值。 */
  it('re-attach overwrites the stale action set (entry re-register)', () => {
    /** 当前用例的新布局控制器。 */
    const service = new LayoutController()
    /** 第一次绑定、之后应不再接收调用的旧动作集。 */
    const stale = fakePanels()
    /** 第二次绑定并应接收后续调用的新动作集。 */
    const fresh = fakePanels()
    service.attachPanels(stale)
    service.attachPanels(fresh)

    service.toggleSidebar()

    expect(stale.toggleSidebar).not.toHaveBeenCalled()
    expect(fresh.toggleSidebar).toHaveBeenCalledTimes(1)
  })
})
