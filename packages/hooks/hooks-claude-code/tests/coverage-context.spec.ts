/**
 * 文件职责：把 Claude Code Hook 桥接器的上下文分支用例注册为独立测试入口。
 * 技术维度：使用 Vitest，并通过 `defineCoverageCases` 选择共享测试矩阵切片。
 * 产品维度：验证发送给 Hook 的会话与工具上下文保持完整和准确。
 * 逻辑维度：导入用例注册函数，并在模块加载时选择 `context` 分组。
 * 关键边界：这里只拆分测试调度，不复制共享夹具或断言。
 * 新手阅读建议：先识别分组名，再到共享用例文件查找 `context` 条件块。
 */
import { defineCoverageCases } from './coverage-cases.ts'

/**
 * 注册上下文覆盖率用例；参数 `context` 选择对应分组，函数无返回值。
 * 使用示例：运行 `pnpm exec vitest run packages/hooks/hooks-claude-code/tests/coverage-context.spec.ts`。
 */
defineCoverageCases('context')
