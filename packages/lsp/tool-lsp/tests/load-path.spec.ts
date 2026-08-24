/**
 * Loader export-shape guard for @deepseek-ai/dsh-tool-lsp. It is a NAMESPACE plugin with `inject`, so a
 * stray `export default apply` would make the Loader's `unwrapExports` collapse the module to the
 * bare `apply`, dropping `inject` (postmortem 0001). This verifies the namespace survives
 * `Loader.prototype.unwrapExports`; the `lsp-definition` ACP snapshot owns full app composition.
 */
/**
 * 文件职责：防止 tool-lsp 的命名空间导出被 Cordis Loader 错误折叠为单个 apply 函数。
 * 技术维度：使用 Vitest、真实 Loader.prototype.unwrapExports 和包命名空间导入检查导出集合。
 * 产品维度：保证 LSP 工具装配时保留名称、依赖和配置，避免启动后能力静默缺失。
 * 逻辑维度：先确认没有 default 导出，再解包命名空间并逐项断言关键导出。
 * 关键边界：此测试只守护加载导出形式；完整应用组合由 lsp-definition ACP 快照负责。
 * 新手阅读建议：先理解 default 导出为何触发折叠，再比较 toolLsp 与 unwrapped 的身份和字段。
 */

import { describe, expect, it } from 'vitest'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import * as toolLsp from '@deepseek-ai/dsh-tool-lsp'

// Loader 导出形式测试套件；回调无参数，内部用例展示完整检查过程。
describe('dsh-tool-lsp Loader export-shape guard', () => {
  // 验证无默认导出且命名空间字段完整；异步参数和返回值均无。
  it('has no default export and keeps name/inject/Config through unwrapExports', () => {
    expect('default' in toolLsp).toBe(false)

    // 仅继承 Loader 原型的轻量实例；无需运行构造器即可调用纯解包方法。
    const loader = Object.create(Loader.prototype) as Loader
    // Loader 解包结果；对合法命名空间插件应与原始 toolLsp 是同一对象。
    const unwrapped = loader.unwrapExports(toolLsp) as Record<string, unknown>
    expect(unwrapped).toBe(toolLsp)
    expect(unwrapped.name).toBe('tool-lsp')
    expect(unwrapped.inject).toEqual(['tools', 'lsp', 'systemPrompt'])
    expect(typeof unwrapped.apply).toBe('function')
    expect(unwrapped.Config).toBeDefined()
  })
})
