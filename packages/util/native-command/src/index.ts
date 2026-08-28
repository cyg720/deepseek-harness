/**
 * Host-native command execution and path-opening utilities.
 * @module @deepseek-ai/dsh-native-command
 */
/*
 * 文件职责：提供不经过 shell 的宿主原生命令执行边界。
 * 技术维度：封装 Node execFile，统一 UTF-8 输出、AbortSignal 取消和 Windows 隐藏控制台行为。
 * 产品维度：支持目录选择器和默认应用打开等系统集成，同时避免 shell 注入与窗口闪烁。
 * 逻辑维度：复制 argv 后执行命令；失败包装错误并保留 code/stdout/stderr，成功返回两路输出。
 * 关键边界：只接受可执行文件与参数数组，不解析 shell 字符串；退出非零会拒绝 Promise。
 * 新手阅读建议：先看 NativeCommandRunner 类型，再比较 execFile 回调的错误和成功分支。
 */

export { runNativeCommand } from './runner.ts'
export type { NativeCommandRunner } from './runner.ts'
export {
  canOpenNativePath,
  openNativePath,
  openNativeTextFile,
} from './path-opener.ts'
export type {
  PathOpenerInternals,
  PathOpenerRunner,
} from './path-opener.ts'
