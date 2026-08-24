/**
 * Shared, non-plugin hook protocol library: matching, command execution and
 * decoding, restrictive outcome merging, durable event helpers, and detached
 * run quiescence. Claude Code and Codex bridges own their distinct payloads,
 * environment rules, matcher mode, and typed extension-point mappings.
 * @module @deepseek-ai/dsh-hook-protocol
 */
/**
 * 文件职责：集中导出 hook 协议的公共类型、匹配、执行、解码、合并、事件和后台任务工具。
 * 技术维度：采用 TypeScript ESM 重导出，把各子模块的实现汇聚为稳定的包入口。
 * 产品维度：让 Claude Code、Codex 等桥接插件复用一致的 hook 行为，同时保留各自的载荷差异。
 * 逻辑维度：依次公开基础类型、匹配器、解码器、执行器、结果合并、事件辅助函数和后台运行管理。
 * 关键边界：本文件不实现业务逻辑；参数、返回值和错误条件以对应子模块的声明为准。
 * 新手阅读建议：先从 types.ts 掌握术语，再沿 matcher、codec、runner、merge、events、detached 的顺序阅读。
 */

// 命令 hook、方言、输出和匹配模式类型；用于约束调用参数与协议数据。
export type {
  CommandHook,
  HookDialect,
  HookOutput,
  MatcherGroup,
  MatcherMode,
} from './types.ts'
// 匹配诊断与判定函数；输入匹配组和候选事件，返回诊断信息或是否匹配，具体示例见 matcher.ts。
export { matcherDiagnostic, matchesMatcher } from './matcher.ts'
// Hook 输出解码函数；输入命令输出文本，返回经过协议解析的 HookOutput，示例见 codec.ts 测试。
export { parseHookOutput } from './codec.ts'
// 默认超时时间常量与命令执行函数；超时值用于未显式配置的运行，runHook 返回执行结果。
export { DEFAULT_HOOK_TIMEOUT_MS, runHook } from './runner.ts'
// 命令执行的选项和结果类型；分别描述 runHook 的参数对象与返回对象。
export type { RunHookOptions, RunHookResult } from './runner.ts'
// 限制性合并多个 Hook 输出的函数；输入输出列表，返回不会放宽已有拒绝决定的合并结果。
export { mergeHookOutputs } from './merge.ts'
// 合并决定与完整合并结果类型；用于读取 mergeHookOutputs 的返回字段。
export type { MergedDecision, MergedHookOutcome } from './merge.ts'
// 事件追加、标准错误摘要函数及默认摘要长度；用于把 hook 调用结果写入持久会话日志。
export { appendHookInvoked, appendHookResult, DEFAULT_STDERR_SUMMARY_MAX_CHARS, summarizeStderr } from './events.ts'
// Hook 调用和结果记录类型；描述持久事件辅助函数接收的数据。
export type { HookInvocation, HookResultRecord } from './events.ts'
// 后台运行集合工厂；创建可登记任务并等待全部任务静止的管理对象。
export { createDetachedRuns } from './detached.ts'
// 后台运行管理对象类型；具体方法和返回值见 detached.ts。
export type { DetachedRuns } from './detached.ts'
