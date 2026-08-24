/**
 * The one-shot app's command-line provider: it parses the task positional and
 * `--help`, then publishes {@link HEADLESS_STARTUP_SERVICE}. The runner is an
 * ordinary consumer whose lazy config waits for that service.
 * @module @deepseek-ai/dsh-headless/startup
 */
/**
 * 中文说明：
 * - 文件职责：解析 headless 一次性运行的任务参数，并把任务作为 Cordis 服务提供给 Runner。
 * - 技术维度：使用 Commander、共享 cmdline 解析器、Cordis provide 和延迟服务注入。
 * - 产品维度：支持用户用一条命令提交任务、打印最终答复并退出，适合脚本和自动化。
 * - 逻辑维度：定义可重复创建的命令，解析 task 位置参数，拒绝空白任务，成功后发布 startup 服务。
 * - 关键边界：--help 或参数错误时不提供服务；多个 task 单词以空格连接。
 * - 新手阅读建议：先看 HeadlessStartupValues，再沿 headlessCommand 的参数定义到 apply.action 阅读。
 */

import { Command } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'

/** Stable Cordis plugin name. */
/** 中文：headless 启动插件的稳定 Cordis 名称。 */
export const name = 'headless-startup'

/** Services required before the task can be resolved. */
/** 中文：解析任务前必须由宿主提供命令行参数服务。 */
export const inject = ['cmdlineArgs']

/** Service provided by this plugin and injected by the one-shot runner. */
/** 中文：本插件提供、一次性 Runner 注入的服务名称。 */
export const HEADLESS_STARTUP_SERVICE = 'headlessStartup'

/** What the runner row reads from {@link HEADLESS_STARTUP_SERVICE}. */
/** 中文：一次性 Runner 从启动服务读取的数据。 */
export interface HeadlessStartupValues {
  /** The task text this invocation asked for. */
  /** 中文：本次命令请求执行的完整任务文本。 */
  task: string
}

/**
 * This app's command: the task positional, its description, and its help text.
 * @returns a fresh program, so one process can parse more than once (tests).
 */
/** 中文：创建新的 headless Commander 程序；无参数，返回可独立解析的 Command。 */
function headlessCommand(): Command {
  return new Command()
    .name('dsh --profile headless')
    .description('Answer one task, print the final assistant message, and exit.')
    .helpOption('-h, --help', 'show this help')
    .argument('[task...]', 'the task text; multiple words are joined by spaces')
    .addHelpText('after', `
Examples:
  dsh --profile headless "run the tests"     answer one task and exit
`)
}

/**
 * Parse and provide the one-shot task as an ordinary Cordis service. The
 * command's action publishes the task; a missing or whitespace-only task is a
 * usage error, so on rejection (and on `--help`) nothing is provided.
 * @param ctx - plugin context carrying the command line.
 */
/** 中文：解析 ctx 中的命令行并在有效时提供任务服务；无返回值。示例：apply(ctx)。 */
export function apply(ctx: Context): void {
  /** 本次解析使用的新 Commander 程序。 */
  const program = headlessCommand()
  program.action(() => {
    /** 所有 task 位置参数以单个空格连接后的完整任务文本。 */
    const task = program.args.join(' ')
    if (task.trim() === '') program.error('error: a task is required, for example: dsh --profile headless "run the tests"')
    ctx.provide(HEADLESS_STARTUP_SERVICE, { task } satisfies HeadlessStartupValues)
  })
  parseCmdline(ctx, program)
}
