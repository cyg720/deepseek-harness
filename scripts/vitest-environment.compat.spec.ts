// @vitest-environment jsdom
/**
 * 文件职责：验证 Vitest 的 jsdom 环境使用隔离的浏览器存储实现。
 * 技术维度：通过 Vitest 环境指令、Node 启动参数和 Web Storage API 检查兼容性。
 * 产品维度：保证前端测试不会误用 Node 进程级存储，从而避免测试之间相互污染。
 * 逻辑维度：先检查支持 webstorage 的 Node 是否禁用进程存储，再实际读写 localStorage。
 * 关键边界：环境指令必须保持在首行；存储探针键只在当前测试环境中短暂存在。
 * 新手阅读建议：先理解首行环境指令，再分别观察启动参数断言和存储读写断言。
 */
import { describe, expect, it } from 'vitest'

// 测试组：检查 jsdom 与当前 Node 版本组合下的浏览器存储隔离行为。
describe('Vitest jsdom compatibility', () => {
  /**
   * 功能描述：确认测试使用 jsdom 的 localStorage，而不是 Node 的进程级存储。
   * 参数说明：测试回调不接收参数。
   * 返回值解释：无返回值；参数或存储断言失败时由 Vitest 报错。
   * 使用示例：写入 dsh-vitest-storage-probe 后应能读取并在测试末尾删除。
   */
  it('provides isolated browser storage instead of Node process storage', () => {
    // 条件分支：仅在当前 Node 识别 webstorage 标志时检查对应的禁用参数。
    if (process.allowedNodeEnvironmentFlags.has('--webstorage')) {
      // argument：当前遍历的 Node 启动参数，只保留精确等于 --no-webstorage 的项目。
      expect(process.execArgv.filter(argument => argument === '--no-webstorage')).toHaveLength(1)
    }
    localStorage.setItem('dsh-vitest-storage-probe', 'available')

    expect(localStorage.getItem('dsh-vitest-storage-probe')).toBe('available')
    localStorage.removeItem('dsh-vitest-storage-probe')
  })
})
