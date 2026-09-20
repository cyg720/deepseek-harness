import { describe, expect, it } from 'vitest'
import {
  DEFAULT_QS_SHELL_CONFIG, QS_UI_CONFIG_GLOBAL, readInjectedQsShellConfig, resolveQsShellConfig,
} from '../src/config.ts'
import { QsUiModeController } from '../src/client/ui-mode.ts'

describe('启动配置解析', () => {
  it('缺省取 workbench + 关闭开发者入口', () => {
    expect(resolveQsShellConfig(undefined)).toEqual(DEFAULT_QS_SHELL_CONFIG)
    expect(resolveQsShellConfig({})).toEqual(DEFAULT_QS_SHELL_CONFIG)
  })

  it('接受合法枚举与布尔值', () => {
    expect(resolveQsShellConfig({ defaultUi: 'official', showOfficialUiEntry: true }))
      .toEqual({ defaultUi: 'official', showOfficialUiEntry: true })
  })

  it('非法枚举抛错，不静默降级', () => {
    expect(() => resolveQsShellConfig({ defaultUi: 'workbench2' })).toThrow(/defaultUi/)
  })

  it('非法布尔值抛错（字符串 false 不算 false）', () => {
    expect(() => resolveQsShellConfig({ showOfficialUiEntry: 'false' })).toThrow(/showOfficialUiEntry/)
  })

  it('浏览器侧读取注入全局；缺失时取默认值', () => {
    expect(readInjectedQsShellConfig()).toEqual(DEFAULT_QS_SHELL_CONFIG)
    const holder = globalThis as Record<string, unknown>
    holder[QS_UI_CONFIG_GLOBAL] = { defaultUi: 'official', showOfficialUiEntry: true }
    try {
      expect(readInjectedQsShellConfig()).toEqual({ defaultUi: 'official', showOfficialUiEntry: true })
    } finally {
      Reflect.deleteProperty(holder, QS_UI_CONFIG_GLOBAL)
    }
  })
})

describe('界面切换控制器', () => {
  it('配置关闭时拒绝切换动作本身，并给出原因键', () => {
    const controller = new QsUiModeController(
      { defaultUi: 'workbench', showOfficialUiEntry: false },
      () => { throw new Error('must not run') },
    )
    controller.switchTo('official')
    expect(controller.getSnapshot().ui).toBe('workbench')
    expect(controller.getSnapshot().error).toBe('switch.disabled')
  })

  it('本地冻结期间拒绝切换，解除后可切换', () => {
    let applied: string | undefined
    const controller = new QsUiModeController(
      { defaultUi: 'workbench', showOfficialUiEntry: true },
      (target) => { applied = target },
    )
    controller.setLocalFreeze('sending')
    controller.switchTo('official')
    expect(applied).toBeUndefined()
    expect(controller.getSnapshot().error).toBe('switch.frozen')
    controller.setLocalFreeze(undefined)
    controller.switchTo('official')
    expect(applied).toBe('official')
    expect(controller.getSnapshot().ui).toBe('official')
    expect(controller.getSnapshot().error).toBeUndefined()
  })

  it('切换回调抛错时保留原界面并给出失败原因键', () => {
    const controller = new QsUiModeController(
      { defaultUi: 'workbench', showOfficialUiEntry: true },
      () => { throw new Error('boom') },
    )
    controller.switchTo('official')
    expect(controller.getSnapshot().ui).toBe('workbench')
    expect(controller.getSnapshot().error).toBe('switch.failed')
  })
})
