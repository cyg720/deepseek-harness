/**
 * Spawn-only worker entrypoint over {@link runWorkerMain}. Executable logic stays in
 * `bootstrap.ts` for in-process coverage; real-worker tests cover this glue.
 * @module @deepseek-ai/dsh-code-runtime-worker-thread/src/worker
 */
/**
 * 文件职责：作为代码运行时 Worker 的仅生成入口，把真实端口与启动数据交给 bootstrap。
 * 技术维度：使用 Node worker_threads，并把 stdout/stderr 显式传给工作线程主函数。
 * 产品维度：模型生成的代码可在线程中执行，不阻塞 Harness 主事件循环。
 * 逻辑维度：读取 parentPort 与 workerData，拒绝主线程误载，再异步启动 worker 主逻辑。
 * 关键边界：入口必须由 Worker 创建；拆卸和消息协议由 runWorkerMain 负责。
 * 新手阅读建议：先看父端口校验，再到 bootstrap.ts 阅读完整生命周期。
 */

import { parentPort, workerData } from 'node:worker_threads'
import { runWorkerMain } from './bootstrap.ts'
import type { WorkerBootData } from './protocol.ts'

// A worker always has a parent port; guard loudly rather than run detached.
// Worker 必须有父端口；缺失说明入口被主线程错误导入，必须立即失败而不能游离运行。
if (!parentPort) throw new Error('dsh-code-runtime-worker-thread: worker entry loaded outside a worker thread')

/**
 * 启动 Worker 主逻辑；参数依次是父端口、由唯一生成方提供的启动数据和输出流。
 * 返回 Promise 被入口有意忽略，内部生命周期与错误上报由 runWorkerMain 管理。
 */
void runWorkerMain(parentPort, workerData as WorkerBootData, { stdout: process.stdout, stderr: process.stderr })
