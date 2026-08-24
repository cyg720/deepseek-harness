/** Appearance row store: snapshot-mirror action and the revision guard. */
/**
 * 文件职责：验证外观设置存储的初始快照、同步动作和版本号防回退规则。
 * 技术维度：使用 Vitest 直接创建轻量客户端 store 并检查同步后的不可变快照。
 * 产品维度：确保主题偏好正确跟随宿主设置，同时旧消息不会覆盖较新的用户选择。
 * 逻辑维度：分别覆盖默认值、正常递增同步、过期与重复版本写入三条路径。
 * 关键边界：只有严格更大的 revision 才能更新；初始 revision 固定为 -1。
 * 新手阅读建议：按三个 it 顺序观察同一个 store API 在初始化、成功和拒绝场景中的表现。
 */
import { describe, expect, it } from 'vitest'
import { createAppearanceRowStore } from '../src/client/settings-store.ts'

// 外观设置 store 测试套件；每个用例创建独立实例，无共享清理状态。
describe('createAppearanceRowStore', () => {
  // 验证默认快照；回调无参数且不返回业务值。
  it('init shape: system preference with revision at -1', () => {
    // 新建的独立 store；初始偏好应跟随系统，版本号为 -1。
    const store = createAppearanceRowStore().create()
    expect(store.getSnapshot()).toEqual({ preference: 'system', revision: -1 })
  })

  // 验证较新版本会同步偏好并推进版本号。
  it('sync mirrors the preference and advances the revision', () => {
    // 本用例专用 store；先写 revision 0，再跳到 2。
    const store = createAppearanceRowStore().create()
    store.actions.sync('dark', 0)
    expect(store.getSnapshot()).toEqual({ preference: 'dark', revision: 0 })
    store.actions.sync('light', 2)
    expect(store.getSnapshot().preference).toBe('light')
    expect(store.getSnapshot().revision).toBe(2)
  })

  // 验证更旧或相同版本被丢弃，不能覆盖 revision 3 的值。
  it('revision guard drops stale and duplicate writes', () => {
    // 本用例专用 store；最终状态必须保持第一次写入的 dark/3。
    const store = createAppearanceRowStore().create()
    store.actions.sync('dark', 3)
    store.actions.sync('system', 2)
    store.actions.sync('system', 3)
    expect(store.getSnapshot().preference).toBe('dark')
    expect(store.getSnapshot().revision).toBe(3)
  })
})
