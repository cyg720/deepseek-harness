/**
 * Real-composition guard for the dynamic-configuration chain: LlmRuntime,
 * settings-file, credentials-local, and llm-deepseek boot from a test-only
 * cordis.yml through the actual Loader + Include path, external edits of
 * settings.yaml and the credentials document hot-publish through their providers, and the very
 * next request carries the fresh base URL and credential. The same adapter
 * composition without settings or credentials entries keeps entry-config
 * behavior — the documented optional-inject fallback.
 */
/**
 * 文件职责：验证DeepSeek LLM的 loader-composition.spec.ts 行为与网络边界。
 * 技术维度：TypeScript、Fetch、SSE、OAuth/密钥认证、模型目录和运行时模式校验。
 * 产品维度：让 Agent 能稳定调用供应商模型、发现能力并接收流式结果。
 * 逻辑维度：构造请求或模拟服务器，驱动适配器并断言事件与错误。
 * 关键边界：网络响应属于不可信输入；密钥和令牌不得记录；取消必须终止请求与流。
 * 新手阅读建议：先读 config/auth/catalog，再看 adapter/stream，最后阅读错误和重放测试。
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import FileSettingsProvider from '@deepseek-ai/dsh-settings-file'
import { getOrCreateAnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import * as LlmDeepSeek from '@deepseek-ai/dsh-llm-deepseek'
import { assemble } from './assemble.ts'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'

/** 中文说明：测试局部值 NS，由紧邻初始化决定。 */
const NS = settingsNamespace('llm-deepseek')
/** 中文说明：测试局部值 KEY_REF，由紧邻初始化决定。 */
const KEY_REF = credentialRef('DEEPSEEK_API_KEY')

/** 中文说明：测试局部值 root: string | undefined，由紧邻初始化决定。 */
let root: string | undefined
/** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  await closeMockServers()
  vi.unstubAllEnvs()
})

/** 中文说明：函数 loadComposition 的参数见签名，返回结果供模型流程使用；示例见本文件。 */
async function loadComposition(
  options: { withDynamic: boolean; baseURL: string; reuseRoot?: string },
): Promise<{ ctx: Context; settingsPath: string; credentialsPath: string }> {
  // A reused root is the restart case: the same harness home, its documents
  // exactly as the previous process left them.
  /** 中文说明：测试局部值 fresh，由紧邻初始化决定。 */
  const fresh = options.reuseRoot === undefined
  root = options.reuseRoot ?? await mkdtemp(join(tmpdir(), 'dsh-llm-composition-'))
  vi.stubEnv('DSH_HOME', root)
  /** 中文说明：测试局部值 settingsPath，由紧邻初始化决定。 */
  const settingsPath = join(root, 'settings.yaml')
  /** 中文说明：测试局部值 credentialsPath，由紧邻初始化决定。 */
  const credentialsPath = join(root, '.credentials.yaml')
  if (options.withDynamic && fresh) {
    await writeFile(settingsPath, '# personal settings\n')
    await writeFile(credentialsPath, 'version: 1\nrefs:\n  DEEPSEEK_API_KEY: boot-key\n', { mode: 0o600 })
  }

  /** 中文说明：测试局部值 configPath，由紧邻初始化决定。 */
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    '- id: llm',
    "  name: 'test-llm-service'",
    ...options.withDynamic
      ? [
        '- id: settings',
        "  name: '@deepseek-ai/dsh-settings-file'",
        '  config:',
        `    path: ${JSON.stringify(settingsPath)}`,
        '    debounceMs: 10',
        '- id: credentials',
        "  name: '@deepseek-ai/dsh-credentials-local'",
        '  config:',
        `    path: ${JSON.stringify(credentialsPath)}`,
        '    debounceMs: 10',
      ]
      : [],
    '- id: llm-deepseek',
    "  name: '@deepseek-ai/dsh-llm-deepseek'",
    '  config:',
    `    baseURL: ${JSON.stringify(options.baseURL)}`,
    '',
  ].join('\n'))

  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  /** 中文说明：测试局部值 modules，由紧邻初始化决定。 */
  const modules = new Map<string, unknown>([
    ['test-llm-service', LlmRuntime],
    ['@deepseek-ai/dsh-settings-file', FileSettingsProvider],
    ['@deepseek-ai/dsh-credentials-local', LocalCredentialProvider],
    ['@deepseek-ai/dsh-llm-deepseek', LlmDeepSeek],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await ctx.loader.await()
  return { ctx, settingsPath, credentialsPath }
}

describe('llm-deepseek real dynamic composition', () => {
  it('boots from cordis.yml and routes the next request after external settings and credential edits', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', '')
    /** 中文说明：测试局部值 serverA，由紧邻初始化决定。 */
    const serverA = await mockServer([{ kind: 'sse', events: textEvents }])
    /** 中文说明：测试局部值 serverB，由紧邻初始化决定。 */
    const serverB = await mockServer([{ kind: 'sse', events: textEvents }])
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    const { ctx, settingsPath, credentialsPath } = await loadComposition({ withDynamic: true, baseURL: serverA.url })

    expect(ctx.get('settings')!.describe().map(entry => entry.ns)).toEqual([NS])
    await assemble(ctx, { model: 'deepseek-v4-flash', messages: [] })
    expect(serverA.headers[0]?.authorization).toBe('Bearer boot-key')
    expect(serverA.headers[0]?.['x-deepseek-harness-user-id']).toBe(getOrCreateAnonymousUserId())

    // External edits, exactly as a user or the web UI would leave them on disk.
    await writeFile(settingsPath, `llm-deepseek:\n  baseURL: ${serverB.url}\n`)
    await vi.waitFor(() => {
      expect((ctx.get('settings')!.get(NS) as { baseURL?: string }).baseURL).toBe(serverB.url)
    }, { timeout: 5000 })
    await writeFile(credentialsPath, 'version: 1\nrefs:\n  DEEPSEEK_API_KEY: rotated-key\n', { mode: 0o600 })
    await vi.waitFor(async () => {
      expect(await ctx.get('credentials')!.resolve(KEY_REF)).toEqual({ value: 'rotated-key', source: 'file' })
    }, { timeout: 5000 })

    await assemble(ctx, { model: 'deepseek-v4-flash', messages: [] })
    expect(serverA.requests).toHaveLength(1)
    expect(serverB.headers[0]?.authorization).toBe('Bearer rotated-key')
  })

  it('keeps a stored key writable and rotatable across a real restart', async () => {
    // No ambient DEEPSEEK_API_KEY: the shipped surfaces do not hoist
    // the credentials document into process.env, so a stored key must stay file-sourced.
    vi.stubEnv('DEEPSEEK_API_KEY', '')
    /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
    const first = await mockServer([{ kind: 'sse', events: textEvents }])
    /** 中文说明：测试局部值 second，由紧邻初始化决定。 */
    const second = await mockServer([{ kind: 'sse', events: textEvents }])
    /** 中文说明：测试局部值 boot，由紧邻初始化决定。 */
    const boot = await loadComposition({ withDynamic: true, baseURL: first.url })
    /** 中文说明：测试局部值 home，由紧邻初始化决定。 */
    const home = root!
    await boot.ctx.get('credentials')!.set(KEY_REF, 'stored-by-ui')
    expect(await boot.ctx.get('credentials')!.describe(KEY_REF))
      .toEqual({ configured: true, source: 'file', writable: true })
    await assemble(boot.ctx, { model: 'deepseek-v4-flash', messages: [] })
    expect(first.headers[0]?.authorization).toBe('Bearer stored-by-ui')
    await boot.ctx.fiber.dispose()
    context = undefined

    // Restart over the same harness home.
    /** 中文说明：测试局部值 restarted，由紧邻初始化决定。 */
    const restarted = await loadComposition({ withDynamic: true, baseURL: second.url, reuseRoot: home })
    /** 中文说明：测试局部值 credentials，由紧邻初始化决定。 */
    const credentials = restarted.ctx.get('credentials')!
    // The stored key is still the provider's own writable file entry — not a
    // read-only launch override, which is what hoisting it would have made it.
    expect(await credentials.resolve(KEY_REF)).toEqual({ value: 'stored-by-ui', source: 'file' })
    expect(await credentials.describe(KEY_REF)).toEqual({ configured: true, source: 'file', writable: true })
    // Rotation still works after the restart, and the next request uses it.
    await credentials.set(KEY_REF, 'rotated-after-restart')
    await assemble(restarted.ctx, { model: 'deepseek-v4-flash', messages: [] })
    expect(second.headers[0]?.authorization).toBe('Bearer rotated-after-restart')
  })

  it('boots the same adapter on entry config alone, resolving the reference from the environment', async () => {
    // No settings and no credentials provider: configuration carries only the
    // reference, so the environment is the whole credential plane here.
    vi.stubEnv('DEEPSEEK_API_KEY', 'entry-key')
    /** 中文说明：测试局部值 server，由紧邻初始化决定。 */
    const server = await mockServer([{ kind: 'sse', events: textEvents }])
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await loadComposition({ withDynamic: false, baseURL: server.url })

    expect(ctx.get('settings')).toBeUndefined()
    expect(ctx.get('credentials')).toBeUndefined()
    await assemble(ctx, { model: 'deepseek-v4-flash', messages: [] })
    expect(server.headers[0]?.authorization).toBe('Bearer entry-key')
  })
})
