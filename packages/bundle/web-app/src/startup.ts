/**
 * The web app's command-line provider: it parses the `dsh --profile web` flag
 * family (`--host`, `--port`, `--trusted-host`, `--no-open`) and its `--help`
 * text, then provides the immutable values as {@link WEB_STARTUP_SERVICE}.
 * Ordinary rows inject that service before reading it from lazy config.
 * @module @deepseek-ai/dsh-web-app/startup
 */
/**
 * 文件职责：解析dsh --profile web专属命令行选项，并以普通Cordis服务发布不可变启动值。
 * 技术维度：使用Commander声明参数语法，并通过dsh-cmdline把帮助、错误和受控退出接入启动器。
 * 产品维度：让用户选择绑定主机、端口、信任authority和是否自动打开浏览器，同时保持部署默认值可覆盖。
 * 逻辑维度：构造新Commander程序，注册action，校验危险主机与端口，再提供webStartup服务供配置表达式读取。
 * 关键边界：显式0.0.0.0当前因远程代码执行风险拒绝；端口必须只含十进制数字；帮助时不发布服务。
 * 新手阅读建议：先看WebStartupValues，再看webCommand的选项声明，最后读apply中校验和ctx.provide。
 */

import { Command } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'

/** Stable Cordis plugin name. */
/** Cordis中注册的Web命令行提供者稳定名称。 */
export const name = 'web-startup'

/** Services required before the flags can be resolved. */
/** 解析Web参数前必须存在的内部命令行服务。 */
export const inject = ['cmdlineArgs']

/** Service provided by this ordinary plugin and injected by flag-configured rows. */
/** 当前插件提供、由依赖参数的Web条目注入的服务名。 */
export const WEB_STARTUP_SERVICE = 'webStartup'

/** What the web rows read from {@link WEB_STARTUP_SERVICE}. */
/** Web条目从webStartup服务读取的当前调用值。 */
export interface WebStartupValues {
  /** Whether this invocation opens the default browser after startup. */
  /** 当前调用是否在启动后打开默认浏览器。 */
  openBrowser: boolean
  /** `--host`, absent when the invocation did not name one. */
  /** 用户显式给出的--host；未提供时省略，让部署配置决定。 */
  host?: string
  /** `--port`, absent when the invocation did not name one. */
  /** 用户显式给出的数字--port；未提供时省略。 */
  port?: number
  /** Explicit `--trusted-host` authorities, in argument order. */
  /** 按参数顺序保留的全部显式--trusted-host authority。 */
  trustedHosts: string[]
}

/** The web flag family, as commander parsed it. */
/** Commander解析Web参数后得到的原始字符串选项。 */
interface WebOptions {
  /** 可选绑定主机字符串。 */
  host?: string
  /** --no-open反转后得到的浏览器开启布尔值。 */
  open: boolean
  /** 尚未转换为数字的可选端口字符串。 */
  port?: string
  /** 可重复trusted-host选项累计的authority列表。 */
  trustedHost?: string[]
}

/**
 * This app's command: its flags, its description, and its help text.
 * @returns a fresh program, so one process can parse more than once (tests).
 */
/** 构造新的Web Commander程序，使测试和嵌入进程可重复解析。 */
function webCommand(): Command {
  return new Command()
    .name('dsh --profile web')
    .description('Serve the DeepSeek Harness browser UI.')
    .helpOption('-h, --help', 'show this help')
    .option('--host <host>', 'bind host')
    .option('--no-open', 'do not open the Web UI in the default browser')
    .option('--port <port>', 'listen port; pass 0 to let the OS pick a free one')
    .option('--trusted-host <authority...>', 'extra authority the /api browser-trust fence accepts (host or host:port; repeatable)')
    .addHelpText('after', `
Examples:
  dsh --profile web                          serve on the composed host and port
  dsh --profile web --no-open                serve without opening a browser
  dsh --profile web --port 8080              serve on another port
`)
}

/**
 * Parse and provide the Web invocation as an ordinary Cordis service. The
 * command's action publishes the flags this invocation named; `--host 0.0.0.0`
 * or a non-numeric `--port` is a usage error, so on rejection (and on `--help`)
 * nothing is provided.
 * @param ctx - plugin context carrying the command line.
 */
export function apply(ctx: Context): void {
  // 当前插件调用专用的新Commander程序。
  const program = webCommand()
  program.action(() => {
    // Commander按WebOptions结构解析出的原始选项。
    const options = program.opts<WebOptions>()
    if (options.host === '0.0.0.0') {
      program.error('error: --host 0.0.0.0 is intentionally not supported yet for safety: it would expose remote code execution to the network; use 127.0.0.1 instead')
    }
    if (options.port !== undefined && !/^\d+$/.test(options.port)) {
      program.error(`error: --port must be a number, got ${JSON.stringify(options.port)}`)
    }
    ctx.provide(WEB_STARTUP_SERVICE, {
      openBrowser: options.open,
      ...options.host !== undefined && { host: options.host },
      ...options.port !== undefined && { port: Number(options.port) },
      trustedHosts: options.trustedHost ?? [],
    } satisfies WebStartupValues)
  })
  parseCmdline(ctx, program)
}
