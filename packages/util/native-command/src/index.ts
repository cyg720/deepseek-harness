/**
 * Shared no-shell `execFile` runner for host-native OS integrations (the
 * native directory chooser, the open-with-default-application hand-off):
 * utf8 stdio capture, abort propagation, Windows console hide. A library,
 * not a plugin — no ctx, no state, no events.
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

import { execFile } from 'node:child_process'

/** Testable command boundary; native implementations never invoke a shell. */
/* 可替换测试的命令运行器类型；参数依次为命令、只读 argv 和取消信号，返回标准输出与错误输出。 */
export type NativeCommandRunner = (
  command: string,
  args: readonly string[],
  signal: AbortSignal,
) => Promise<{ stdout: string; stderr: string }>

/**
 * Run a host command with utf8 stdio, abort propagation, and Windows hide.
 * @param command - executable path or PATH name.
 * @param args - argv (never a shell string).
 * @param signal - caller/connection lifetime; abort terminates the child.
 * @returns captured stdout/stderr on exit 0.
 */
/*
 * 执行宿主命令。
 * @param command 可执行路径或 PATH 名称。
 * @param args 原始参数数组。
 * @param signal 生命周期取消信号。
 * @returns 退出码 0 时的 stdout/stderr。
 * @example await runNativeCommand('git', ['--version'], signal)。
 */
export const runNativeCommand: NativeCommandRunner = (command, args, signal) =>
  // 调用方接收的结果 Promise；resolve/reject 由 execFile 回调决定。
  new Promise((resolve, reject) => {
    execFile(
      command,
      [...args],
      { encoding: 'utf8', signal, windowsHide: true },
      // 子进程完成回调；error 为 null 表示退出成功，stdout/stderr 是 UTF-8 字符串。
      (error, stdout, stderr) => {
        if (error !== null) {
          // 扩展后的失败对象；保留原始错误原因、错误码和两路输出供诊断。
          const failure = Object.assign(new Error(error.message, { cause: error }), {
            code: error.code,
            stdout,
            stderr,
          })
          reject(failure)
          return
        }
        resolve({ stdout, stderr })
      },
    )
  })
