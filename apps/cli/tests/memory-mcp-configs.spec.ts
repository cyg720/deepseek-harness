/**
 * The third-party memory examples stay config-only. This suite parses every
 * checked-in overlay, verifies its package pin, transport, and secret handling, then replaces
 * only the upstream endpoint with the package-owned keyless MCP fixture and
 * proves the real Cordis Loader discovers a tool through the generic bridge.
 */
/*
 * 文件职责：验证三种第三方记忆 MCP 示例的配置字段、安全处理和真实 Loader 工具发现。
 * 技术维度：使用 Vitest、Cordis Loader、MCP 测试服务器与配置补丁解析执行集成测试。
 * 产品维度：保证用户可复制无密钥泄漏的记忆服务示例，并通过通用桥接获得可调用工具。
 * 逻辑维度：先逐个静态检查示例，再替换上游端点为无密钥夹具，启动真实插件树并等待工具。
 * 关键边界：只替换测试所需的模块与端点，不改变示例其他字段；所有启动上下文必须释放。
 * 新手阅读建议：先看 examples 表中的期望，再比较两个 it.each 如何分别验证静态和运行时行为。
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as McpClient from '@deepseek-ai/dsh-mcp-client/src/index.ts'

/** 每个记忆示例必须满足的文件、配置和版本期望。 */
interface ExampleContract {
  file: string
  id: string
  serverName: string
  transport: 'stdio' | 'streamable-http'
  pin: string
}

/** 从覆盖文件中读取的最小插入配置行。 */
interface InsertedRow {
  id?: string
  name?: string
  config?: Record<string, unknown>
}

/** 仓库根目录。 */
const root = resolve(import.meta.dirname, '../../..')
const exampleDir = resolve(root, 'apps/cli/config/examples/mcp-memory')
const baseConfig = resolve(import.meta.dirname, 'fixtures/memory-mcp-base.cordis.yml')
/** 无密钥 MCP 标准输入输出服务器源码。 */
const fixtureServer = resolve(root, 'packages/mcp/mcp-client/tests/fixture-server.ts')

/** 三个受支持示例及其固定包版本和传输方式。 */
const examples: ExampleContract[] = [
  {
    file: 'memorix.cordis.yml',
    id: 'memory-memorix',
    serverName: 'memorix',
    transport: 'stdio',
    pin: '1.3.0',
  },
  {
    file: 'mcp-reference-memory.cordis.yml',
    id: 'memory-mcp-reference',
    serverName: 'reference_memory',
    transport: 'stdio',
    pin: '2026.7.4',
  },
  {
    file: 'engram.cordis.yml',
    id: 'memory-engram',
    serverName: 'engram',
    transport: 'stdio',
    pin: '1.20.0',
  },
]

/** 当前用例已启动、结束后必须统一释放的上下文集合。 */
const liveContexts = new Set<Context>()

/** 每个用例后释放全部真实插件树，避免子进程或服务残留。 */
afterEach(async () => {
  await Promise.all([...liveContexts].map(async ctx => ctx.fiber.dispose()))
  liveContexts.clear()
})

/**
 * 断言补丁只插入一行并返回该行。
 * @param patches 从一个示例加载的补丁列表。
 * @returns 唯一的插入配置行。
 * @example `insertedRow(loadOverlayPatches(name, file))`
 */
function insertedRow(patches: PatchOptions[]): InsertedRow {
  expect(patches).toHaveLength(1)
  /** 唯一补丁中的插入行列表。 */
  const insert = patches[0]?.insert
  expect(insert).toHaveLength(1)
  return insert?.[0] as InsertedRow
}

/**
 * 轮询工具注册表直至指定 MCP 工具出现或超时。
 * @param ctx 已启动的 Cordis 上下文。
 * @param name 期望工具名称。
 * @returns 工具出现时完成的 Promise。
 * @example `await waitForTool(ctx, 'mcp__server__greet')`
 */
async function waitForTool(ctx: Context, name: string): Promise<void> {
  /** 工具发现的绝对截止时间。 */
  const deadline = Date.now() + 10_000
  while (!ctx.tools.schemas().some(schema => schema.name === name)) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${name}`)
    await new Promise(resolveWait => setTimeout(resolveWait, 25))
  }
}

describe('third-party memory MCP example overlays', () => {
  it.each(examples)('parses $file with the documented generic plugin fields', (contract) => {
    /** 当前示例配置的绝对路径。 */
    const file = resolve(exampleDir, contract.file)
    /** 用于检查版本固定和密钥缺失的原始配置文本。 */
    const source = readFileSync(file, 'utf8')
    /** 解析后的唯一 MCP 客户端配置行。 */
    const row = insertedRow(loadOverlayPatches('memory-mcp-config-test', file))

    expect(row.id).toBe(contract.id)
    expect(row.name).toBe('@deepseek-ai/dsh-mcp-client')
    expect(row.config?.serverName).toBe(contract.serverName)
    expect(row.config?.transport).toBe(contract.transport)
    expect(source.split('\n', 1)[0]).toContain(contract.pin)
    expect(source).not.toMatch(/\bsk-[A-Za-z0-9_-]{8,}\b/)
    expect(source).not.toContain('DEEPSEEK_API_KEY')
  })

  it.each(examples)('loads $file and discovers a keyless fixture tool', async (contract) => {
    /** 当前示例解析出的可修改测试补丁。 */
    const patches = loadOverlayPatches(
      'memory-mcp-config-test',
      resolve(exampleDir, contract.file),
    )
    // The static config gate verifies the checked-in bare package specifier.
    // The unit test maps it to the source module so a clean checkout needs no
    // prebuilt `lib/` artifacts before proving the Loader/MCP behavior.
    // 静态门禁检查正式包名，单测映射到源码以便干净工作树无需预构建产物。
    insertedRow(patches).name = 'cordis:memory-test-mcp-client'
    /** 把示例连接目标替换为包内无密钥夹具的覆盖补丁。 */
    const fixturePatch: PatchOptions = {
      id: contract.id,
      config: {
        serverName: contract.serverName,
        transport: 'stdio',
        command: process.execPath,
        args: [fixtureServer],
        env: {},
        cwd: root,
        toolCallTimeoutMs: 5_000,
      },
    }
    /** 启动真实系统提示词、工具和 MCP 客户端后的测试上下文。 */
    const ctx = await boot(
      'memory-mcp-config-test',
      baseConfig,
      [...patches, fixturePatch],
      (ctx) => {
        liveContexts.add(ctx)
        ctx.loader.builtins['memory-test-system-prompt'] = SystemPrompt
        ctx.loader.builtins['memory-test-tools'] = ToolRuntime
        ctx.loader.builtins['memory-test-mcp-client'] = McpClient
      },
    )
    await waitForTool(ctx, `mcp__${contract.serverName}__greet`)
  }, 15_000)
})
