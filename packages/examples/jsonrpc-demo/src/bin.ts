#!/usr/bin/env node
/**
 * Generic JSON-RPC agent bin. External configurations own their bare plugin
 * packages; the packaged runtime uses `packaged-bin.ts` instead.
 *
 * @module @deepseek-ai/dsh-sdk-jsonrpc-demo/bin
 */
/*
 * 文件职责：作为通用 JSON-RPC Agent 命令行入口启动外部 Cordis 配置。
 * 技术维度：使用 Node shebang、顶层 await 和共享 `runJsonrpcAgent` 运行器。
 * 产品维度：用户可用自己的插件依赖与 cordis.yml 启动 stdio JSON-RPC 服务。
 * 逻辑维度：导入运行器并无参数执行，由运行器发现配置和管理进程退出。
 * 关键边界：裸插件必须由外部环境安装；封闭运行时应使用 packaged-bin.ts。
 * 新手阅读建议：先看这个薄入口，再到 runner.ts 理解配置发现和退出处理。
 */

import { runJsonrpcAgent } from './runner.ts'

/** 启动通用 JSON-RPC Agent；无显式参数，完成时解析，失败时由运行器设置退出结果。 */
await runJsonrpcAgent()
