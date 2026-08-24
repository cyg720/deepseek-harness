/**
 * Single-statement worker entry that boots `runWorkerSession` on real `parentPort`. Logic remains in
 * the session module for in-process MessageChannel coverage; importing this entry on the main thread
 * exercises `requireParentPort`'s failure path.
 * @module @deepseek-ai/dsh-workflow-worker-thread/worker
 */
/**
 * 文件职责：作为工作流 Worker 的生成入口，把真实父端口和初始化数据交给会话运行器。
 * 技术维度：使用 Node worker_threads，并由 `requireParentPort` 统一校验端口存在性。
 * 产品维度：模型编写的编排脚本可离开主线程执行，并通过端口请求子代理能力。
 * 逻辑维度：读取 Worker 边界数据、校验父端口、启动异步工作流会话。
 * 关键边界：只有引擎能生成符合 WorkerInit 的数据；主线程误载必须立即失败。
 * 新手阅读建议：先看唯一启动语句，再到 session.ts 学习消息与拆卸生命周期。
 */

import { parentPort, workerData } from 'node:worker_threads'
import { requireParentPort, runWorkerSession } from './session.ts'
import type { WorkerInit } from './types.ts'

// workerData is `any` at the node:worker_threads boundary; the engine is the
// only spawner and always provides a WorkerInit.
// worker_threads 把 workerData 暴露为 any；唯一生成方引擎保证它满足 WorkerInit。
/** 启动工作流会话；返回 Promise 由 Worker 生命周期拥有，入口不等待其业务结果。 */
void runWorkerSession(requireParentPort(parentPort), workerData as WorkerInit)
