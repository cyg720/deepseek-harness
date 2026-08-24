/**
 * Real-load-path guard for @deepseek-ai/dsh-mcp-client. `mcp-client` is a
 * NAMESPACE plugin with `inject` — so a stray `export default apply` would
 * make the cordis Loader's `unwrapExports` (`exports.default ?? exports`)
 * collapse the module to the bare `apply` function, DROPPING `inject`. The
 * plugin would then read `ctx.tools` without having injected it and throw
 * `cannot get property … without inject` the moment it loads (postmortem 0001).
 *
 * This test unwraps the module through the REAL `Loader.prototype.unwrapExports`
 * and verifies the namespace shape is preserved.
 */
/**
 * 文件职责：守护 MCP 客户端插件的真实 Loader 命名空间导出形式。
 * 技术维度：使用 Vitest、真实 Loader.prototype.unwrapExports 和 TypeScript 命名空间导入。
 * 产品维度：防止默认导出使 inject 丢失，从而导致插件启动时无法访问 tools 服务。
 * 逻辑维度：确认无 default，创建轻量 Loader，解包模块并断言名称、依赖、apply 和 Config。
 * 关键边界：只验证加载路径导出形式，不替代 MCP 协议或连接行为测试。
 * 新手阅读建议：先理解顶部描述的 default 折叠风险，再逐项比较 mcpClient 与 unwrapped。
 */

import { describe, expect, it } from 'vitest'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import * as mcpClient from '@deepseek-ai/dsh-mcp-client'

// MCP 客户端真实加载路径测试套件。
describe('dsh-mcp-client real-load-path guard', () => {
  // 验证命名空间不被折叠且关键导出完整。
  it('has no default export and keeps name/inject/Config through unwrapExports', () => {
    expect('default' in mcpClient).toBe(false)

    // 仅继承 Loader 原型的轻量对象，避免运行无关构造逻辑。
    const loader = Object.create(Loader.prototype) as Loader
    // 解包后的导出记录；正确情况下与原命名空间是同一对象。
    const unwrapped = loader.unwrapExports(mcpClient) as Record<string, unknown>
    expect(unwrapped).toBe(mcpClient)
    expect(unwrapped.name).toBe('mcp-client')
    expect(unwrapped.inject).toEqual(['tools'])
    expect(typeof unwrapped.apply).toBe('function')
    expect(unwrapped.Config).toBeDefined()
  })
})
