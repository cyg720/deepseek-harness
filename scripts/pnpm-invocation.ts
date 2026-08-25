/** Resolve shell-free child-process invocations for the pnpm process that launched a package script. */
/*
 * 文件职责：从包生命周期环境解析可直接交给子进程 API 的 pnpm 命令与参数。
 * 技术维度：读取 npm_execpath，区分 JavaScript 入口和原生可执行文件，避免经过命令行 shell。
 * 产品维度：让仓库脚本在不同 pnpm 安装方式和操作系统上稳定启动嵌套命令。
 * 逻辑维度：校验入口存在；脚本入口使用当前 Node 执行，否则直接执行入口，并复制调用参数。
 * 关键边界：必须通过 pnpm run 启动以提供 npm_execpath；返回参数不可拼接为 shell 字符串。
 * 新手阅读建议：先看缺失环境变量的失败分支，再比较 js 入口和可执行入口的 command 差异。
 */

/**
 * Resolve pnpm's executable and arguments from its lifecycle environment.
 * @param args - Arguments to pass to pnpm.
 * @param environment - Lifecycle environment containing `npm_execpath`.
 * @returns A command and argument array suitable for `spawn` or `spawnSync` without a shell.
 */
/*
 * 解析当前 pnpm 生命周期的无 shell 子进程调用。
 * @param args - 传给 pnpm 的只读参数列表。
 * @param environment - 含 npm_execpath 的生命周期环境，默认使用 process.env。
 * @returns 适合 spawn 或 spawnSync 的 command 与可变参数数组。
 * @example pnpmInvocation(['run', 'build'])。
 */
export function pnpmInvocation(
  args: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
): { command: string; args: string[] } {
  // entrypoint：pnpm 生命周期提供的实际入口，可能是 JS 文件或平台可执行文件。
  const entrypoint = environment.npm_execpath
  if (entrypoint === undefined || entrypoint === '') {
    throw new Error('pnpm invocation: npm_execpath is unavailable; invoke the script through pnpm run.')
  }
  if (/\.[cm]?js$/iu.test(entrypoint)) {
    return { command: process.execPath, args: [entrypoint, ...args] }
  }
  return { command: entrypoint, args: [...args] }
}
