/**
 * Shared process lifecycle for the generic and closed-runtime JSON-RPC bins.
 *
 * @module @deepseek-ai/dsh-sdk-jsonrpc-demo/runner
 */
/*
 * 中文说明：
 * - 文件职责：为通用和封闭运行时 JSON-RPC 示例统一启动、配置选择、信号处理与退出清理。
 * - 技术维度：使用 Node 进程事件、Cordis boot、环境变量、argv 和异步纤程释放。
 * - 产品维度：让 SDK 示例以明确外部配置启动，并在输入结束或收到信号时干净退出。
 * - 逻辑维度：安装失败处理并加载环境，解析配置优先级，启动上下文，注册幂等退出函数。
 * - 关键边界：配置必填且环境变量优先；没有内置回退，SIGINT 使用退出码 130。
 * - 新手阅读建议：先看 requested 的优先级表达式，再看 disposeAndExit 如何防止重复清理。
 */

import { existsSync } from 'node:fs'
import { boot, installFailLoud, loadEnv, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'

/* v8 ignore start -- composition over tested app-boot/jsonrpc and executable acceptance paths */
/* 中文：这里组合已测试的启动模块，覆盖由可执行文件验收负责。 */
/** JSON-RPC 示例进程的稳定名称，用于环境前缀、诊断和 usage。 */
const NAME = 'dsh-jsonrpc-agent'

/**
 * Boot the explicitly selected external configuration and own process exit.
 * @param bareModuleBaseUrl - optional installed-runtime base for bare plugins;
 * omit it when the configuration project owns its plugin packages.
 * @returns after process handlers are installed; process lifetime then belongs
 * to stdin and signal events.
 */
/*
 * 中文：启动 JSON-RPC 代理；bareModuleBaseUrl 可指定已安装插件基址，完成处理器安装后无返回数据。
 * @param bareModuleBaseUrl 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 */
export async function runJsonrpcAgent(bareModuleBaseUrl?: string): Promise<void> {
  installFailLoud(NAME)
  loadEnv(NAME)

  // Env wins over argv; empty values are absent. External config defines the deployment.
  // 中文：非空环境变量优先于 argv；外部配置完整定义部署，不提供内置默认配置。
  /** 环境变量给出的配置路径候选。 */
  const fromEnv = process.env['DSH_CORDIS_CONFIG']
  /** 第一个命令行位置参数给出的配置路径候选。 */
  const fromArgv = process.argv[2]
  /** 按环境变量优先规则选出的非空路径文本。 */
  const requested = fromEnv !== undefined && fromEnv !== ''
    ? fromEnv
    : fromArgv !== undefined && fromArgv !== '' ? fromArgv : undefined
  /** 解析后的配置绝对路径；未指定时为 undefined。 */
  const configPath = requested === undefined ? undefined : resolveConfigPath(requested, undefined)
  if (configPath === undefined || !existsSync(configPath)) {
    process.stderr.write(
      `usage: ${NAME} <path/to/cordis.yml> (or set DSH_CORDIS_CONFIG=<path>, which wins); the config is required — there is no built-in fallback\n`,
    )
    process.exit(1)
  }

  /** 已从外部配置启动的 Cordis 上下文。 */
  const ctx = await boot(NAME, configPath, undefined, undefined, bareModuleBaseUrl)
  /** 防止 stdin 和多个信号重复触发释放的标记。 */
  let exiting = false

  /** 中文：幂等释放上下文并以 code 退出进程；重复调用直接返回，Promise 无结果。 */
  async function disposeAndExit(code: number): Promise<void> {
    if (exiting) return
    exiting = true
    try {
      await ctx.fiber.dispose()
    } finally {
      process.exit(code)
    }
  }

  process.stdin.on('end', () => { void disposeAndExit(0) })
  process.on('SIGTERM', () => { void disposeAndExit(0) })
  process.on('SIGINT', () => { void disposeAndExit(130) })
}
/* v8 ignore stop */
/* 中文：可执行组合覆盖忽略区结束。 */
