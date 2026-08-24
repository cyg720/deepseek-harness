/**
 * 文件职责：验证 JSON-RPC SDK 服务器保持 Cordis 命名空间插件导出形式。
 * 技术维度：使用 Vitest 和真实 Loader.unwrapExports 检查 ESM 命名导出对象。
 * 产品维度：保证运行时 Loader 能保留服务器插件的名称、依赖、配置和 apply，而不是误丢弃。
 * 逻辑维度：确认没有 default，创建 Loader 原型对象，解包命名空间，再逐项检查插件槽位。
 * 关键边界：测试必须使用真实解包逻辑；增加 stray default 会改变 Loader 对导出的选择。
 * 新手阅读建议：先理解上方英文注释描述的失败模式，再比较 jsonrpc 与 unwrapped 的对象身份。
 */
import { describe, expect, it } from 'vitest'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import * as jsonrpc from '../src/index.ts'

/**
 * Run the real namespace export through `Loader.unwrapExports`; a stray
 * default would discard `name`, `inject`, `Config`, and `apply`.
 */
/** 使用真实 Loader.unwrapExports 处理命名空间；多余 default 会导致关键插件槽位被丢弃。 */
// 测试组：覆盖 SDK JSON-RPC 服务器包的插件导出结构。
describe('dsh-sdk-jsonrpc-server plugin export shape', () => {
  /**
   * 功能描述：确认命名空间没有 default，解包后仍是原对象并保留全部 Cordis 插件槽位。
   * 参数说明：测试回调不接收参数。
   * 返回值解释：无返回值；任一导出形态不符时由 Vitest 报错。
   * 使用示例：Loader.unwrapExports(jsonrpc) 应严格等于 jsonrpc。
   */
  it('has the namespace-plugin export shape (no stray default) so the Loader keeps name/inject/Config/apply', () => {
    expect('default' in jsonrpc).toBe(false)
    expect(typeof jsonrpc.apply).toBe('function')

    // loader：只借用 Loader 原型方法的轻量实例，不执行完整 Loader 构造流程。
    const loader = Object.create(Loader.prototype) as Loader
    // unwrapped：真实解包器选择的插件导出对象，应保持原命名空间身份。
    const unwrapped = loader.unwrapExports(jsonrpc) as Record<string, unknown>
    expect(unwrapped).toBe(jsonrpc)
    expect(unwrapped.name).toBe('sdk-jsonrpc-server')
    expect(unwrapped.inject).toEqual(['agents'])
    expect(unwrapped.Config).toBeDefined()
    expect(typeof unwrapped.apply).toBe('function')
  })
})
