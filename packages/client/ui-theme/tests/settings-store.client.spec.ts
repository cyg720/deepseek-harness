/** Appearance and font-size row stores: snapshot-mirror actions and the revision guards. */
import { describe, expect, it } from 'vitest'
import { createAppearanceRowStore, createFontSizeRowStore } from '../src/client/settings-store.ts'

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

describe('createFontSizeRowStore', () => {
  it('init shape: default size with revision at -1', () => {
    const store = createFontSizeRowStore().create()
    expect(store.getSnapshot()).toEqual({ fontSize: 14, revision: -1 })
  })

  it('sync mirrors the size; the revision guard drops stale and duplicate writes', () => {
    const store = createFontSizeRowStore().create()
    store.actions.sync(16, 3)
    expect(store.getSnapshot()).toEqual({ fontSize: 16, revision: 3 })
    store.actions.sync(12, 2)
    store.actions.sync(12, 3)
    expect(store.getSnapshot().fontSize).toBe(16)
    expect(store.getSnapshot().revision).toBe(3)
  })
})
