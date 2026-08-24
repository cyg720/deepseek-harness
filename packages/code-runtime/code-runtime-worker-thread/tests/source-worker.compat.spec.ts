/**
 * 文件职责：验证未构建的代码运行 Worker 是不依赖工作区包输出的自包含源码闭包。
 * 技术维度：使用 Node Worker、临时目录、文件复制和 Worker JSON 解码执行真实隔离探针。
 * 产品维度：保证源码启动模式在干净仓库中也能运行代码，不会偶然依赖残留 lib 产物。
 * 逻辑维度：复制五个 Worker 源文件到临时目录，启动计算任务，等待消息并解码，最后终止和删除。
 * 关键边界：Worker execArgv/env 置空以隔离工作区；finally 必须终止线程并递归清理目录。
 * 新手阅读建议：先看 files 复制范围，再跟踪 Worker 配置、message Promise、decode 和 finally。
 */
import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { expect, it } from 'vitest'
import { decodeWorkerJson } from '../src/worker-json.ts'

/**
 * Prove the unbuilt worker is a self-contained source closure. Copying it out
 * of the workspace makes any package runtime import fail even when local
 * `lib/` artifacts happen to exist.
 */
/** 证明复制到工作区外的源码 Worker 无需任何包运行时导入即可启动。 */
// 源码 Worker 兼容性用例；异步返回 Promise<void>。
it('boots the source worker without workspace package outputs', async () => {
  // 随机临时目录，模拟脱离工作区的源码闭包。
  const directory = await mkdtemp(join(tmpdir(), 'dsh-code-source-worker-'))
  // 已启动的 Worker；创建前为 undefined，finally 中按需终止。
  let worker: Worker | undefined
  try {
    // Worker 运行所需的完整源码文件集合。
    const files = ['worker.ts', 'bootstrap.ts', 'protocol.ts', 'worker-json.ts', 'output-json.ts']
    // file 是当前复制的源码文件名。
    await Promise.all(files.map(async (file) => {
      await copyFile(new URL(`../src/${file}`, import.meta.url), join(directory, file))
    }))

    // 从临时目录直接启动的 Worker 实例。
    worker = new Worker(join(directory, 'worker.ts'), {
      workerData: { code: 'return { answer: 42 }', namespaces: [], maxOutputBytes: 65_536 },
      env: {},
      execArgv: [],
    })
    // Worker 首条完成消息；错误事件会拒绝 Promise。
    const message = await new Promise<unknown>((resolve, reject) => {
      worker?.once('message', resolve)
      worker?.once('error', reject)
    })

    expect(message).toMatchObject({ type: 'done' })
    // 消息中的可选 value；先进行对象与 null 检查。
    const value = typeof message === 'object' && message !== null ? (message as { value?: unknown }).value : undefined
    expect(decodeWorkerJson(value)).toEqual({ answer: 42 })
  } finally {
    if (worker) await worker.terminate()
    await rm(directory, { recursive: true, force: true })
  }
})
