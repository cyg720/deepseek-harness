/**
 * 文件职责：注册 Codex Hook 桥接器的工具后处理与载荷覆盖率用例。
 * 技术维度：使用 Vitest，并一次选择共享测试矩阵的两个可独立分组。
 * 产品维度：验证工具结果回传后的 Hook 行为及其 JSON 载荷满足协议。
 * 逻辑维度：导入注册函数，并在模块加载时传入 `post-tool` 与 `payload`。
 * 关键边界：数组只决定注册哪些用例，不表示执行顺序或共享状态。
 * 新手阅读建议：先分别在共享文件中定位两个分组，再查看它们共用的夹具。
 */
import { defineCoverageCases } from './coverage-cases.ts'

/**
 * 注册工具后处理和载荷用例；参数数组选择两个分组，函数无返回值。
 * 使用示例：运行 `pnpm exec vitest run packages/hooks/hooks-codex/tests/coverage-post-tool.spec.ts`。
 */
defineCoverageCases(['post-tool', 'payload'])
