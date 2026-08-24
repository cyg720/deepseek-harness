/**
 * The shipped shell composition: the base bundle gates both shell stacks by
 * platform on its own rows (`disabled: !!js process.platform`), so exactly
 * one shell stack mounts per host and no separate platform layer exists —
 * the launcher applies nothing beyond the bundle layers. The spec composes
 * the REAL shipped bundle layers (dsh-base + dsh-web-app resolved from the
 * app installation anchor) through the boot's patch algorithm and pins the
 * effective per-platform roster, the preset-level gates that keep tool-bash
 * out of win32 sessions and tool-pwsh out of POSIX sessions, and the
 * cold-start resolution closure for the pwsh rows' bare plugin names.
 */
/**
 * 文件职责：验证发布配置在 Windows 与 POSIX 上只启用对应 shell 栈，并保持权限层一致。
 * 技术维度：使用真实 bundle 补丁组合、YAML 解析和受控 JavaScript 表达式求值模拟平台。
 * 产品维度：用户在不同操作系统上自动获得受沙箱约束的正确 shell，不会同时暴露两套工具。
 * 逻辑维度：组合 Web/基础配置，按平台求值 disabled，再检查预设工具和 minimal 持久终端分组。
 * 关键边界：测试必须读取真实发布配置而非夹具；平台表达式在模拟 process 对象中求值。
 * 新手阅读建议：先理解 disabledOn，再看主机配置两例，最后比较各代理预设的 shell 行。
 */

import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { evaluate } from '@deepseek-ai/cordis-plugin-loader'
import { composeEntries, initProfile, loadProfile, PROFILES_DIR } from '@deepseek-ai/dsh-app-boot'

/**
 * The effective disabled state of one row on one platform: a `!!js` expression
 * evaluates with a platform-scoped `process` so both outcomes pin on any host.
 */
/**
 * 计算一行配置在指定模拟平台上的最终禁用状态。
 * @param row 可能包含布尔值或 !!js 表达式的配置行。
 * @param platform 要模拟的 Windows 或 Linux 平台。
 * @returns 该行在目标平台是否禁用。
 * @example `disabledOn(row, 'win32')`
 */
function disabledOn(row: { disabled?: unknown }, platform: 'win32' | 'linux'): boolean {
  /** 配置行原始 disabled 值。 */
  const value = row.disabled
  if (value !== null && typeof value === 'object' && '__jsExpr' in value) {
    return Boolean(evaluate({ process: { platform } }, (value as { __jsExpr: string }).__jsExpr))
  }
  return value === true
}

describe('the shipped shell composition (real bundle layers)', () => {
  /** 当前用例创建并在结束后删除的临时 DSH_HOME。 */
  let home: string
  /** 每个用例后删除临时配置目录。 */
  afterEach(() => { if (home !== undefined) rmSync(home, { recursive: true, force: true }) })
  // The app installation anchor, mirroring profile-boot.ts: the bundle layers
  // resolve from the REAL dsh-base/dsh-web-app packages through it, so this
  // suite composes the shipped patch files, not test fixtures.
  // 安装锚点与 profile-boot 相同，确保解析真实 dsh-base 和 dsh-web-app，而非测试夹具。
  /** dsh 应用 package.json 的真实安装锚点。 */
  const anchor = fileURLToPath(new URL('../package.json', import.meta.url))

  it('composes the confined pwsh roster on win32 and the bash roster on POSIX from the same rows', () => {
    home = mkdtempSync(join(tmpdir(), 'dsh-windows-home-'))
    initProfile(join(home, PROFILES_DIR, 'web'), ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
    /** 从真实 bundle 层加载出的临时 Web 配置。 */
    const profile = loadProfile('dsh', 'web', anchor, home)
    /** 补丁组合期间收集的诊断，成功场景应为空。 */
    const warnings: string[] = []
    /** 按应用顺序组合后的有效配置行。 */
    const rows = composeEntries(
      profile.layers.map(layer => layer.patches),
      message => warnings.push(message),
    )
    /** 配置行编号到有效行的查询映射。 */
    const byId = new Map(rows.map(row => [row.id, row]))
    // One shared patch set, two rosters: the shell stacks gate themselves.
    // 同一组补丁同时携带两套 shell，由各行自身的平台条件决定实际名册。
    for (const id of ['bash-sandbox', 'pwsh-sandbox', 'tool-bash', 'tool-pwsh']) {
      expect(byId.has(id), `row ${id}`).toBe(true)
    }
    expect(disabledOn(byId.get('bash-sandbox')!, 'win32'), 'bash-sandbox on win32').toBe(true)
    expect(disabledOn(byId.get('bash-sandbox')!, 'linux'), 'bash-sandbox on linux').toBe(false)
    expect(disabledOn(byId.get('pwsh-sandbox')!, 'win32'), 'pwsh-sandbox on win32').toBe(false)
    expect(disabledOn(byId.get('pwsh-sandbox')!, 'linux'), 'pwsh-sandbox on linux').toBe(true)
    // Host shell-tool rows are disabled on every platform; sessions mount
    // their own rows instead.
    // 主机层 shell 工具在所有平台均关闭，具体会话由预设挂载自己的工具行。
    expect(byId.get('tool-bash')?.disabled).toBe(true)
    expect(byId.get('tool-pwsh')?.disabled).toBe(true)
    // The permission surface never moves: the sandbox/policy rows, the
    // permission switcher, fs-sandbox, and the approval service stay enabled
    // exactly as on POSIX — the confined pwsh executor is what changes.
    // 权限、策略、文件沙箱和审批层不随平台移动，仅实际执行器由 bash 换成 pwsh。
    for (const id of ['permission', 'ui-permission', 'sandbox', 'sandbox-policy', 'fs-sandbox', 'approval']) {
      expect(byId.get(id)?.disabled, `row ${id}`).not.toBe(true)
    }
    // The launcher's cold-start module fallback BFS-links the apps/cli
    // dependency closure into the profile's node_modules, so every bare
    // plugin name in the base patch must resolve from there.
    // 冷启动模块回退会把 CLI 依赖闭包链接到配置目录，因此基础补丁的裸包名必须可解析。
    /** CLI 清单中的直接依赖，用于固定冷启动解析闭包。 */
    const cliManifest = JSON.parse(readFileSync(anchor, 'utf8')) as { dependencies?: Record<string, string> }
    for (const name of ['@deepseek-ai/dsh-pwsh-sandbox', '@deepseek-ai/dsh-tool-pwsh']) {
      expect(cliManifest.dependencies?.[name], `cold-start closure must reach ${name}`).toBeDefined()
    }
    expect(warnings).toEqual([])
  })

  it('base-only profiles carry both stacks with the same platform gating', () => {
    home = mkdtempSync(join(tmpdir(), 'dsh-windows-home-'))
    initProfile(join(home, PROFILES_DIR, 'base-only'), ['@deepseek-ai/dsh-base'])
    /** 只包含基础 bundle 的临时配置。 */
    const profile = loadProfile('dsh', 'base-only', anchor, home)
    /** 基础配置组合期间收集的诊断。 */
    const warnings: string[] = []
    /** 基础 bundle 组合后的有效行。 */
    const rows = composeEntries(
      profile.layers.map(layer => layer.patches),
      message => warnings.push(message),
    )
    /** 基础配置行编号到有效行的查询映射。 */
    const byId = new Map(rows.map(row => [row.id, row]))
    for (const id of ['bash-sandbox', 'tool-bash', 'pwsh-sandbox', 'tool-pwsh']) {
      expect(byId.has(id), `row ${id}`).toBe(true)
    }
    // No web overlay: the tool rows keep their own gating too.
    // 没有 Web 覆盖层时，工具行仍使用自身平台条件。
    expect(disabledOn(byId.get('tool-bash')!, 'win32'), 'tool-bash on win32').toBe(true)
    expect(disabledOn(byId.get('tool-bash')!, 'linux'), 'tool-bash on linux').toBe(false)
    expect(disabledOn(byId.get('tool-pwsh')!, 'win32'), 'tool-pwsh on win32').toBe(false)
    expect(disabledOn(byId.get('tool-pwsh')!, 'linux'), 'tool-pwsh on linux').toBe(true)
    expect(warnings).toEqual([])
  })
})

describe('shipped agent presets gate both shell tools by platform', () => {
  /** 随 CLI 发布的代理预设根目录。 */
  const presetRoot = resolve(fileURLToPath(new URL('../package.json', import.meta.url)), '..', 'config', 'agent-presets')

  it.each(['standard', 'code', 'cordis'])('preset %s gates its shell tool rows by platform', (preset) => {
    /** 当前完整预设解析出的顶层配置行。 */
    const entries: unknown = yaml.load(
      readFileSync(join(presetRoot, preset, 'agent.cordis.yml'), 'utf8'),
      { schema: entryListSchema },
    )
    if (!Array.isArray(entries)) throw new TypeError(`preset ${preset} must parse to an entry array`)
    for (const [id, win32] of [['tool-bash', true], ['tool-pwsh', false]] as const) {
      /** 当前预设中目标 shell 工具的配置行。 */
      const row = entries.find((entry): entry is Record<string, unknown> => (
        typeof entry === 'object' && entry !== null && (entry as Record<string, unknown>).id === id
      ))
      if (row === undefined) throw new TypeError(`preset ${preset} must mount ${id}`)
      expect(row.disabled).toMatchObject({ __jsExpr: expect.any(String) as string })
      // A platform-scoped context pins both outcomes on every host.
      // 使用限定平台的求值上下文，让任意宿主都能验证两种结果。
      /** 目标工具行中的平台禁用表达式文本。 */
      const expression = (row.disabled as { __jsExpr: string }).__jsExpr
      expect(Boolean(evaluate({ process: { platform: 'win32' } }, expression)), `${id} on win32`).toBe(win32)
      expect(Boolean(evaluate({ process: { platform: 'linux' } }, expression)), `${id} on linux`).toBe(!win32)
    }
  })

  it('minimal mounts no shell tool row and gates its persistent shell stack by platform', () => {
    /** minimal 预设解析出的顶层配置行。 */
    const entries: unknown = yaml.load(
      readFileSync(join(presetRoot, 'minimal', 'agent.cordis.yml'), 'utf8'),
      { schema: entryListSchema },
    )
    if (!Array.isArray(entries)) throw new TypeError('minimal preset must parse to an entry array')
    for (const id of ['tool-bash', 'tool-pwsh']) {
      expect(entries.some(entry => (
        typeof entry === 'object' && entry !== null && (entry as Record<string, unknown>).id === id
      )), `${id} must be absent from minimal`).toBe(false)
    }
    /** minimal 中承载两套持久 shell 子行的分组。 */
    const group = entries.find((entry): entry is Record<string, unknown> => (
      typeof entry === 'object' && entry !== null && (entry as Record<string, unknown>).id === 'persistent-shell'
    ))
    if (group === undefined) throw new TypeError('minimal preset must mount persistent-shell')
    /** persistent-shell 分组中的子配置行。 */
    const rows = group.config as unknown[]
    if (!Array.isArray(rows)) throw new TypeError('persistent-shell must carry a row list')
    /** 持久 shell 子行编号到配置行的映射。 */
    const byId = new Map(rows
      .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
      .map(entry => [entry.id, entry]))
    // The bash stack (terminal-bash + persistent-bash) mounts on POSIX only; the
    // pwsh twin (terminal-bash with shellDialect pwsh + persistent-pwsh) mounts on
    // win32 only — exactly one persistent shell per host.
    // bash 双行只在 POSIX 启用，pwsh 双行只在 Windows 启用，每台主机恰有一个持久 shell。
    for (const id of ['terminal-bash', 'persistent-bash']) {
      expect(disabledOn(byId.get(id)!, 'win32'), `${id} on win32`).toBe(true)
      expect(disabledOn(byId.get(id)!, 'linux'), `${id} on linux`).toBe(false)
    }
    for (const id of ['terminal-pwsh', 'persistent-pwsh']) {
      expect(disabledOn(byId.get(id)!, 'win32'), `${id} on win32`).toBe(false)
      expect(disabledOn(byId.get(id)!, 'linux'), `${id} on linux`).toBe(true)
    }
    expect(byId.get('terminal-pwsh')?.config).toMatchObject({ shellDialect: 'pwsh' })
  })
})
