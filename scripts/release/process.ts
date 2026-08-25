/**
 * Process helpers shared by the release scripts: the release steps drive `git`,
 * `pnpm`, `npm`, and `tar`, and each needs one of three failure behaviours.
 */
/*
 * 文件职责：实现 process.ts 覆盖的发布、门禁、翻译配对或仓库维护职责。
 * 技术维度：使用 TypeScript、Vitest、Node.js 文件系统、Git、包管理器或构建产物校验。
 * 产品维度：保障项目发布物、文档配对和 CI 门禁保持一致且可追踪。
 * 逻辑维度：解析参数与仓库状态，执行检查或发布步骤，再输出诊断和退出状态。
 * 关键边界：发布与 Git 操作会改变外部状态；失败必须显式停止；路径和命令输出不可信。
 * 新手阅读建议：先看入口参数和只读检查，再读状态变更步骤，最后关注回滚、错误码和平台差异。
 */

import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Where and with what environment a release step runs a command. */
/* 中文说明：interface RunOptions 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
export interface RunOptions {
  /** Working directory; defaults to the current one. */
  readonly cwd?: string
  /** Child environment; defaults to this process's. */
  readonly env?: NodeJS.ProcessEnv
}

/** What a command produced, for a caller that decides what a failure means. */
/* 中文说明：interface CommandResult 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
export interface CommandResult {
  /** Exit status, or null when a signal ended the process. */
  readonly status: number | null
  /** Captured standard output. */
  readonly stdout: string
  /** Captured standard error. */
  readonly stderr: string
}

/**
 * Run a command and capture its output without judging the exit status.
 * @param command - executable name.
 * @param args - command arguments.
 * @param options - working directory and environment.
 * @returns The exit status and captured streams.
 */
/* 中文说明：函数 attempt 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function attempt(command: string, args: readonly string[], options: RunOptions = {}): CommandResult {
  /** 中文说明：变量 result 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const result = spawnSync(command, [...args], { cwd: options.cwd, env: options.env, encoding: 'utf8' })
  if (result.error !== undefined) throw result.error
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

/**
 * Run a command, capture its output, and echo it once the command exits.
 *
 * A step that both shows what a command said and classifies its own failure
 * needs both halves: the output has to reach the workflow log, and the caller has
 * to read it to decide whether a failure is worth retrying.
 *
 * This is not live progress. `spawnSync` returns only after the child exits, so
 * nothing appears while the command runs, and the two streams are echoed one
 * after the other — all of stdout, then all of stderr — which loses their
 * interleaving. For an npm publish that matters in one visible way: `npm notice`
 * lines go to stderr while the `+ name@version` confirmation goes to stdout, so
 * the log shows the confirmation first. Live progress would need an
 * asynchronous spawn with data listeners.
 * @param command - executable name.
 * @param args - command arguments.
 * @param options - working directory and environment.
 * @returns The exit status and captured streams.
 */
/* 中文说明：函数 attemptEchoed 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function attemptEchoed(command: string, args: readonly string[], options: RunOptions = {}): CommandResult {
  /** 中文说明：变量 result 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const result = spawnSync(command, [...args], {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    // 'inherit' would leave nothing to capture, so the streams are piped and
    // echoed instead.
    stdio: ['inherit', 'pipe', 'pipe'],
  })
  if (result.error !== undefined) throw result.error
  if (result.stdout !== '') process.stdout.write(result.stdout)
  if (result.stderr !== '') process.stderr.write(result.stderr)
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

/**
 * Run a command, capture its standard output, and fail on a non-zero exit.
 * @param command - executable name.
 * @param args - command arguments.
 * @param options - working directory and environment.
 * @returns The trimmed standard output.
 */
/* 中文说明：函数 capture 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function capture(command: string, args: readonly string[], options: RunOptions = {}): string {
  /** 中文说明：变量 result 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const result = attempt(command, args, options)
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${String(result.status)}:\n${result.stdout}\n${result.stderr}`)
  }
  return result.stdout.trim()
}

/**
 * Run a command with inherited streams, so its progress reaches the log, and
 * fail on a non-zero exit.
 * @param command - executable name.
 * @param args - command arguments.
 * @param options - working directory and environment.
 */
/* 中文说明：函数 run 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function run(command: string, args: readonly string[], options: RunOptions = {}): void {
  /** 中文说明：变量 result 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const result = spawnSync(command, [...args], { cwd: options.cwd, env: options.env, stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${String(result.status)}`)
}

/**
 * Whether this module is the process entry point.
 *
 * The release scripts are both commands and modules: a test imports their pure
 * logic, and importing a module runs its body, so an unguarded `main()` would
 * run the wrong command with the wrong arguments.
 * @param moduleUrl - the caller's `import.meta.url`.
 * @returns True when Node started this module.
 */
/* 中文说明：函数 isEntry 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function isEntry(moduleUrl: string): boolean {
  /** 中文说明：变量 invoked 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const invoked = process.argv[1]
  if (invoked === undefined) return false
  return realpathSync(invoked) === realpathSync(fileURLToPath(moduleUrl))
}
