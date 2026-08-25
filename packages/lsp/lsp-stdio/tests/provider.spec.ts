/**
 * 文件职责：验证 LSP 连接、生命周期、协议转换与语言服务器协作行为（provider.spec.ts）。
 * 技术维度：TypeScript、Vitest、JSON-RPC/LSP 协议、Node.js 流与可控进程。
 * 产品维度：保障语言服务器能力能被 Agent 稳定调用。
 * 逻辑维度：准备连接或测试进程，发送协议消息并核对结果与清理。
 * 关键边界：帧长度、进程退出和取消均可能导致异步失败。
 * 新手阅读建议：先读辅助对象，再看连接流程，最后阅读异常场景。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chmod, mkdtemp, mkdir, rm, writeFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import Lsp, { type LspQueryRequest } from '@deepseek-ai/dsh-lsp'
import * as LspLocal from '@deepseek-ai/dsh-lsp-stdio'
import type { Config, LspLocalServerConfig } from '@deepseek-ai/dsh-lsp-stdio'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'

/** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let root: string
/** 中文说明：变量 ws 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let ws: string

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'lsp-prov-')))
  ws = join(root, 'ws')
  await mkdir(ws)
  await writeFile(join(ws, 'a.ts'), 'const x = 1\n')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/** 中文说明：函数 query 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function query(): LspQueryRequest {
  return { operation: 'goToDefinition', filePath: 'a.ts', position: { line: 0, character: 0 }, workspaceRoot: ws }
}

/** Wrap one server entry in the plugin's named server table. */
/** 中文说明：函数 config 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function config(providerId: string, server: LspLocalServerConfig): Config {
  return { servers: { [providerId]: server } }
}

describe('lsp-stdio provider resolution', () => {
  it('resolves a bare command on the child PATH and registers the provider', async () => {
    // A tiny executable script placed on a custom PATH dir: the load-time resolver must find it.
    /** 中文说明：变量 bin 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bin = join(root, 'bin')
    await mkdir(bin)
    /** 中文说明：变量 exe 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const exe = join(bin, process.platform === 'win32' ? 'fake-lsp.cmd' : 'fake-lsp')
    await writeFile(exe, process.platform === 'win32' ? '@exit /b 0\r\n' : '#!/bin/sh\nexit 0\n')
    if (process.platform !== 'win32') await chmod(exe, 0o755)

    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(Lsp)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(LocalFileSystem, { cwd: process.cwd() })
    await expect(ctx.plugin(LspLocal, config('onpath', {
      command: 'fake-lsp',
      args: [],
      env: { PATH: bin, ...process.platform === 'win32' ? { PATHEXT: '.CMD' } : {} },
      extensionToLanguage: { '.ts': 'typescript' },
    }))).resolves.toBeDefined()
    await ctx.fiber.dispose()
  })

  it('skips empty PATH segments and fails when the command is absent', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(Lsp)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(LocalFileSystem, { cwd: process.cwd() })
    await expect(ctx.plugin(LspLocal, config('nope', {
      command: 'fake-lsp',
      args: [],
      env: { PATH: `${delimiter}${delimiter}${join(root, 'empty')}` },
      extensionToLanguage: { '.ts': 'typescript' },
    }))).rejects.toThrow(/was not found on PATH/)
    await ctx.fiber.dispose()
  })

  it('rejects a query after the provider is disposed', async () => {
    // Use a server that never emits results and dispose the plugin, then confirm queries are refused.
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(Lsp)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(LocalFileSystem, { cwd: process.cwd() })
    // Grab the provider instance by registering, then dispose the whole plugin fiber.
    /** 中文说明：变量 lsp 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const lsp = ctx.lsp
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = await ctx.plugin(LspLocal, config('disp', {
      command: process.execPath,
      args: ['-e', 'setInterval(()=>{},1000)'],
      extensionToLanguage: { '.ts': 'typescript' },
    }))
    await fiber.dispose()
    // After disposal the provider unregistered from the seam, so selection fails as unavailable.
    await expect(lsp.query(query())).rejects.toThrow(expect.objectContaining({ code: 'LSP_UNAVAILABLE' }))
    await ctx.fiber.dispose()
  })

  it('rejects a nonpositive teardown budget at load', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(Lsp)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(LocalFileSystem, { cwd: process.cwd() })
    await expect(ctx.plugin(LspLocal, config('bad-budget', {
      command: process.execPath,
      args: ['-e', ''],
      extensionToLanguage: { '.ts': 'typescript' },
      killGraceMs: 0,
    }))).rejects.toThrow(/servers\.bad-budget\.killGraceMs must be a positive integer/)
    await ctx.fiber.dispose()
  })

  it('rejects a nonpositive byte cap at load', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(Lsp)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(LocalFileSystem, { cwd: process.cwd() })
    await expect(ctx.plugin(LspLocal, config('bad-cap', {
      command: process.execPath,
      args: ['-e', ''],
      extensionToLanguage: { '.ts': 'typescript' },
      maxDocumentBytes: 0,
    }))).rejects.toThrow(/servers\.bad-cap\.maxDocumentBytes must be a positive integer/)
    await ctx.fiber.dispose()
  })

  it.each(['shutdownTimeoutMs', 'killGraceMs'] as const)('rejects %s above Node timer range at load', async (name) => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(Lsp)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(LocalFileSystem, { cwd: process.cwd() })
    await expect(ctx.plugin(LspLocal, config('bad-timer', {
      command: process.execPath,
      args: ['-e', ''],
      extensionToLanguage: { '.ts': 'typescript' },
      [name]: MAX_TIMER_DELAY_MS + 1,
    }))).rejects.toThrow(new RegExp(`servers\\.bad-timer\\.${name}`))
    await ctx.fiber.dispose()
  })

  // Node's X_OK probe is an existence check on Windows, which has no executable mode bit.
  it.skipIf(process.platform === 'win32')('rejects an absolute command that is not executable at load', async () => {
    /** 中文说明：变量 notExe 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const notExe = join(root, 'not-exe.txt')
    await writeFile(notExe, 'plain text, not executable')
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(Lsp)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(LocalFileSystem, { cwd: process.cwd() })
    await expect(ctx.plugin(LspLocal, config('abs-bad', {
      command: notExe,
      args: [],
      extensionToLanguage: { '.ts': 'typescript' },
    }))).rejects.toThrow(/is not an executable file/)
    await ctx.fiber.dispose()
  })

  it('rejects an executable directory as a command at load', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(Lsp)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(LocalFileSystem, { cwd: process.cwd() })
    await expect(ctx.plugin(LspLocal, config('abs-directory', {
      command: ws,
      args: [],
      extensionToLanguage: { '.ts': 'typescript' },
    }))).rejects.toThrow(/is not an executable file/)
    await ctx.fiber.dispose()
  })

  it('rejects an empty server table at load', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(Lsp)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(LocalFileSystem, { cwd: process.cwd() })
    await expect(ctx.plugin(LspLocal, { servers: {} })).rejects.toThrow(/servers must contain at least one server/)
    await ctx.fiber.dispose()
  })

  it('rejects an empty server id at load', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(Lsp)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(LocalFileSystem, { cwd: process.cwd() })
    await expect(ctx.plugin(LspLocal, config('', {
      command: process.execPath,
      extensionToLanguage: { '.ts': 'typescript' },
    }))).rejects.toThrow(/server ids must be non-empty strings/)
    await ctx.fiber.dispose()
  })

  it('resolves every executable before publishing any provider', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(Lsp)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(LocalFileSystem, { cwd: process.cwd() })
    await expect(ctx.plugin(LspLocal, {
      servers: {
        valid: { command: process.execPath, extensionToLanguage: { '.ts': 'typescript' } },
        missing: { command: 'definitely-not-a-real-lsp-binary-xyz', extensionToLanguage: { '.py': 'python' } },
      },
    })).rejects.toThrow(/was not found on PATH/)
    await expect(ctx.lsp.query(query())).rejects.toThrow(expect.objectContaining({ code: 'LSP_UNAVAILABLE' }))
    await ctx.fiber.dispose()
  })

  it('waits for aborted sibling executable lookups before setup rejects', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(Lsp)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(LocalFileSystem, { cwd: process.cwd() })
    /** 中文说明：变量 slowStarted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const slowStarted = Promise.withResolvers<undefined>()
    /** 中文说明：变量 slowAborted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const slowAborted = Promise.withResolvers<undefined>()
    /** 中文说明：变量 releaseCleanup 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const releaseCleanup = Promise.withResolvers<undefined>()
    vi.spyOn(ctx.subprocess, 'resolveExecutable').mockImplementation(async (command, _env, signal) => {
      if (signal === undefined) throw new Error('missing setup signal')
      if (command === 'slow-lsp') {
        return await new Promise<string>((_resolve, reject) => {
          /** 中文说明：函数值 onAbort 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
          const onAbort = (): void => {
            slowAborted.resolve(undefined)
            void releaseCleanup.promise.then(() => {
              reject(signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason)))
            })
          }
          signal.addEventListener('abort', onAbort, { once: true })
          slowStarted.resolve(undefined)
          if (signal.aborted) onAbort()
        })
      }
      await slowStarted.promise
      throw new Error('lookup failed')
    })

    /** 中文说明：变量 loading 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const loading = ctx.plugin(LspLocal, {
      servers: {
        slow: { command: 'slow-lsp', extensionToLanguage: { '.ts': 'typescript' } },
        failing: { command: 'failing-lsp', extensionToLanguage: { '.js': 'javascript' } },
      },
    })
    await slowAborted.promise
    /** 中文说明：变量 settled 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let settled = false
    void loading.then(() => { settled = true }, () => { settled = true })
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    expect(settled).toBe(false)

    releaseCleanup.resolve(undefined)
    await expect(loading).rejects.toThrow('lookup failed')
    await ctx.fiber.dispose()
  })

  it('aborts executable resolution when disposed during setup', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(Lsp)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(LocalFileSystem, { cwd: process.cwd() })
    /** 中文说明：变量 subprocess 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const subprocess = ctx.subprocess
    /** 中文说明：变量 lookupStarted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const lookupStarted = Promise.withResolvers<AbortSignal>()
    vi.spyOn(subprocess, 'resolveExecutable').mockImplementation(async (_command, _env, signal) => {
      if (signal === undefined) throw new Error('missing setup signal')
      lookupStarted.resolve(signal)
      return await new Promise<string>((_resolve, reject) => {
        /** 中文说明：函数值 onAbort 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
        const onAbort = (): void => {
          reject(signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason)))
        }
        signal.addEventListener('abort', onAbort, { once: true })
        if (signal.aborted) onAbort()
      })
    })

    /** 中文说明：变量 loading 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const loading = ctx.plugin(LspLocal, config('pending', {
      command: 'pending-lsp',
      extensionToLanguage: { '.ts': 'typescript' },
    }))
    /** 中文说明：变量 signal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const signal = await lookupStarted.promise
    /** 中文说明：函数值 unrelated 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const unrelated = await ctx.plugin(() => {})
    await unrelated.dispose()
    expect(signal.aborted).toBe(false)
    /** 中文说明：变量 disposing 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const disposing = loading.dispose()

    await expect(loading).rejects.toThrow('lsp-stdio setup disposed')
    await expect(disposing).resolves.toBeUndefined()
    expect(signal.aborted).toBe(true)
    await ctx.fiber.dispose()
  })

  it('rolls back earlier registrations when a later server conflicts', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(Lsp)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(LocalFileSystem, { cwd: process.cwd() })
    await expect(ctx.plugin(LspLocal, {
      servers: {
        first: { command: process.execPath, extensionToLanguage: { '.ts': 'typescript' } },
        second: { command: process.execPath, extensionToLanguage: { '.ts': 'typescript' } },
      },
    })).rejects.toThrow(expect.objectContaining({ code: 'LSP_CONFLICT' }))
    await expect(ctx.lsp.query(query())).rejects.toThrow(expect.objectContaining({ code: 'LSP_UNAVAILABLE' }))
    await ctx.fiber.dispose()
  })
})
