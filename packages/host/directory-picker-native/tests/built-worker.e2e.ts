/**
 * Keyless built-artifact guard (the `dsh-workflow-worker-thread` built-worker
 * shape): plain `node` runs `lib/worker.cjs` and the bundle reaches its
 * real koffi requires. POSIX hosts prove the load path end to end through
 * the deterministic ole32 rejection; win32 skips (a real dialog would
 * open), where the win32-only smoke in win32-dialog.spec.ts covers the
 * source plane instead. Skips until a build produces the artifact.
 */
/*
 * 文件职责：验证原生目录选择器构建后的 CommonJS Worker 能由普通 Node 加载并报告原生表面错误。
 * 技术维度：使用 Vitest 条件跳过、Node child_process IPC 和构建产物消息类型。
 * 产品维度：防止发布 Worker bundle 遗漏 koffi 等真实依赖，导致安装后无法打开目录对话框。
 * 逻辑维度：产物存在且非 Windows 时启动子进程，等待 IPC 消息，断言错误类型和 ole32/koffi 诊断。
 * 关键边界：Windows 会打开真实对话框所以跳过；未构建 lib/worker.cjs 也跳过，超时 30 秒。
 * 新手阅读建议：先看 builtWorker 与 skipIf，再跟踪 spawn、IPC Promise 和最终错误断言。
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Win32DialogWorkerMessage } from '../src/win32-dialog-worker.ts'

// 构建后目录选择 Worker 的绝对路径。
const builtWorker = fileURLToPath(new URL('../lib/worker.cjs', import.meta.url))

// 构建 Worker 测试套件；缺产物或 Windows 平台时跳过。
describe.skipIf(!existsSync(builtWorker) || process.platform === 'win32')('built dialog worker (lib/worker.cjs)', () => {
  // 验证普通 Node 加载 bundle 并通过 IPC 返回预期原生依赖错误。
  it('loads under plain node and reports the native-surface failure', async () => {
    // Worker 返回的首条类型化消息；进程错误或提前退出会拒绝。
    const message = await new Promise<Win32DialogWorkerMessage>((resolve, reject) => {
      // 带 IPC 通道的普通 Node 子进程；标题环境变量只用于稳定探针上下文。
      const child = spawn(process.execPath, [builtWorker], {
        env: { ...process.env, DSH_DIALOG_TITLE: 'Built-artifact guard' },
        stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      })
      child.on('message', resolve)
      child.on('error', reject)
      // code 是未报告消息便退出时的退出码。
      child.on('exit', (code) => {
        reject(new Error(`worker exited (${code}) before reporting`))
      })
    })
    expect(message.kind).toBe('error')
    expect((message as { kind: 'error'; message: string }).message).toMatch(/ole32|koffi/i)
  }, 30_000)
})
