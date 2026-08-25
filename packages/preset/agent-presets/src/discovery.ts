/**
 * Filesystem discovery of agent presets. A preset is a directory holding
 * {@link COMPOSITION_FILE}, optionally beside a {@link METADATA_FILE} carrying
 * its display text; the directory name is the preset id. Discovery
 * re-reads the roots on every call so a preset authored while the process is
 * running is visible without a restart.
 *
 * Discovery also owns preset HEALTH: a directory whose composition is
 * missing or unloadable is reported as a broken roster row rather than
 * skipped. A skipped directory would still occupy its id on disk — the copy
 * path refuses the name while no surface shows anything to delete — and a
 * malformed composition would otherwise read as an ordinary preset until the
 * first session fails to mount it.
 * @module @deepseek-ai/dsh-agent-presets/discovery
 */
/*
 * 文件职责：实现 discovery.ts 承担的Agent 预设配置、装载与运行时协作职责。
 * 技术维度：使用 TypeScript、Cordis 插件、事件日志、配置解析和异步生命周期管理。
 * 产品维度：让 Agent 能按用户配置启用Agent 预设并保持会话行为一致。
 * 逻辑维度：解析输入配置，注册插件能力，处理事件，并在卸载时清理资源。
 * 关键边界：配置错误应尽早失败；模型可见状态必须写入日志；注册必须可撤销。
 * 新手阅读建议：先看导出类型和配置，再读插件入口与事件处理，最后关注校验和清理。
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { load } from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { expandHomePath } from '@deepseek-ai/dsh-home-paths'
import { readPresetMetadata } from './metadata.ts'
import { PRESET_ID, type AgentPreset, type PresetRoot } from './preset.ts'

/** The composition file that makes a directory a preset. */
/* 中文说明：常量 COMPOSITION_FILE 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
export const COMPOSITION_FILE = 'agent.cordis.yml'

/**
 * Harness-home directory holding locally authored presets.
 *
 * This package owns the writable root the way `dsh-skill-filesystem` owns
 * `<dshHome>/skills`. An app must assemble the SHIPPED root, whose path only
 * the installed app can resolve; where a person's own presets go is the same
 * place in every deployment that does not say otherwise, so a launcher that
 * forgets to configure one still finds them.
 *
 * Package-internal on purpose: no consumer outside this package addresses the
 * directory by name, and a test that imported it could not catch this value
 * being wrong — the expected segment is spelled out where it is asserted.
 */
/* 中文说明：常量 USER_PRESET_DIR 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
export const USER_PRESET_DIR = '.agent-presets'

/**
 * Why `rows` cannot be an entry list, or undefined when it can.
 *
 * A shallow shape check, deliberately short of the loader's work: it does not
 * resolve plugin names or apply configs. What it catches is the hand-edit
 * that produces a file the loader cannot even begin with — and it must accept
 * everything the loader accepts, which is why rows are only required to be
 * maps carrying a plugin `name` (groups recurse into their own lists).
 * @param rows - the parsed composition document.
 * @param at - row-path prefix for nested diagnostics, empty at the top level.
 * @returns one human-readable reason, or undefined when the shape holds.
 */
/* 中文说明：函数 entryListProblem 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function entryListProblem(rows: unknown, at = ''): string | undefined {
  if (!Array.isArray(rows)) {
    return at === ''
      ? 'the composition must be a top-level list of plugin rows'
      : `group ${at} must hold a list of plugin rows`
  }
  /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
  for (const [index, row] of rows.entries()) {
    /** 中文说明：变量 label 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const label = at === '' ? `row ${String(index + 1)}` : `${at} row ${String(index + 1)}`
    if (typeof row !== 'object' || row === null || Array.isArray(row)) {
      return `${label} is not a plugin row (expected a map with a "name")`
    }
    const { name, group, config } = row as { name?: unknown; group?: unknown; config?: unknown }
    if (typeof name !== 'string' || name === '') {
      return `${label} names no plugin (a "name" string is required)`
    }
    if (group === true) {
      /** 中文说明：变量 nested 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const nested = entryListProblem(config, label)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

/**
 * Why the composition at `path` cannot mount, or undefined when it looks
 * loadable. Parsed with the loader's own YAML dialect ({@link entryListSchema},
 * the one carrying `!!js`), so health can never call a composition broken
 * that the loader would accept.
 * @param path - absolute path of the composition file.
 * @returns one human-readable reason, or undefined when the file is loadable.
 */
/* 中文说明：函数 compositionProblem 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
async function compositionProblem(path: string): Promise<string | undefined> {
  /** 中文说明：变量 content 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let content: string
  try {
    content = await readFile(path, 'utf8')
  } catch {
    // The caller statted this file moments ago; any read failure now —
    // deleted in between, permissions — is the same answer as unparsable.
    return `the composition file ${COMPOSITION_FILE} cannot be read`
  }
  /** 中文说明：变量 rows 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let rows: unknown
  try {
    rows = load(content, { schema: entryListSchema })
  } catch (error) {
    /** 中文说明：变量 full 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    /* v8 ignore next -- js-yaml throws YAMLException (an Error) for every parse failure; the fallback keeps a hostile value readable */
    const full = error instanceof Error ? error.message : String(error)
    // First line only: js-yaml appends a multi-line code-frame snippet, and
    // the reason is displayed on a roster card, not in a terminal.
    return `the composition is not valid YAML: ${full.replace(/\n[\s\S]*$/, '')}`
  }
  return entryListProblem(rows)
}

/**
 * Whether `path` names an existing regular file.
 * @param path - absolute path to test.
 * @returns true when the path resolves to a file.
 */
/* 中文说明：函数 isFile 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    // Any stat failure — absent, unreadable, a dangling link — means this
    // directory does not present a composition, which is not an error: the
    // directory simply is not a preset.
    return false
  }
}

/**
 * Scan one root for preset directories.
 *
 * An absent root yields no presets rather than throwing: the user root does
 * not exist until the first locally authored preset, and naming a default
 * that no root supplies already fails loud at resolution.
 *
 * Every directory whose name is a usable preset id is a roster row — broken
 * when its composition is missing or unloadable. A directory named outside
 * {@link PRESET_ID} is skipped instead: no copy could ever claim that name,
 * so it blocks nothing, and reporting `.DS_Store`-grade residue as broken
 * presets would teach users to ignore the marker.
 * @param root - the directory and the trust its presets inherit.
 * @returns the root's presets ordered by id.
 */
/*
 * 中文说明：函数 scanRoot 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param root 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export async function scanRoot(root: PresetRoot): Promise<AgentPreset[]> {
  /** 中文说明：变量 dir 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const dir = resolve(expandHomePath(root.path))
  /** 中文说明：变量 children 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let children
  try {
    children = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw new Error(`agent-presets: cannot read preset root ${dir}: ${String(error)}`, { cause: error })
  }
  /** 中文说明：变量 found 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const found: AgentPreset[] = []
  /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
  for (const child of children) {
    if (!child.isDirectory() || !PRESET_ID.test(child.name)) continue
    /** 中文说明：变量 directory 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const directory = join(dir, child.name)
    /** 中文说明：变量 path 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = join(directory, COMPOSITION_FILE)
    /** 中文说明：变量 broken 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const broken = await isFile(path)
      ? await compositionProblem(path)
      : `the composition file ${COMPOSITION_FILE} is missing — the directory still occupies the id; delete it or restore the file`
    // Display text only, and never fatal: a preset with unreadable metadata
    // still mounts, it just shows its id.
    /** 中文说明：变量 metadata 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const metadata = await readPresetMetadata(directory)
    found.push({
      id: child.name, trust: root.trust, path, ...metadata,
      ...broken === undefined ? {} : { broken },
    })
  }
  // Declared order first so the shipped set reads by capability; everything
  // else falls back to the id, which keeps authored presets stable.
  return found.sort((left, right) => {
    /** 中文说明：变量 byOrder 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const byOrder = (left.order ?? Number.POSITIVE_INFINITY) - (right.order ?? Number.POSITIVE_INFINITY)
    return byOrder === 0 ? left.id.localeCompare(right.id) : byOrder
  })
}

/**
 * Scan every root in precedence order.
 * @param roots - roots in precedence order; an earlier root wins a duplicate id.
 * @returns every discovered preset, first-root-wins per id.
 */
/*
 * 中文说明：函数 discoverPresets 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param roots 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export async function discoverPresets(roots: readonly PresetRoot[]): Promise<AgentPreset[]> {
  /** 中文说明：变量 byId 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const byId = new Map<string, AgentPreset>()
  /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
  for (const root of roots) {
    /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
    for (const preset of await scanRoot(root)) {
      if (byId.has(preset.id)) continue
      byId.set(preset.id, preset)
    }
  }
  return [...byId.values()]
}
