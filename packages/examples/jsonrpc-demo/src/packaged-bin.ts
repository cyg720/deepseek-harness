#!/usr/bin/env node
/**
 * Closed-runtime JSON-RPC agent bin. Bare plugins resolve from the installed
 * runtime closure while relative plugins remain configuration-relative.
 *
 * @module @deepseek-ai/dsh-sdk-jsonrpc-demo/packaged-bin
 */
/**
 * 文件职责：作为封闭运行时中的 JSON-RPC Agent 命令行入口。
 * 技术维度：使用 Node shebang、顶层 await，并以当前模块 URL 定位已安装运行闭包。
 * 产品维度：Python 等打包载体无需外部安装裸插件即可启动 JSON-RPC 服务。
 * 逻辑维度：导入共享运行器，把 `import.meta.url` 作为运行时定位基准传入。
 * 关键边界：相对插件仍按配置路径解析；该入口主要由打包载体以子进程执行。
 * 新手阅读建议：先与 bin.ts 比较唯一参数差异，再阅读 runner.ts 的解析分支。
 */

import { runJsonrpcAgent } from './runner.ts'

/* v8 ignore next -- exercised through the built Python runtime carriers */
/* 该入口由构建后的 Python 运行时载体覆盖，单元覆盖率不会在当前进程观察到它。 */
await runJsonrpcAgent(import.meta.url)
