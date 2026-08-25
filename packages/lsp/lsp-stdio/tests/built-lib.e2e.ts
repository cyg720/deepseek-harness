/**
 * 文件职责：验证 built-lib.e2e.ts 覆盖的 LSP 标准输入输出连接、消息分帧与进程协作行为。
 * 技术维度：使用 TypeScript、Vitest、JSON-RPC/LSP 帧协议、Node.js 流和可控子进程测试。
 * 产品维度：保障语言服务器能够稳定启动、收发消息，并为 Agent 提供代码理解能力。
 * 逻辑维度：准备流或测试服务器，建立连接，发送协议消息，再核对响应、错误与资源清理。
 * 关键边界：帧长度必须与字节一致；进程和流可能提前结束；测试完成后必须释放所有句柄。
 * 新手阅读建议：先理解 Content-Length 分帧，再看连接生命周期，最后阅读异常与构建产物测试。
 */
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, rm, writeFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execa } from 'execa'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Keyless built-artifact smoke: plain Node imports `@deepseek-ai/dsh-lsp` and
 * `@deepseek-ai/dsh-lsp-stdio` by name through their exports maps, spawns the fixture server, runs
 * one query (exercising real `Content-Length` framing over `lib/index.js`), and disposes (exercising
 * subprocess cleanup). Unit tests use `src/`; this pins the downstream `lib/` path. Skips when `lib/`
 * is absent; CI runs it after the build.
 */

/** 中文说明：变量 pkgDir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const pkgDir = fileURLToPath(new URL('..', import.meta.url))
/** 中文说明：变量 seamLib 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const seamLib = join(pkgDir, '../lsp/lib/index.js')
/** 中文说明：变量 fsLib 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const fsLib = join(pkgDir, '../../fs/fs-local/lib/index.js')
/** 中文说明：变量 subprocessLib 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const subprocessLib = join(pkgDir, '../../subprocess/subprocess-local/lib/index.js')
/** 中文说明：变量 built 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const built = existsSync(join(pkgDir, 'lib/index.js')) && existsSync(seamLib) && existsSync(fsLib) && existsSync(subprocessLib)

/** 中文说明：变量 fixtureServer 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const fixtureServer = fileURLToPath(new URL('./fixture-server.ts', import.meta.url))

/** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let root: string
/** 中文说明：变量 ws 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let ws: string

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'lsp-built-')))
  ws = join(root, 'ws')
  await mkdir(ws)
  await writeFile(join(ws, 'a.ts'), 'const x = 1\n')
})

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true })
})

describe.skipIf(!built)('built lib real load path (plain node)', () => {
  it('runs a query through lib/index.js and disposes cleanly, framing over the base protocol', async () => {
    /** 中文说明：变量 location 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const location = JSON.stringify({ uri: pathToFileURL(join(ws, 'a.ts')).href, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } } })
    /** 中文说明：变量 script 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const script = `
      const { Context } = await import('@deepseek-ai/cordis')
      const { default: Lsp } = await import('@deepseek-ai/dsh-lsp')
      const LspLocal = await import('@deepseek-ai/dsh-lsp-stdio')
      const { default: LocalFileSystem } = await import('@deepseek-ai/dsh-fs-local')
      const { default: LocalSubprocessRuntime } = await import('@deepseek-ai/dsh-subprocess-local')
      const ctx = new Context()
      await ctx.plugin(Lsp)
      await ctx.plugin(LocalSubprocessRuntime)
      await ctx.plugin(LocalFileSystem, { cwd: process.cwd() })
      await ctx.plugin(LspLocal, {
        servers: {
          fake: {
            command: ${JSON.stringify(process.execPath)},
            args: [${JSON.stringify(fixtureServer)}],
            env: { LSP_FAKE_DEF: ${JSON.stringify(location)} },
            extensionToLanguage: { '.ts': 'typescript' },
          },
        },
      })
      const result = await ctx.lsp.query({ operation: 'goToDefinition', filePath: 'a.ts', position: { line: 0, character: 6 }, workspaceRoot: ${JSON.stringify(ws)} })
      console.log(JSON.stringify(result))
      await ctx.fiber.dispose()
    `
    const { exitCode, stdout, stderr } = await execa(process.execPath, ['--input-type=module', '-e', script], {
      cwd: pkgDir,
      stdin: 'ignore',
      timeout: 55_000,
      killSignal: 'SIGKILL',
      reject: false,
    })

    expect(exitCode, `stderr:\n${stderr}`).toBe(0)
    /** 中文说明：变量 lastLine 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const lastLine = stdout.trim().split('\n').at(-1) ?? ''
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = JSON.parse(lastLine) as { kind: string; locations: unknown[] }
    expect(result.kind).toBe('locations')
    expect(result.locations).toHaveLength(1)
  }, 60_000)
})
