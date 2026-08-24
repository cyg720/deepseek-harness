/**
 * 文件职责：注册 Codex Hook 桥接器的提示词决策与边缘路径覆盖率用例。
 * 技术维度：使用 Vitest，并通过共享测试矩阵同时选择两个分组。
 * 产品维度：验证用户提示提交决策及少见路径能正确映射到代理生命周期。
 * 逻辑维度：导入注册函数，并在模块加载时选择 `prompt` 和 `edge-paths`。
 * 关键边界：分组数组不改变断言语义；共享文件仍是测试行为的唯一来源。
 * 新手阅读建议：先阅读提示词主路径，再用边缘路径分组补充异常情况。
 */
import { defineCoverageCases } from './coverage-cases.ts'

/**
 * 注册提示词与边缘路径用例；参数数组选择两个分组，函数无返回值。
 * 使用示例：运行 `pnpm exec vitest run packages/hooks/hooks-codex/tests/coverage-prompt.spec.ts`。
 */
defineCoverageCases(['prompt', 'edge-paths'])
