/** Published dsh web + pnpm dev:web → browser HMR, with no page reload. */
/* 已发布的 dsh Web 与开发监听器之间应通过热更新刷新界面，而不重新加载页面。 */
/**
 * 文件职责：验证真实客户端源码修改能由开发构建链路热更新到已打开的浏览器页面。
 * 技术维度：使用 Vitest、Playwright、Cordis 子进程服务和文件系统临时目录驱动端到端场景。
 * 产品维度：保障扩展开发者修改界面文案后能立即看到结果，并保留当前页面状态。
 * 逻辑维度：启动监听器与 Web 主机，修改源码，等待页面更新，再恢复源码、构建产物和进程。
 * 关键边界：依赖预先构建的 CLI、可用的 Chromium 和完整清理；失败时仍必须恢复被改文件。
 * 新手阅读建议：先读主测试的启动与恢复流程，再读输出等待器和进程树停止辅助函数。
 */

import { existsSync, globSync, statSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { readClientBuildRecord } from '../../../scripts/client-build-environment.ts'
import { REPO_ROOT } from './support.ts'

const CLIENT_ARTIFACT_PATTERNS = [
  'apps/web/dist/**/*',
  'packages/*/*/lib/client.js',
  'packages/*/*/lib/client.js.map',
]

/** Return every artifact that `pnpm run dev:web` can rewrite. */
function clientArtifactPaths(): string[] {
  return globSync(CLIENT_ARTIFACT_PATTERNS, { cwd: REPO_ROOT })
    .map(path => join(REPO_ROOT, path))
    .filter(path => statSync(path).isFile())
    .sort()
}

function spawnSpec(argv: readonly string[], cwd: string, env?: Record<string, string>): SubprocessSpawnSpec {
  return {
    argv,
    cwd,
    stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
    graceMs: 5_000,
    ...env === undefined ? {} : { env },
  }
}

/** 等待 child 输出匹配 pattern；label 用于错误说明，返回捕获文本。示例：await waitForOutput(host, /ready/, 'host')。 */
function waitForOutput(child: SubprocessHandle, pattern: RegExp, label: string): Promise<string> {
  return new Promise((resolveReady, reject) => {
    /** 累积两个输出流，便于跨数据块匹配并在失败时诊断。 */
    let output = ''
    /** 标记等待是否结束，防止重复完成 Promise。 */
    let settled = false
    /** 解除计时器与输出监听，避免残留资源。 */
    const cleanup = (): void => {
      clearTimeout(timer)
      child.stdout?.off('data', onData)
      child.stderr?.off('data', onData)
    }
    /** 使用首次匹配值成功结束等待。 */
    const resolveOnce = (value: string): void => {
      if (settled) return
      settled = true
      cleanup()
      resolveReady(value)
    }
    /** 使用首次错误结束等待。 */
    const rejectOnce = (error: Error): void => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    /** 合并一个输出块并检查就绪标记。 */
    const onData = (chunk: Buffer): void => {
      output += chunk.toString()
      /** 当前累积输出的就绪匹配；为空时继续监听。 */
      const match = pattern.exec(output)
      if (match === null) return
      resolveOnce(match[1] ?? match[0])
    }
    /** 最长等待一分钟，防止测试永久挂起。 */
    const timer = setTimeout(() => { rejectOnce(new Error(`${label} not ready:\n${output}`)) }, 60_000)
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    void child.done.then((outcome) => {
      rejectOnce(new Error(`${label} exited before ready (${JSON.stringify(outcome)}):\n${output}`))
    }, (error: unknown) => {
      rejectOnce(new Error(`${label} failed before ready:\n${output}`, { cause: error }))
    })
  })
}

/** 终止 child 进程树并等待退出，无返回值。示例：await stopTree(watcher)。 */
async function stopTree(child: SubprocessHandle): Promise<void> {
  child.terminate()
  /** 表示进程树是否在十五秒期限内退出。 */
  const stopped = await child.waitForExit(AbortSignal.timeout(15_000))
  if (!stopped) throw new Error(`process tree ${String(child.pid)} did not stop after termination escalation`)
  await child.done
}

it('hot-reloads a real client-plugin source edit without refreshing the page', async () => {
  /** 隔离本次 Web 主机配置与会话数据的临时目录。 */
  const world = await mkdtemp(join(tmpdir(), 'dsh-web-hmr-world-'))
  /** 被临时替换文案的真实客户端源码路径。 */
  const sourcePath = join(REPO_ROOT, 'packages/client/ui-conversation/src/client/locales.ts')
  /** 启动已构建 Web 主机所需的 CLI 入口。 */
  const binPath = join(REPO_ROOT, 'apps/cli/lib/bin.js')
  if (!existsSync(binPath)) throw new Error('HMR browser test needs the built dsh bin; run pnpm run build first')
  /** 与当前客户端构建记录一致的环境变量。 */
  const clientBuildEnvironment = readClientBuildRecord(REPO_ROOT).environment
  const originalClientArtifacts = await Promise.all(clientArtifactPaths()
    .map(async path => [path, await readFile(path)] as const))
  const originalClientArtifactPaths = new Set(originalClientArtifacts.map(([path]) => path))
  const originalSource = await readFile(sourcePath)
  /** 页面首次加载时应显示的原始标题。 */
  const oldText = 'Into the Unknown'
  /** 在源码中精确定位原始标题的文本片段。 */
  const sourceNeedle = "'hero.headline': 'Into the Unknown'"
  /** 用于确认热更新完成的新标题。 */
  const newText = `HMR UPDATED ${'x'.repeat(80)}`
  /** 只替换目标标题后的临时源码内容。 */
  const updatedSource = originalSource.toString().replace(sourceNeedle, `'hero.headline': '${newText}'`)
  if (updatedSource === originalSource.toString()) throw new Error(`HMR source lacks ${JSON.stringify(sourceNeedle)}`)

  /** 承载本地子进程插件生命周期的独立上下文。 */
  const subprocessCtx = new Context()
  /** 子进程插件的生命周期句柄。 */
  let subprocessFiber: Fiber | undefined
  /** 开发构建监听进程。 */
  let watcher: SubprocessHandle | undefined
  /** 已构建 Web 服务进程。 */
  let host: SubprocessHandle | undefined
  /** 用于观察真实热更新的浏览器实例。 */
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  /** 汇总测试主体和清理阶段错误。 */
  const failures: unknown[] = []
  try {
    subprocessFiber = await subprocessCtx.plugin(LocalSubprocessRuntime)
    watcher = subprocessCtx.subprocess.spawn(spawnSpec(
      ['pnpm', 'run', 'dev:web'],
      REPO_ROOT,
      { ...clientBuildEnvironment },
    ))
    await waitForOutput(watcher, /dev-web: watching/, 'pnpm run dev:web')
    host = subprocessCtx.subprocess.spawn(spawnSpec(
      [process.execPath, binPath, 'web', '--no-open', '--port', '0'],
      world,
      {
        DEEPSEEK_API_KEY: 'keyless-hmr-no-call',
        DSH_HOME: join(world, '.dsh'),
      },
    ))
    /** Web 主机输出的随机端口地址。 */
    const baseUrl = await waitForOutput(host, /dsh web: (http:\/\/[^\s]+)/, 'built dsh web')
    browser = await chromium.launch()
    /** 保持打开以检测是否整页刷新的浏览器页面。 */
    const page = await browser.newPage()
    /** 页面未处理错误的文本集合。 */
    const pageErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(String(error)))
    await page.goto(baseUrl, { waitUntil: 'load' })
    await page.getByText(oldText, { exact: true }).waitFor({ timeout: 15_000 })
    /** 写入 window 的身份值；更新后保留即说明未整页刷新。 */
    const pageIdentity = await page.evaluate(() => {
      // In-page code: an import would not survive serialization, and the page
      // entropy source available in every context is getRandomValues.
      const identity = Array.from(crypto.getRandomValues(new Uint8Array(8)), byte => byte.toString(16).padStart(2, '0')).join('')
      Object.defineProperty(window, '__dshHmrPageIdentity', { value: identity })
      return identity
    })

    await writeFile(sourcePath, updatedSource)
    await page.getByText(newText, { exact: true }).waitFor({ timeout: 30_000 })
    expect(await page.evaluate(() => (window as Window & { __dshHmrPageIdentity?: string }).__dshHmrPageIdentity))
      .toBe(pageIdentity)
    expect(pageErrors).toEqual([])
  } catch (error) {
    failures.push(error)
  } finally {
    await writeFile(sourcePath, originalSource).catch((error: unknown) => failures.push(error))
    if (watcher !== undefined) await stopTree(watcher).catch((error: unknown) => failures.push(error))
    if (host !== undefined) await stopTree(host).catch((error: unknown) => failures.push(error))
    await browser?.close().catch((error: unknown) => failures.push(error))
    await subprocessFiber?.dispose().catch((error: unknown) => failures.push(error))
    await Promise.all(clientArtifactPaths()
      .filter(path => !originalClientArtifactPaths.has(path))
      .map(async (path) => { await rm(path, { force: true }) }))
      .catch((error: unknown) => failures.push(error))
    await Promise.all(originalClientArtifacts.map(async ([path, content]) => {
      await writeFile(path, content)
    })).catch((error: unknown) => failures.push(error))
    try {
      readClientBuildRecord(REPO_ROOT)
    } catch (error) {
      failures.push(error)
    }
    await rm(world, { recursive: true, force: true }).catch((error: unknown) => failures.push(error))
  }
  if (failures.length > 0) throw new AggregateError(failures, 'HMR browser test or cleanup failed')
}, 120_000)
