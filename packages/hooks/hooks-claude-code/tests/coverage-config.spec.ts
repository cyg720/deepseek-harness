/**
 * 文件职责：把 Claude Code Hook 桥接器的配置分支用例注册为独立测试入口。
 * 技术维度：使用 Vitest，并复用 `defineCoverageCases` 共享测试矩阵。
 * 产品维度：验证配置替换、选项分支和跳过警告，降低错误 Hook 配置的风险。
 * 逻辑维度：导入用例注册函数，并在模块加载时选择 `config` 分组。
 * 关键边界：本文件只选择分组，测试数据和断言均由共享用例文件维护。
 * 新手阅读建议：先看分组参数，再到 `coverage-cases.ts` 阅读 `config` 分支。
 */
import { defineCoverageCases } from './coverage-cases.ts'

/**
 * 注册配置覆盖率用例；参数 `config` 选择对应分组，函数无返回值。
 * 使用示例：运行 `pnpm exec vitest run packages/hooks/hooks-claude-code/tests/coverage-config.spec.ts`。
 */
defineCoverageCases('config')
