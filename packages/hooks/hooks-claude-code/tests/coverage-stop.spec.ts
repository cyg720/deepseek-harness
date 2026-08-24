/**
 * 文件职责：把 Claude Code Hook 桥接器的停止行为用例注册为独立测试入口。
 * 技术维度：使用 Vitest，并通过共享 `defineCoverageCases` 测试矩阵注册用例。
 * 产品维度：验证 Hook 要求停止时，代理能按协议中止而不继续误执行。
 * 逻辑维度：导入用例注册函数，并在模块加载时选择 `stop` 分组。
 * 关键边界：停止语义的夹具和断言由共享文件拥有，本文件只负责选择。
 * 新手阅读建议：先看唯一的分组调用，再到共享文件追踪停止码与会话结果。
 */
import { defineCoverageCases } from './coverage-cases.ts'

/**
 * 注册停止行为覆盖率用例；参数 `stop` 选择对应分组，函数无返回值。
 * 使用示例：运行 `pnpm exec vitest run packages/hooks/hooks-claude-code/tests/coverage-stop.spec.ts`。
 */
defineCoverageCases('stop')
