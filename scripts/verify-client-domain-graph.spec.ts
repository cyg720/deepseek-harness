/**
 * 文件职责：验证客户端领域依赖图工具对相对导入路径的解析规则。
 * 技术维度：使用 Vitest 对 resolveClientImport 的路径归一化结果进行单元测试。
 * 产品维度：帮助客户端包维持清晰的领域依赖关系，降低模块移动和扩展时的误引用风险。
 * 逻辑维度：分别覆盖离开 src/client 的导入和 src/client 内跨领域的导入。
 * 关键边界：这里只测试路径字符串转换，不访问文件系统，也不判断目标文件是否真实存在。
 * 新手阅读建议：先比较每个用例的输入与期望输出，再阅读被测函数中的路径分段逻辑。
 */
import { describe, expect, it } from 'vitest'
import { resolveClientImport } from './verify-client-domain-graph.ts'

// 测试组：覆盖客户端领域导入路径的两类基本解析场景。
describe('client domain import resolution', () => {
  /**
   * 功能描述：确认顶层客户端文件向 src/client 外部导入时保留原路径。
   * 参数说明：测试回调不接收参数。
   * 返回值解释：无返回值；断言失败时由 Vitest 报告差异。
   * 使用示例：styles.ts 导入 ../styles/base.css?inline 时应保留查询参数和相对路径。
   */
  it('preserves imports that leave src/client from a top-level file', () => {
    expect(resolveClientImport('styles.ts', '../styles/base.css?inline'))
      .toBe('../styles/base.css?inline')
  })

  /**
   * 功能描述：确认 src/client 内部跨领域导入被转换为从领域根开始的路径。
   * 参数说明：测试回调不接收参数。
   * 返回值解释：无返回值；断言失败时由 Vitest 报告差异。
   * 使用示例：input/hub.ts 导入 ../queue/store.ts 时得到 queue/store.ts。
   */
  it('normalizes imports between domains inside src/client', () => {
    expect(resolveClientImport('input/hub.ts', '../queue/store.ts'))
      .toBe('queue/store.ts')
  })
})
