/**
 * ================================ 文件注释 ================================
 * 【文件职责】Web 端 Session 日志下载命令：注册宿主端 /export 命令，
 *   由浏览器下载插件监听其执行结果并触发下载。
 * 【技术维度】命令注册走 effect；handler 只接受无参数调用（Web 无本地路径概念）。
 * 【产品维度】让用户用 /export 触发当前 Session 的 ZIP 归档下载。
 * 【逻辑维度】name/inject → REQUESTED 常量 → apply（注册 export 命令）。
 * 【关键边界】带参数调用返回错误（Web 命令不接受路径）。
 * 【新手阅读建议】与 client/index.ts 的 command/executed 监听对照。
 * ==========================================================================
 */

/** Web Session-log download command over the host endpoint owned by ApiProxy. */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandResult } from '@deepseek-ai/dsh-commands'

export const name = 'session-log-download'
export const inject = ['commands']

const REQUESTED: CommandResult = {
  kind: 'success',
  text: 'Session log download requested.',
}

/**
 * Register the Web-only `/export` command that the browser download plugin observes.
 * @param ctx - Host context carrying the human-command registry.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.commands.register({
    name: 'export',
    description: 'Download this Session log as a ZIP archive',
    handler: invocation => Promise.resolve(invocation.rawInput.trim() === ''
      ? REQUESTED
      : { kind: 'error', text: 'The Web /export command does not accept a path.' }),
  }), 'session-log-download: command')
}
