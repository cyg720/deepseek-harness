/**
 * Session-log snapshot support behind the keyless snapshot tier
 * (`pnpm run test:snapshot`). The current ACP adapter has four layers: the
 * shared subprocess/client launcher ({@link launchAcpTestAgent}), the scripted
 * scenario harness ({@link runScenario}), the pure expected-output normalizers
 * ({@link normalizeStdout} / {@link normalizeSessionLog} /
 * {@link scrubRequestHeaders} / {@link scrubSystemPrompts}), and the suite
 * factory ({@link defineAcpSnapshotSuite}) that registers a scenario table as a
 * full describe/it tree. Transport-neutral normalizers and fixture invariants
 * remain reusable by other profile adapters. Ordinary ACP e2e tests can use the launcher directly;
 * the ACP corpus adapter supplies only its {@link AgentUnderTest} paths,
 * snapshots directory, and {@link Scenario} table.
 *
 * NOTE: ./suite.ts imports vitest, so this package is importable only inside a
 * vitest run — a support-tier constraint stated in the README.
 *
 * @module @deepseek-ai/dsh-session-snapshot
 * @remarks 文件说明：文件职责：实现 test-support/session-snapshot 中 index 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * test-support/session-snapshot 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */

export {
  redactSessionSnapshotIds,
} from './identity.ts'
export {
  runScenario,
  snapshotSpillRoot,
  type HarvestedLog,
  type InputScript,
  type InputStep,
  type PermissionAnswer,
  type RunOptions,
  type RunResult,
} from './harness.ts'
export {
  launchAcpTestAgent,
  materializeProfilePatch,
  type AcpTestLaunchOptions,
  type AgentUnderTest,
  type LaunchedAcpTestAgent,
} from './launcher.ts'
export {
  extractSnapshotSpillPaths,
  normalizeSessionFormatProvenance,
  normalizeSessionLog,
  normalizeSessionSnapshot,
  normalizeSessionSnapshots,
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
export {
  parseSnapshotManifest,
  writesCurrentSessionFixtures,
  type SnapshotHeaderManifest,
  type SnapshotInputAttachment,
  type SnapshotInputManifest,
  type SnapshotManifest,
  type SnapshotPermission,
  type SnapshotPlatform,
  type SnapshotProfile,
  type SnapshotRecording,
  type SnapshotReplayManifest,
  type SnapshotSessionReference,
  type SnapshotSessionFormatCoverage,
  type SnapshotSessionFormatManifest,
  type SnapshotSessionWriteMode,
  type SnapshotWorkspaceManifest,
} from './manifest.ts'
export {
  assertPersistedSessionVersion,
  assertSessionFixtureVersion,
  latestPersistedSessionPaths,
  parsePersistedSessionFilename,
  parseSessionFixtureName,
  persistedSessionFilename,
  sessionFixtureFiles,
  sessionFixtureName,
  sessionFixtureNames,
  sessionHeaderVersion,
  type PersistedSessionFile,
  type SessionFixtureFile,
} from './session-files.ts'
export {
  formatSystemPromptSnapshot,
  formatToolSchemasSnapshot,
  fixtureContext,
  headerChangeCount,
  defineAcpSnapshotSuite,
  normalizedHeaders,
  normalizedSystemPrompts,
  normalizedToolSchemas,
  parseToolSchemasSnapshot,
  refreshFixtureReplacements,
  restorePinnedToolSchemas,
  stabilizeFixtureMessageIds,
  stabilizeRefreshLog,
  type Scenario,
  type SnapshotSuiteOptions,
} from './suite.ts'
export {
  captureExpectedWorkspaceSnapshot,
  captureWorkspaceSnapshot,
  EMPTY_WORKSPACE_MARKER,
  type CaptureWorkspaceSnapshotOptions,
  type WorkspaceBinaryFileSnapshot,
  type WorkspaceEmptyDirectorySnapshot,
  type WorkspaceSnapshotEntry,
  type WorkspaceSymlinkSnapshot,
  type WorkspaceTextFileSnapshot,
} from './workspace.ts'
