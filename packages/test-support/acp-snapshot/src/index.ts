/**
 * ACP snapshot suite kit — the shared machinery behind the keyless snapshot
 * tier (`pnpm run test:snapshot`). Four layers, composable per example: the
 * shared subprocess/client launcher ({@link launchAcpTestAgent}), the scripted
 * scenario harness ({@link runScenario}), the pure expected-output normalizers
 * ({@link normalizeStdout} / {@link normalizeSessionLog} /
 * {@link scrubRequestHeaders} / {@link scrubSystemPrompts}), and the suite
 * factory ({@link defineAcpSnapshotSuite}) that registers a scenario table as a
 * full describe/it tree. Ordinary ACP e2e tests can use the launcher directly;
 * an example's `*.snapshot.ts` supplies only its {@link AgentUnderTest} paths,
 * snapshots directory, and {@link Scenario} table.
 *
 * NOTE: ./suite.ts imports vitest, so this package is importable only inside a
 * vitest run — a support-tier constraint stated in the README.
 *
 * @module @deepseek-ai/dsh-acp-snapshot
 */
/*
 * 文件职责：集中导出无密钥 ACP 快照测试的启动器、场景运行器、规范化工具和套件工厂。
 * 技术维度：使用 TypeScript ESM 重导出把 harness、launcher、normalize、suite 四层组合为测试支持入口。
 * 产品维度：让每个示例只声明路径和场景表即可获得一致的 ACP 转录与会话日志快照。
 * 逻辑维度：依次导出场景执行类型、代理启动类型、输出清洗函数和 Vitest 套件构建函数。
 * 关键边界：suite.ts 依赖 Vitest，因此本包只能在测试运行中导入；普通 ACP e2e 可只使用 launcher。
 * 新手阅读建议：先读 launcher/harness 了解运行，再读 normalize 了解稳定化，最后看 suite 如何注册表格。
 */

// 场景脚本执行函数及输入、权限、结果类型。
export {
  runScenario,
  type HarvestedLog,
  type InputScript,
  type InputStep,
  type PermissionAnswer,
  type RunOptions,
  type RunResult,
} from './harness.ts'
// ACP 测试代理子进程启动器及其选项、被测代理和已启动句柄类型。
export {
  launchAcpTestAgent,
  type AcpTestLaunchOptions,
  type AgentUnderTest,
  type LaunchedAcpTestAgent,
} from './launcher.ts'
// stdout、会话日志、请求头、提示词、工具模式和路径的纯快照规范化函数及选项类型。
export {
  extractSnapshotSpillPaths,
  normalizeSessionLog,
  normalizeSessionSnapshot,
  normalizeStdout,
  scrubRequestHeaders,
  scrubSessionSnapshot,
  scrubSystemPrompts,
  scrubToolSchemas,
  tokenizeSessionFixtureCwd,
  type CwdPathMode,
  type NormalizeContext,
  type NormalizeOptions,
} from './normalize.ts'
// Vitest 快照套件工厂、刷新稳定化函数和场景/套件选项类型。
export {
  defineAcpSnapshotSuite,
  refreshFixtureReplacements,
  stabilizeFixtureMessageIds,
  stabilizeRefreshLog,
  type Scenario,
  type SnapshotSuiteOptions,
} from './suite.ts'
