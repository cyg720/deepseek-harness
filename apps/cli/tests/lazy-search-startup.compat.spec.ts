/**
 * Node 22 startup-output smoke for the shipped Web CLI composition.
 *
 * Only the dedicated Node compatibility gate opts this test in after building
 * both artifacts; ordinary Vitest inventory deterministically skips it.
 * The child runs built artifacts under plain Node with the real shipped
 * web profile (dsh-base + dsh-web-app bundle patches, auto-initialized).
 * Its URL line follows the settled profile boot; SIGTERM then exercises the
 * shipped quiescent disposer.
 */
/*
 * 文件职责：在构建产物上验证 Web CLI 默认关闭全文搜索并可通过 SIGTERM 平静退出。
 * 技术维度：使用 Node 子进程、YAML 自定义类型、临时目录和构建产物兼容测试开关。
 * 产品维度：确保发布版在 Node 22 下按安全默认值启动，不意外开启 SQLite 搜索或泄漏警告。
 * 逻辑维度：解析两层发布配置，确认搜索行为，再启动 Web、等待 URL、发送 SIGTERM 并检查输出。
 * 关键边界：只由专用构建兼容门禁启用；需要 CLI 与 Web 均已构建，普通 Vitest 会跳过。
 * 新手阅读建议：先看配置路径与 requireBuiltArtifacts 开关，再读 runBuiltWeb 的事件生命周期。
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

/** 仓库根目录。 */
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
/** 构建后的 CLI Node 入口。 */
const builtBin = join(repoRoot, 'apps/cli/lib/bin.js')
/** 构建后的 Web 首页，用于确认前端产物存在。 */
const webDist = join(repoRoot, 'apps/web/dist/index.html')
// Full-text session search ships off (`openAt: never` on both layers): the
// base patch carries the default, and the web restatement must not re-enable it.
// 基础层与 Web 重述层都应保持全文搜索默认关闭。
/** 基础 bundle 的发布配置。 */
const baseConfigPath = join(repoRoot, 'packages/bundle/base/cordis.patch.yml')
/** Web 应用 bundle 的发布配置。 */
const webConfigPath = join(repoRoot, 'packages/bundle/web-app/cordis.patch.yml')
/** 专用兼容门禁是否要求本次执行真实构建冒烟测试。 */
const requireBuiltArtifacts = process.env.DSH_REQUIRE_BUILT_CLI_SMOKE === '1'

/** 测试读取的最小配置行字段。 */
interface ConfigRow {
  id?: string
  disabled?: unknown
  config?: { openAt?: unknown }
}

/** 可直接作为补丁行或包含 insert 子行的配置项。 */
interface PatchEntry extends ConfigRow {
  insert?: ConfigRow[]
}

/** 保留 !!js 标量文本而不执行表达式的 YAML 类型。 */
const jsExprType = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  construct: value => String(value),
})
/** 支持读取仓库 !!js 配置标量的 JSON Schema 扩展。 */
const configSchema = yaml.JSON_SCHEMA.extend(jsExprType)

/** Boot the built Web CLI, wait for its settled URL, then dispose through SIGTERM. */
/*
 * 启动构建版 Web CLI，等待 URL 表示稳定后发送 SIGTERM。
 * @param cwd 隔离的启动工作目录。
 * @returns 进程标准输出、标准错误和退出码。
 * @example `await runBuiltWeb(tempDir)`
 */
function runBuiltWeb(cwd: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolveRun, rejectRun) => {
    /** 删除不允许继承的端点和 Node 行为变量后的子进程环境。 */
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      DEEPSEEK_API_KEY: 'dsh-cli-smoke-dummy-key',
      DSH_HOME: join(cwd, '.dsh'),
    }
    delete env.DEEPSEEK_BASE_URL
    delete env.NODE_OPTIONS
    delete env.NODE_NO_WARNINGS
    /** 正在运行的构建版 Web CLI 子进程。 */
    const child = spawn(process.execPath, [
      builtBin,
      'web',
      '--no-open',
      '--host',
      '127.0.0.1',
      '--port',
      '0',
    ], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    /** 累积的标准输出文本。 */
    let stdout = ''
    /** 累积的标准错误文本。 */
    let stderr = ''
    /** 是否已经观察到稳定启动 URL。 */
    let settled = false
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
      if (!settled && /dsh web: http:\/\/127\.0\.0\.1:\d+/u.test(stdout)) {
        settled = true
        child.kill('SIGTERM')
      }
    })
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    /** 防止启动或关闭永久挂起的总超时计时器。 */
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      rejectRun(new Error(`built Web CLI did not settle and dispose within 60s\nstdout:\n${stdout}\nstderr:\n${stderr}`))
    }, 60_000)
    child.on('error', (error) => {
      clearTimeout(timer)
      rejectRun(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (!settled) {
        rejectRun(new Error(`built Web CLI exited before settled startup (code ${String(code)})\nstdout:\n${stdout}\nstderr:\n${stderr}`))
        return
      }
      resolveRun({ stdout, stderr, code: code ?? -1 })
    })
  })
}

describe.skipIf(!requireBuiltArtifacts)('built CLI lazy-search startup', () => {
  /** 构建产物应按默认搜索策略启动并无 SQLite 实验警告地退出。 */
  it('boots and disposes the shipped composition with full-text search off by default', async () => {
    expect(existsSync(builtBin), `missing built CLI ${resolve(builtBin)}; run pnpm build`).toBe(true)
    expect(existsSync(webDist), `missing Web dist ${resolve(webDist)}; run pnpm run build:web`).toBe(true)
    /** 基础配置中展开后的全部行。 */
    const baseRows = (yaml.load(await readFile(baseConfigPath, 'utf8'), { schema: configSchema }) as PatchEntry[])
      .flatMap(entry => entry.insert ?? [entry])
    /** Web 配置中展开后的全部行。 */
    const webRows = (yaml.load(await readFile(webConfigPath, 'utf8'), { schema: configSchema }) as PatchEntry[])
      .flatMap(entry => entry.insert ?? [entry])
    /** 基础层中的会话查询行。 */
    const baseRow = baseRows.find(row => row.id === 'session-query-sqlite')
    /** Web 重述层中的会话查询行。 */
    const webRow = webRows.find(row => row.id === 'session-query-sqlite')
    expect(baseRow?.config?.openAt).toBe('never')
    expect(baseRow?.disabled).toBeUndefined()
    // The web restatement keeps the shipped default; opting in is a later layer's override.
    // Web 层保持发布默认值，只有更高层覆盖才能选择启用。
    expect(webRow?.config?.openAt).toBe('never')
    expect(webRow?.disabled).toBeUndefined()

    /** 构建版 Web CLI 的隔离工作目录。 */
    const cwd = await mkdtemp(join(tmpdir(), 'dsh-cli-lazy-search-'))
    try {
      /** 构建版 Web CLI 的启动与关闭结果。 */
      const result = await runBuiltWeb(cwd)
      expect(result.stdout).toMatch(/dsh web: http:\/\/127\.0\.0\.1:\d+/u)
      expect(result.code).toBe(0)
      expect(result.stderr).not.toMatch(/ExperimentalWarning: SQLite/u)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  }, 70_000)
})
