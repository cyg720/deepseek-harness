/**
 * 文件职责：验证 host.spec.ts 覆盖的 LSP 标准输入输出连接、消息分帧与进程协作行为。
 * 技术维度：使用 TypeScript、Vitest、JSON-RPC/LSP 帧协议、Node.js 流和可控子进程测试。
 * 产品维度：保障语言服务器能够稳定启动、收发消息，并为 Agent 提供代码理解能力。
 * 逻辑维度：准备流或测试服务器，建立连接，发送协议消息，再核对响应、错误与资源清理。
 * 关键边界：帧长度必须与字节一致；进程和流可能提前结束；测试完成后必须释放所有句柄。
 * 新手阅读建议：先理解 Content-Length 分帧，再看连接生命周期，最后阅读异常与构建产物测试。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { realpath } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { deadline } from '@deepseek-ai/dsh-timeout'
import { canonicalizeWorkspace, readHostSource } from '@deepseek-ai/dsh-lsp-stdio'

/** 中文说明：变量 execFileAsync 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const execFileAsync = promisify(execFile)

/** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let root: string
/** 中文说明：变量 ws 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let ws: string
/** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let ctx: Context
/** 中文说明：变量 fs 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let fs: LocalFileSystem

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'lsp-host-')))
  ws = join(root, 'ws')
  await mkdir(ws)
  ctx = new Context()
  await ctx.plugin(LocalFileSystem, { cwd: root })
  fs = ctx.fs as LocalFileSystem
})

afterEach(async () => {
  await ctx.fiber.dispose()
  await rm(root, { recursive: true, force: true })
})

/** 中文说明：常量 BIG 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const BIG = 1_000_000

/** 中文说明：函数 workspace 承担本测试场景中的准备或验证工作；参数按签名传入，返回值供后续断言使用；示例见本文件调用。 */
async function workspace() {
  return await canonicalizeWorkspace(fs, ws)
}

/** 中文说明：函数 readSource 承担本测试场景中的准备或验证工作；参数按签名传入，返回值供后续断言使用；示例见本文件调用。 */
async function readSource(filePath: string, maxBytes = BIG, signal?: AbortSignal) {
  return await readHostSource(fs, filePath, await workspace(), maxBytes, signal)
}

describe('canonicalizeWorkspace', () => {
  it('returns the realpath of a directory', async () => {
    expect((await workspace()).canonicalPath).toBe(ws)
  })

  it('resolves a symlinked workspace to its target so aliases share identity', async () => {
    /** 中文说明：变量 link 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const link = join(root, 'ws-link')
    await symlink(ws, link)
    expect((await canonicalizeWorkspace(fs, link)).canonicalPath).toBe(ws)
  })

  it('rejects a missing workspace', async () => {
    await expect(canonicalizeWorkspace(fs, join(root, 'nope'))).rejects.toThrow(/not a directory/)
  })

  it('wraps a provider failure while resolving the workspace', async () => {
    fs.resolve = async () => { throw 'raw workspace resolve failure' }
    await expect(canonicalizeWorkspace(fs, ws))
      .rejects.toThrow(`workspace root "${ws}" cannot be resolved: raw workspace resolve failure`)
  })

  it('rejects a non-directory workspace', async () => {
    /** 中文说明：变量 file 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const file = join(root, 'file.txt')
    await writeFile(file, 'x')
    await expect(canonicalizeWorkspace(fs, file)).rejects.toThrow(/not a directory/)
  })

  it('normalizes workspace metadata cancellation and preserves other provider failures', async () => {
    /** 中文说明：变量 providerFailure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const providerFailure = new Error('workspace metadata failed')
    fs.stat = async () => { throw providerFailure }
    await expect(canonicalizeWorkspace(fs, ws)).rejects.toBe(providerFailure)

    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    fs.stat = async () => {
      controller.abort(new Error('workspace metadata cancelled'))
      throw providerFailure
    }
    await expect(canonicalizeWorkspace(fs, ws, controller.signal))
      .rejects.toThrow('workspace metadata cancelled')
  })
})

describe('readHostSource', () => {
  it('reads a relative path against the workspace', async () => {
    await writeFile(join(ws, 'a.ts'), 'const x = 1\n')
    /** 中文说明：变量 source 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const source = await readSource('a.ts')
    expect(source.fileUrl).toBe(pathToFileURL(join(ws, 'a.ts')).href)
    expect(source.text).toBe('const x = 1\n')
  })

  it('reads an absolute path inside the workspace', async () => {
    /** 中文说明：变量 abs 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const abs = join(ws, 'b.ts')
    await writeFile(abs, 'b')
    /** 中文说明：变量 source 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const source = await readSource(abs)
    expect(source.fileUrl).toBe(pathToFileURL(abs).href)
  })

  it('accepts a source reached through a symlink that stays inside the workspace', async () => {
    await mkdir(join(ws, 'real'))
    await writeFile(join(ws, 'real', 'c.ts'), 'c')
    await symlink(join(ws, 'real'), join(ws, 'linked'))
    /** 中文说明：变量 source 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const source = await readSource('linked/c.ts')
    expect(source.fileUrl).toBe(pathToFileURL(join(ws, 'real', 'c.ts')).href)
  })

  it('rejects a source whose canonical path escapes the workspace via symlink', async () => {
    /** 中文说明：变量 outside 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const outside = join(root, 'outside.ts')
    await writeFile(outside, 'secret')
    await symlink(outside, join(ws, 'escape.ts'))
    await expect(readSource('escape.ts')).rejects.toThrow(/outside the workspace/)
  })

  it('rejects an absolute source outside the workspace', async () => {
    /** 中文说明：变量 outside 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const outside = join(root, 'out.ts')
    await writeFile(outside, 'x')
    await expect(readSource(outside)).rejects.toThrow(/outside the workspace/)
  })

  it('rejects a missing source', async () => {
    await expect(readSource('nope.ts')).rejects.toThrow(/not found/)
  })

  it('wraps a provider failure while resolving the source', async () => {
    /** 中文说明：变量 canonical 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const canonical = await workspace()
    fs.resolve = async () => { throw 'raw resolve failure' }
    await expect(readHostSource(fs, 'broken.ts', canonical, BIG))
      .rejects.toThrow('source "broken.ts" cannot be resolved: raw resolve failure')
  })

  it('rejects a non-regular source (directory)', async () => {
    await mkdir(join(ws, 'dir'))
    await expect(readSource('dir')).rejects.toThrow(/not a regular file/)
  })

  // Windows has no filesystem FIFO; the directory case above pins non-regular rejection there.
  it.skipIf(process.platform === 'win32')('rejects a FIFO with no writer without blocking in open', async () => {
    /** 中文说明：变量 fifo 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fifo = join(ws, 'pipe.ts')
    await execFileAsync('mkfifo', [fifo])
    using d = deadline(undefined, 1000, 'FIFO_READ_TIMEOUT')
    await expect(readSource('pipe.ts', BIG, d.signal)).rejects.toThrow(/not a regular file/)
  })

  it('honors a pre-aborted source read before filesystem work', async () => {
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    controller.abort(new Error('source read cancelled'))
    await expect(readSource('missing.ts', BIG, controller.signal)).rejects.toThrow(/source read cancelled/)
  })

  it('treats the workspace root itself as inside, then rejects it as non-regular', async () => {
    // The filesystem containment primitive accepts the workspace itself; the
    // bounded read then rejects the directory as non-regular.
    await expect(readSource('.')).rejects.toThrow(/not a regular file/)
  })

  it('rejects an oversized source and reports the observed lower bound', async () => {
    await writeFile(join(ws, 'big.ts'), 'x'.repeat(100))
    await expect(readSource('big.ts', 10)).rejects.toMatchObject({
      message: 'source "big.ts" exceeds the 10-byte limit; reading stopped after 100 bytes',
    })
  })

  it('counts the complete UTF-8 byte length at the configured boundary', async () => {
    await writeFile(join(ws, 'multibyte.ts'), '€abc')
    await expect(readSource('multibyte.ts', 6)).resolves.toMatchObject({ text: '€abc' })
    await expect(readSource('multibyte.ts', 5)).rejects.toThrow(/5-byte limit/)
  })

  it('rejects a non-UTF-8 source', async () => {
    await writeFile(join(ws, 'bin.ts'), Buffer.from([0xff, 0xfe, 0x00]))
    await expect(readSource('bin.ts')).rejects.toThrow(/invalid UTF-8|binary file/)
  })

  it('keeps a valid U+FFFD replacement character in otherwise-valid UTF-8', async () => {
    // The literal replacement char is valid UTF-8; a fatal decoder must accept it (only malformed
    // byte sequences are rejected).
    await writeFile(join(ws, 'repl.ts'), 'const s = "�"\n')
    /** 中文说明：变量 source 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const source = await readSource('repl.ts')
    expect(source.text).toBe('const s = "�"\n')
  })
})
