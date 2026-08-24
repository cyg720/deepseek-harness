/**
 * 文件职责：把 Claude Code Hook 桥接器的边缘路径用例注册为独立测试入口。
 * 技术维度：使用 Vitest，并复用共享覆盖率矩阵中的 `edge-paths` 切片。
 * 产品维度：验证少见输入、回退和异常路径不会破坏代理运行。
 * 逻辑维度：导入用例注册函数，并在模块加载时选择边缘路径分组。
 * 关键边界：本文件不定义行为预期；所有断言集中在共享用例文件中。
 * 新手阅读建议：先理解该文件是调度入口，再逐项阅读共享边缘路径用例。
 */
import { defineCoverageCases } from './coverage-cases.ts'

/**
 * 注册边缘路径覆盖率用例；参数选择 `edge-paths` 分组，函数无返回值。
 * 使用示例：运行 `pnpm exec vitest run packages/hooks/hooks-claude-code/tests/coverage-edge-paths.spec.ts`。
 */
defineCoverageCases('edge-paths')
