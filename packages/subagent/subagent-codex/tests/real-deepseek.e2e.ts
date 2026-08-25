/**
 * 文件职责：验证 real-deepseek.e2e.ts 覆盖的子代理启动、协议、继承与生命周期行为。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、进程协议或同进程代理驱动。
 * 产品维度：保障 Agent 能可靠委派任务、继承上下文并收集子代理结果。
 * 逻辑维度：准备代理配置，启动或连接子代理，转发事件，再处理结果、取消与清理。
 * 关键边界：异步状态不等于单次任务结果；外部输出不可信；清理必须等待子代理完全停止。
 * 新手阅读建议：先看公开配置和测试夹具，再读启动/事件流程，最后关注继承、取消与失败路径。
 */
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import * as codex from '../src/index.ts'
import {
  startDeepSeekResponsesBridge,
  /** 中文说明：type DeepSeekResponsesBridge 定义本测试所需的数据或行为，用于表达子代理场景。 */
  type DeepSeekResponsesBridge,
} from './deepseek-responses-bridge.ts'

/** 中文说明：变量 execFileAsync 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const execFileAsync = promisify(execFile)
/** 中文说明：变量 codexPackageJson 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const codexPackageJson = createRequire(import.meta.url).resolve('@openai/codex/package.json')
/** 中文说明：变量 codexPackage 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const codexPackage = JSON.parse(readFileSync(
  codexPackageJson,
  'utf8',
)) as { version: string; bin: { codex: string } }
/** 中文说明：变量 codexEntry 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const codexEntry = resolve(dirname(codexPackageJson), codexPackage.bin.codex)

/** 中文说明：变量 roots 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const roots: string[] = []
/** 中文说明：变量 contexts 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const contexts: Context[] = []
/** 中文说明：变量 bridges 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const bridges: DeepSeekResponsesBridge[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(bridges.splice(0).map(bridge => bridge.close()))
  /** 中文说明：该循环依次处理代理事件；循环变量仅在当前循环中有效。 */
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** 中文说明：函数 expectQuiescent 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function expectQuiescent(handles: readonly SubprocessHandle[]): Promise<void> {
  expect(handles.length).toBeGreaterThan(0)
  /** 中文说明：该循环依次处理代理事件；循环变量仅在当前循环中有效。 */
  for (const handle of handles) {
    await expect(handle.waitForExit()).resolves.toBe(true)
    await expect(handle.done).resolves.toHaveProperty('exitCode')
  }
}

describe.skipIf(!process.env.DEEPSEEK_API_KEY)(
  'Codex provider with real DeepSeek API',
  () => {
    it('returns one unique nonce through the production provider and real Codex', async () => {
      /** 中文说明：变量 apiKey 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const apiKey = process.env.DEEPSEEK_API_KEY
      if (apiKey === undefined) throw new Error('e2e ran without DEEPSEEK_API_KEY')
      /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const root = mkdtempSync(join(tmpdir(), 'dsh-codex-deepseek-e2e-'))
      roots.push(root)
      /** 中文说明：变量 workspace 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const workspace = join(root, 'workspace')
      /** 中文说明：变量 codexHome 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const codexHome = join(root, 'codex-home')
      mkdirSync(workspace)
      mkdirSync(codexHome)
      /** 中文说明：变量 nonce 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const nonce = `DSH_CODEX_DEEPSEEK_${randomUUID()}`
      /** 中文说明：变量 bridge 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const bridge = await startDeepSeekResponsesBridge(nonce)
      bridges.push(bridge)
      writeFileSync(join(codexHome, 'config.toml'), [
        'model = "deepseek-v4-flash"',
        'model_provider = "deepseek-e2e"',
        'approval_policy = "never"',
        'sandbox_mode = "read-only"',
        'disable_response_storage = true',
        'check_for_update_on_startup = false',
        '',
        '[model_providers.deepseek-e2e]',
        'name = "DeepSeek E2E bridge"',
        `base_url = "${bridge.baseUrl}"`,
        'env_key = "DEEPSEEK_API_KEY"',
        'wire_api = "responses"',
        'requires_openai_auth = false',
        '',
        '[analytics]',
        'enabled = false',
        '',
      ].join('\n'))
      /** 中文说明：变量 env 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const env = {
        DEEPSEEK_API_KEY: apiKey,
        CODEX_HOME: codexHome,
        HOME: root,
        XDG_CONFIG_HOME: join(root, 'xdg-config'),
        PATH: root,
        HTTP_PROXY: '',
        HTTPS_PROXY: '',
        ALL_PROXY: '',
        NO_PROXY: '127.0.0.1,localhost',
      }
      /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const ctx = new Context()
      contexts.push(ctx)
      await ctx.plugin(SubagentRuntime)
      await ctx.plugin(LocalSubprocessRuntime)
      /** 中文说明：变量 handles 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const handles: SubprocessHandle[] = []
      /** 中文说明：变量 spawn 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const spawn = ctx.subprocess.spawn.bind(ctx.subprocess)
      vi.spyOn(ctx.subprocess, 'spawn').mockImplementation((spec) => {
        /** 中文说明：变量 handle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const handle = spawn(spec)
        handles.push(handle)
        return handle
      })
      await ctx.plugin(codex, { env, disposeGraceMs: 2_000 })
      /** 中文说明：变量 version 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const version = await execFileAsync(process.execPath, [codexEntry, '--version'], {
        env: { ...process.env, ...env },
      })
      expect(codexPackage.version).toBe('0.147.0')
      expect(version.stdout.trim()).toBe('codex-cli 0.147.0')

      /** 中文说明：变量 parent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const parent = {
        id: 'deepseek-e2e-parent',
        session: { header: { cwd: workspace } },
      } as unknown as Agent
      /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const run = await ctx.subagents.start('codex', {
        prompt: [{
          type: 'text',
          text: `Reply with exactly ${nonce} and nothing else. Do not use tools.`,
        }],
        parent,
        signal: new AbortController().signal,
      })
      /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const result = await run.result
      await run.dispose()

      expect(result.stopReason).toBe('completed')
      /** 中文说明：变量 text 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const text = result.output
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('')
        .trim()
      expect(text).toBe(nonce)
      expect(bridge.completedRequests).toBe(1)
      await expectQuiescent(handles)
    }, 180_000)
  },
)
