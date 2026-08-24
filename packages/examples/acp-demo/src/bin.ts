#!/usr/bin/env node
/**
 * Boot an ACP stdio server from `cordis.yml`; usage is
 * `dsh-acp-demo [--config path]`, defaulting to `./cordis.yml`. Shared env
 * loading, Loader guards, snapshot config selection, and settled-tree boot live
 * in dsh-app-boot. Replay skips `.env` and selects sibling
 * `cordis.snapshot.yml` so a stray key cannot trigger a model call. EOF disposes
 * and flushes snapshot runs; the calling automation owns process lifetime. Stdout is
 * reserved for JSON-RPC, so diagnostics go only to stderr.
 * @module @deepseek-ai/dsh-acp-demo/bin
 */
/**
 * 文件职责：从 Cordis 配置启动基于标准输入输出的 ACP 自动化服务器。
 * 技术维度：使用 Node.js ESM、parseArgs、顶层 await 和 dsh-app-boot 共享启动辅助函数。
 * 产品维度：提供可直接运行及可快照重放的 ACP 演示入口，供自动化客户端连接。
 * 逻辑维度：安装失败即报错处理，识别快照模式，加载环境，解析配置路径，启动并在回放 EOF 时释放。
 * 关键边界：stdout 专用于 JSON-RPC；replay 不加载 .env，进程生命周期通常由调用自动化管理。
 * 新手阅读建议：先看 NAME 和 snapshotMode，再按 loadEnv、parseArgs、boot、stdin end 顺序阅读。
 */

import { parseArgs } from 'node:util'
import { boot, installFailLoud, loadEnv, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'

// CLI 和诊断使用的稳定程序名。
const NAME = 'dsh-acp-demo'

/* v8 ignore start -- thin self-executing composition over the unit-tested
   dsh-app-boot helpers; exercised end-to-end by the snapshot suite and the
   built-bin smoke */
/* v8 忽略此薄装配入口：辅助函数由单元测试覆盖，完整行为由快照和构建后冒烟测试覆盖。 */
installFailLoud(NAME)
// 当前快照模式；undefined 表示普通运行，replay 表示无真实模型调用的重放。
const snapshotMode = process.env['DSH_SNAPSHOT']
if (snapshotMode !== 'replay') loadEnv(NAME)
// 解析后的命令行选项；values.config 可为空，-c 是 --config 的短形式。
const { values } = parseArgs({
  args: process.argv.slice(2),
  options: { config: { type: 'string', short: 'c' } },
  strict: true,
})
// 已完成装配的 Cordis 上下文；配置路径会按普通或快照模式解析。
const ctx = await boot(NAME, resolveConfigPath(values.config ?? './cordis.yml', snapshotMode))
if (snapshotMode !== undefined) {
  // 快照模式的 EOF 回调；先异步释放 fiber，再以成功状态结束进程。
  process.stdin.on('end', () => {
    void ctx.fiber.dispose().then(() => { process.exit(0) })
  })
}
/* v8 ignore stop */
