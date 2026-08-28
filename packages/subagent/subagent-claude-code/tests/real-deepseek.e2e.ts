/**
 * 文件职责：验证 real-deepseek.e2e.ts 覆盖的子代理进程与协议行为与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、文件存储或受控子进程协议。
 * 产品维度：保障 Agent 的子代理进程与协议能力稳定、安全且可诊断。
 * 逻辑维度：准备或解析输入，执行核心流程，再处理结果、错误与资源清理。
 * 关键边界：外部进程和持久化数据不可信；敏感环境需净化；清理必须等待资源完全停止。
 * 新手阅读建议：先看导出类型和夹具，再读主流程，最后关注协议错误、恢复和清理。
 */
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import * as claudeCode from '../src/index.ts'

/** 中文说明：变量 execFileAsync 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const execFileAsync = promisify(execFile)
/** 中文说明：常量 OFFICIAL_DEEPSEEK_BASE_URL 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const OFFICIAL_DEEPSEEK_BASE_URL = 'https://api.deepseek.com'
/** 中文说明：变量 sdkRoot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const sdkRoot = dirname(fileURLToPath(
  import.meta.resolve('@anthropic-ai/claude-agent-sdk'),
))
/** 中文说明：变量 sdkPackage 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const sdkPackage = JSON.parse(readFileSync(
  join(sdkRoot, 'package.json'),
  'utf8',
)) as {
  version: string
  claudeCodeVersion: string
  optionalDependencies: Record<string, string>
}
/** 中文说明：变量 platformPackage 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const platformPackage = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`
/** 中文说明：变量 platformRoot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const platformRoot = resolve(sdkRoot, '..', platformPackage.split('/')[1]!)
/** 中文说明：变量 claudeBin 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const claudeBin = join(
  platformRoot,
  process.platform === 'win32' ? 'claude.exe' : 'claude',
)

/** 中文说明：变量 roots 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const roots: string[] = []
/** 中文说明：变量 contexts 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** 中文说明：函数 deepSeekBaseUrl 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function deepSeekBaseUrl(): string {
  /** 中文说明：变量 configured 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const configured = (process.env.DEEPSEEK_BASE_URL ?? OFFICIAL_DEEPSEEK_BASE_URL)
    .replace(/\/+$/, '')
  if (configured !== OFFICIAL_DEEPSEEK_BASE_URL) {
    throw new Error('Claude Code DeepSeek e2e requires the official DeepSeek base URL')
  }
  return configured
}

/** 中文说明：函数 expectQuiescent 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function expectQuiescent(handles: readonly SubprocessHandle[]): Promise<void> {
  expect(handles.length).toBeGreaterThan(0)
  /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
  for (const handle of handles) {
    await expect(handle.waitForExit()).resolves.toBe(true)
    await expect(handle.done).resolves.toHaveProperty('exitCode')
  }
}

describe.skipIf(!process.env.DEEPSEEK_API_KEY)(
  'Claude Code provider with real DeepSeek API',
  () => {
    it('returns one unique nonce through the production provider and real SDK/CLI', async () => {
      /** 中文说明：变量 apiKey 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const apiKey = process.env.DEEPSEEK_API_KEY
      if (apiKey === undefined) throw new Error('e2e ran without DEEPSEEK_API_KEY')
      /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const root = mkdtempSync(join(tmpdir(), 'dsh-claude-deepseek-e2e-'))
      roots.push(root)
      /** 中文说明：变量 workspace 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const workspace = join(root, 'workspace')
      /** 中文说明：变量 claudeConfig 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const claudeConfig = join(root, 'claude-config')
      /** 中文说明：变量 xdgConfig 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const xdgConfig = join(root, 'xdg-config')
      /** 中文说明：变量 xdgCache 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const xdgCache = join(root, 'xdg-cache')
      /** 中文说明：变量 xdgData 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const xdgData = join(root, 'xdg-data')
      /** 中文说明：变量 xdgState 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const xdgState = join(root, 'xdg-state')
      /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
      for (const directory of [
        workspace,
        claudeConfig,
        xdgConfig,
        xdgCache,
        xdgData,
        xdgState,
      ]) mkdirSync(directory)

      /** 中文说明：变量 env 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const env = {
        ANTHROPIC_AUTH_TOKEN: apiKey,
        ANTHROPIC_BASE_URL: `${deepSeekBaseUrl()}/anthropic`,
        ANTHROPIC_MODEL: 'deepseek-v4-pro[1m]',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'deepseek-v4-pro[1m]',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'deepseek-v4-pro[1m]',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'deepseek-v4-flash',
        CLAUDE_CODE_SUBAGENT_MODEL: 'deepseek-v4-flash',
        CLAUDE_CODE_EFFORT_LEVEL: 'max',
        CLAUDE_CONFIG_DIR: claudeConfig,
        HOME: root,
        XDG_CONFIG_HOME: xdgConfig,
        XDG_CACHE_HOME: xdgCache,
        XDG_DATA_HOME: xdgData,
        XDG_STATE_HOME: xdgState,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1',
        DISABLE_TELEMETRY: '1',
        DISABLE_ERROR_REPORTING: '1',
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
      await ctx.plugin(claudeCode, { env, disposeGraceMs: 3_000 })

      expect(sdkPackage.version).toBe('0.3.241')
      expect(sdkPackage.claudeCodeVersion).toBe('2.1.241')
      expect(sdkPackage.optionalDependencies[platformPackage]).toBe('0.3.241')
      const version = await execFileAsync(claudeBin, ['--version'], {
        env: { ...process.env, ...env },
      })
      expect(version.stdout.trim()).toBe('2.1.241 (Claude Code)')

      /** 中文说明：变量 nonce 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const nonce = `DSH_CLAUDE_DEEPSEEK_${randomUUID()}`
      /** 中文说明：变量 parent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const parent = {
        id: 'deepseek-e2e-parent',
        session: { header: { cwd: workspace } },
      } as unknown as Agent
      /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const run = await ctx.subagents.start('claude-code', {
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
      await expectQuiescent(handles)
    }, 180_000)
  },
)
