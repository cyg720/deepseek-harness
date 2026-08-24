/** Bare Vite must fail before it can present a bootless shell as a working GUI. */
/** 裸 Vite 必须在把缺少主机能力的空壳误呈现为可用界面前明确失败。 */
/**
 * 文件职责：验证 apps/web 不能作为独立 Vite 应用启动，并向开发者提示使用完整 dsh web 主机。
 * 技术维度：使用 Vitest、execa、临时目录、TCP 空闲端口探测和 Node 预加载探针。
 * 产品维度：防止开发者误以为无后端空壳是正常 Web 应用，减少错误调试路径。
 * 逻辑维度：分别运行包级 dev 别名和裸 Vite，检查失败说明，并证明服务器从未真正监听。
 * 关键边界：端口探测释放后存在短暂竞争；子进程必须限时；临时探针目录需要清理。
 * 新手阅读建议：先读 freePort，再看两个测试对不同启动入口的失败文本和监听标记断言。
 */

import { fileURLToPath, pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'

/** apps/web 包根目录的绝对路径。 */
const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url))

/** Reserve an available loopback port, then release it for the child invocation. */
/** 临时占用本机端口后释放并返回端口号。示例：await freePort()。 */
async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('port probe returned no address')
  await new Promise<void>((resolve, reject) => server.close((error) => {
    if (error === undefined) resolve()
    else reject(error)
  }))
  return address.port
}

describe('Web development entry', () => {
  it('rejects the package dev alias with the full-host correction', async () => {
    const result = await execa('pnpm', ['run', 'dev'], { cwd: WEB_ROOT, reject: false })
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('apps/web is not a standalone application')
    expect(result.stderr).toContain('dsh web')
  })

  it('rejects the standalone Vite server with the full-host correction', async () => {
    const probeRoot = mkdtempSync(join(tmpdir(), 'dsh-vite-listen-probe-'))
    const marker = join(probeRoot, 'listen-called')
    const port = await freePort()
    try {
      const probeModule = fileURLToPath(new URL('./support/listen-probe.mjs', import.meta.url))
      const result = await execa(join(WEB_ROOT, 'node_modules/.bin/vite'), ['--host', '127.0.0.1', '--port', String(port)], {
        cwd: WEB_ROOT,
        reject: false,
        timeout: 10_000,
        env: {
          ...process.env,
          DSH_LISTEN_PROBE_MARKER: marker,
          NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import ${pathToFileURL(probeModule).href}`.trim(),
        },
      })
      expect(result.timedOut).toBe(false)
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain('apps/web is not a standalone application')
      expect(result.stderr).toContain('dsh web')
      expect(result.stderr).toContain('window.__DSH_BOOT__')
      expect(existsSync(marker), 'Vite called Server.listen before rejecting standalone serve mode').toBe(false)
    } finally {
      rmSync(probeRoot, { recursive: true, force: true })
    }
  })
})
