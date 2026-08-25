/**
 * Browser-language pin for specs that assert localized copy. A fresh
 * LocaleRuntime with no stored preference opens in the language `navigator`
 * asks for, and jsdom reports the runner's own (`en-US`) — so a spec asserting
 * the product's Chinese copy states the browser it assumes instead of
 * inheriting the machine's.
 */
/*
 * 文件职责：为断言本地化文案的客户端测试固定浏览器语言环境。
 * 技术维度：使用 Vitest 生命周期钩子和 Object.defineProperty 临时覆盖只读 navigator 属性。
 * 产品维度：避免测试结果随开发机语言变化，使中文或其他语言界面断言稳定复现。
 * 逻辑维度：beforeEach 写入首选语言列表，afterEach 删除自有属性以恢复环境原型访问器。
 * 关键边界：必须在测试套件级调用；标签应符合 BCP 47，清理不能给只读属性直接赋值。
 * 新手阅读建议：先看 primary/rest 如何组成 languages，再理解删除自有属性为何能恢复环境值。
 */
import { afterEach, beforeEach } from 'vitest'

/**
 * Pin `navigator.languages`/`navigator.language` for every test in the
 * calling file (or describe block), restoring the environment's own values
 * afterwards. Call at suite level, like the other vitest hooks.
 * @param primary - most preferred BCP 47 tag; also becomes `navigator.language`.
 * @param rest - further tags in preference order.
 */
/*
 * 为调用处的每个测试固定浏览器语言。
 * @param primary 第一首选 BCP 47 标签，同时成为 navigator.language。
 * @param rest 其余按优先级排列的语言标签。
 * @returns 无返回值，函数只登记测试钩子。
 * @example usePinnedBrowserLanguages('zh-CN', 'en-US')。
 */
export function usePinnedBrowserLanguages(primary: string, ...rest: string[]): void {
  beforeEach(() => {
    Object.defineProperty(navigator, 'languages', { value: [primary, ...rest], configurable: true })
    Object.defineProperty(navigator, 'language', { value: primary, configurable: true })
  })
  afterEach(() => {
    // Deleting the own properties uncovers the environment's own accessors
    // again (Navigator declares both readonly, hence the erased receiver).
    // 删除自有属性后会重新暴露环境原型上的访问器；因为 Navigator 声明只读，此处先擦除类型。
    // 被擦除类型后的 navigator 引用；只用于删除本函数创建的两个自有属性。
    const own = navigator as unknown as Record<string, unknown>
    delete own.languages
    delete own.language
  })
}
