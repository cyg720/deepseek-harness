#!/usr/bin/env node
/**
 * Command-line entry for dsh.
 * @module @deepseek-ai/dsh/bin
 */
/*
 * 中文说明：
 * - 文件职责：作为 dsh 命令行可执行入口，解析参数并把请求分派到 profile、plugin 或配置导出模式。
 * - 技术维度：采用 Node.js ESM、顶层 await、动态 import 和分层环境变量加载。
 * - 产品维度：为终端用户提供启动代理、管理插件及检查最终配置的统一命令入口。
 * - 逻辑维度：读取版本、解析 argv，再按判别字段 mode 延迟加载对应实现并执行。
 * - 关键边界：参数解析器会先处理帮助、版本和错误；默认分支只用于防止新增模式遗漏实现。
 * - 新手阅读建议：先看 parseDshArgs 的返回联合类型，再逐个阅读 switch 分支调用的三个模块。
 */

/* v8 ignore file -- built-bin acceptance exercises this self-executing dispatch. */
/* 中文：该文件导入后立即执行，覆盖率由构建后命令验收负责，因此不纳入普通单元覆盖统计。 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import { parseDshArgs } from './args.ts'

// Both the source tree (apps/cli/src) and the bundled bin (apps/cli/lib) sit
// one directory under apps/cli, so the checked-in manifest resolves with the
// same relative hop from either artifact.
function readVersion(): string {
  /** 解析后的包清单；version 在外部 JSON 输入中可能不是字符串，因此先保留 unknown 类型。 */
  const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
  ) as { version?: unknown }
  return typeof manifest.version === 'string' ? manifest.version : '0.0.0'
}

/** 已完成校验的命令调用描述；只会包含下方 switch 已声明的模式。 */
const invocation = parseDshArgs(process.argv.slice(2), readVersion())

switch (invocation.mode) {
  case 'profile': {
    /** profile 模式执行函数，仅在该模式被选择时加载，以减少其他命令的启动依赖。 */
    const { runProfile } = await import('./profile-boot.ts')
    await runProfile({
      environment: loadLayeredEnv('dsh'),
      profile: invocation.profile,
      patchFiles: invocation.patches,
      args: invocation.args,
    })
    break
  }
  case 'plugin': {
    /** 插件子命令执行函数；其数值结果直接作为进程退出码。 */
    const { runPlugin } = await import('./plugin.ts')
    process.exit(runPlugin(invocation.profile, invocation.args))
    break
  }
  case 'dump-config': {
    /** 配置导出函数；根据 profile、默认值开关和补丁文件输出解析结果。 */
    const { runDumpConfig } = await import('./dump-config.ts')
    runDumpConfig(invocation.profile, invocation.defaultOnly, invocation.patches)
    break
  }
  default:
    invocation satisfies never
    throw new Error(`dsh: unhandled invocation mode ${JSON.stringify(invocation)}`)
}
