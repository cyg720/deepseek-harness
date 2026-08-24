/**
 * 文件职责：把 Codex Hook 桥接器的结果字段用例注册为独立测试入口。
 * 技术维度：使用 Vitest，并复用 `defineCoverageCases` 的结果字段测试切片。
 * 产品维度：验证 Hook 返回内容能按协议字段转换，避免错误结果进入代理流程。
 * 逻辑维度：导入用例注册函数，并在模块加载时选择 `result-shape` 分组。
 * 关键边界：本文件只控制测试调度；结果解析预期由共享用例文件维护。
 * 新手阅读建议：先看分组参数，再到共享文件追踪输入字段到内部结果的映射。
 */
import { defineCoverageCases } from './coverage-cases.ts'

/**
 * 注册结果字段覆盖率用例；参数选择 `result-shape` 分组，函数无返回值。
 * 使用示例：运行 `pnpm exec vitest run packages/hooks/hooks-codex/tests/coverage-result-shape.spec.ts`。
 */
defineCoverageCases('result-shape')
