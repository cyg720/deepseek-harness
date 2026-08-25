/** Language row store: snapshot-mirror action and the revision guard. */
/*
 * 文件职责：验证语言设置行 store 的初始镜像、同步动作和版本防回退规则。
 * 技术维度：使用 Vitest 直接操作客户端轻量 store 和不可变快照。
 * 产品维度：保证语言列表与当前选择可靠同步，旧消息不会覆盖新偏好。
 * 逻辑维度：分别覆盖空初始值、递增版本同步、过期及重复版本丢弃。
 * 关键边界：只有更大的 revision 可写入；options 顺序用于界面展示，不在 store 内重排。
 * 新手阅读建议：先看 OPTIONS，再按三个用例比较 active、options 和 revision。
 */
import { describe, expect, it } from 'vitest'
import { createLanguageRowStore } from '../src/client/settings-store.ts'

// 两个受支持语言选项的固定测试样本；id 用于存储，label 用于界面显示。
const OPTIONS = [{ id: 'zh', label: '中文' }, { id: 'en', label: 'English' }]

// 语言设置 store 测试套件。
describe('createLanguageRowStore', () => {
  // 验证空镜像和初始版本 -1。
  it('init shape: empty mirror with revision at -1', () => {
    // 本用例新建的独立 store。
    const store = createLanguageRowStore().create()
    expect(store.getSnapshot()).toEqual({ active: '', options: [], revision: -1 })
  })

  // 验证较新快照会同步选项和活动语言。
  it('sync mirrors the snapshot and advances the revision', () => {
    // 本用例独立 store，依次接收 revision 0 和 1。
    const store = createLanguageRowStore().create()
    store.actions.sync('zh', OPTIONS, 0)
    expect(store.getSnapshot()).toEqual({ active: 'zh', options: OPTIONS, revision: 0 })
    store.actions.sync('en', OPTIONS, 1)
    expect(store.getSnapshot().active).toBe('en')
    expect(store.getSnapshot().revision).toBe(1)
  })

  // 验证旧版本和重复版本不会覆盖 revision 5。
  it('revision guard drops stale and duplicate writes', () => {
    // 本用例独立 store，最终必须保持 en/5。
    const store = createLanguageRowStore().create()
    store.actions.sync('en', OPTIONS, 5)
    store.actions.sync('zh', OPTIONS, 4)
    store.actions.sync('zh', OPTIONS, 5)
    expect(store.getSnapshot().active).toBe('en')
    expect(store.getSnapshot().revision).toBe(5)
  })
})
