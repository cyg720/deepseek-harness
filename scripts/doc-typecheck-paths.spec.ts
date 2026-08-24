/**
 * 文件职责：验证文档类型检查把工作区源码别名映射到构建声明文件的规则。
 * 技术维度：使用 Vitest 对目录通配路径、精确入口路径和非法路径执行单元测试。
 * 产品维度：保证文档示例读取发布声明而不是源码内部实现，提前发现公开 API 漂移。
 * 逻辑维度：第一组覆盖三种合法映射，第二组确认不受支持的 source 目录明确失败。
 * 关键边界：只支持仓库约定的 packages 源码路径；任意相似目录不能静默猜测目标。
 * 新手阅读建议：先比较输入中的 src 与输出中的 lib/types，再看扩展名如何变为 d.ts。
 */
import { describe, expect, it } from 'vitest'
import { builtDeclarationPath } from './doc-typecheck-paths.ts'

// 测试组：覆盖 builtDeclarationPath 的合法映射和拒绝行为。
describe('builtDeclarationPath', () => {
  /**
   * 功能描述：确认包目录通配符和精确源码入口都映射到对应声明路径。
   * 参数说明：测试回调不接收参数。
   * 返回值解释：无返回值；任一映射不一致时由 Vitest 报错。
   * 使用示例：./packages/core/session/src/invariant.ts 映射到 lib/types/invariant.d.ts。
   */
  it('maps package source directories and exact entry files to built declarations', () => {
    expect(builtDeclarationPath('./packages/*/*/src')).toBe('./packages/*/*/lib/types')
    expect(builtDeclarationPath('./packages/runtime-diagnostics/invariants/src/index.ts'))
      .toBe('./packages/runtime-diagnostics/invariants/lib/types/index.d.ts')
    expect(builtDeclarationPath('./packages/core/session/src/invariant.ts'))
      .toBe('./packages/core/session/lib/types/invariant.d.ts')
  })

  /**
   * 功能描述：确认没有受支持 src 目标的别名被明确拒绝。
   * 参数说明：测试回调不接收参数。
   * 返回值解释：无返回值；函数未抛出指定错误时断言失败。
   * 使用示例：使用 source/index.ts 而不是 src/index.ts 应抛出 cannot map。
   */
  it('rejects aliases without a supported source target', () => {
    expect(() => builtDeclarationPath('./packages/runtime-diagnostics/invariants/source/index.ts'))
      .toThrow('cannot map workspace source path')
  })
})
