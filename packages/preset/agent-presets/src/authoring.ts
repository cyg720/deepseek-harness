/**
 * Copying, reading, and deleting locally authored presets.
 *
 * Authoring is confined to a `user` root: the shipped `.system` set is part of
 * the deployment, and letting a browser rewrite it would turn "reset to a known
 * preset" into something the same caller could have broken first.
 *
 * The only authoring write is a whole-directory copy of an existing preset.
 * No caller supplies composition text: the inputs are ids the host resolves
 * against its own roots plus an optional display name, so authoring grants no
 * capability the copied preset did not already carry.
 * @module @deepseek-ai/dsh-agent-presets/authoring
 */
/*
 * 文件职责：实现 authoring.ts 承担的Agent 预设配置、装载与运行时协作职责。
 * 技术维度：使用 TypeScript、Cordis 插件、事件日志、配置解析和异步生命周期管理。
 * 产品维度：让 Agent 能按用户配置启用Agent 预设并保持会话行为一致。
 * 逻辑维度：解析输入配置，注册插件能力，处理事件，并在卸载时清理资源。
 * 关键边界：配置错误应尽早失败；模型可见状态必须写入日志；注册必须可撤销。
 * 新手阅读建议：先看导出类型和配置，再读插件入口与事件处理，最后关注校验和清理。
 */

import { chmod, cp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { expandHomePath } from '@deepseek-ai/dsh-home-paths'
import { METADATA_FILE, renderPresetMetadata } from './metadata.ts'
import { PRESET_ID, type AgentPreset, type PresetRoot } from './preset.ts'

/** A preset id that cannot be used as a directory name under a root. */
/* 中文说明：class InvalidPresetIdError 定义本模块所需的数据或行为，用于表达当前功能场景。 */
export class InvalidPresetIdError extends Error {
  constructor(
    /** The rejected id. */
    readonly presetId: string,
  ) {
    super(
      `agent-presets: preset id ${JSON.stringify(presetId)} must match ${String(PRESET_ID)} — `
      + 'the id is a directory name, so anything else could escape the preset root',
    )
  }
}

/** A copy target that is already occupied — a copy never overwrites. */
/* 中文说明：class PresetExistsError 定义本模块所需的数据或行为，用于表达当前功能场景。 */
export class PresetExistsError extends Error {
  constructor(
    /** The id that is already taken. */
    readonly presetId: string,
  ) {
    super(
      `agent-presets: preset "${presetId}" already exists — `
      + 'a copy never overwrites; delete the existing preset first or choose another id',
    )
  }
}

/** Authoring was attempted where the deployment allows none. */
/* 中文说明：class PresetNotWritableError 定义本模块所需的数据或行为，用于表达当前功能场景。 */
export class PresetNotWritableError extends Error {
  constructor(
    /** What the caller tried to change, for the diagnostic. */
    readonly presetId: string,
    reason: string,
  ) {
    super(`agent-presets: preset "${presetId}" cannot be written: ${reason}`)
  }
}

/**
 * The root locally authored presets are written to.
 * @param roots - the configured roots in precedence order.
 * @returns the absolute path of the first `user` root.
 * @throws when the deployment configured no writable root.
 */
/*
 * 中文说明：函数 writableRoot 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param roots 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function writableRoot(roots: readonly PresetRoot[]): string {
  /** 中文说明：函数值 root 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const root = roots.find(candidate => candidate.trust === 'user')
  if (root === undefined) {
    throw new PresetNotWritableError('', 'this deployment configures no user-writable preset root')
  }
  return resolve(expandHomePath(root.path))
}

/**
 * Read one preset's composition text.
 * @param preset - the resolved preset.
 * @returns the file's contents.
 */
/*
 * 中文说明：函数 readComposition 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param preset 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export async function readComposition(preset: AgentPreset): Promise<string> {
  return await readFile(preset.path, 'utf8')
}

/** Whether anything occupies the path (cp's own errorOnExist backstops races). */
/* 中文说明：函数 occupied 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
async function occupied(path: string): Promise<boolean> {
  /** 中文说明：变量 present 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let present = true
  try {
    await stat(path)
  } catch {
    // Every stat failure means the same thing here: nothing usable occupies
    // the path, so the copy may claim it.
    present = false
  }
  return present
}

/**
 * Re-tighten a copied tree to owner-only. A shipped preset is world-readable
 * in its install and `cp` preserves that; the copy carries the same weight as
 * the settings document beside it, so group/other access is stripped. A
 * file's owner-execute bit survives — a preset may ship runnable helpers.
 */
/* 中文说明：函数 tightenModes 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
async function tightenModes(dir: string): Promise<void> {
  await chmod(dir, 0o700)
  /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    /** 中文说明：变量 target 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const target = join(dir, entry.name)
    if (entry.isDirectory()) {
      await tightenModes(target)
    } else {
      /* v8 ignore next -- Windows exposes no POSIX owner-execute bit; the POSIX lane covers both file modes. */
      await chmod(target, ((await stat(target)).mode & 0o100) === 0 ? 0o600 : 0o700)
    }
  }
}

/**
 * Create a preset by copying an existing one's whole directory.
 *
 * The copy carries everything the source directory holds — composition,
 * metadata, skill directories, assets — because a preset is its directory,
 * not one file. Symlinks are dereferenced so the copy is self-contained
 * rather than a set of links back into the install it was copied from.
 *
 * The copied metadata is then rewritten: the source's description is kept
 * (the file is the author's to edit afterwards), but its name and roster
 * `order` are not — a copy presenting itself identically to its source, or
 * sorted into the shipped set's declared order, would make the roster stop
 * distinguishing them. With no name given and no description to keep, the
 * file is removed so the copy publishes nothing rather than a blank.
 * @param roots - the configured roots; the first `user` one receives the copy.
 * @param source - the resolved preset the copy starts from.
 * @param id - the new preset's id, which becomes its directory name.
 * @param name - display name for the copy; omitted falls back to the id.
 * @returns the absolute path of the new preset directory.
 * @throws when the id is unusable or already occupied on disk, or the
 * deployment configures no writable root.
 */
/*
 * 中文说明：函数 copyComposition 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param roots 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param source 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param id 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param name 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export async function copyComposition(
  roots: readonly PresetRoot[],
  source: AgentPreset,
  id: string,
  name?: string,
): Promise<string> {
  if (!PRESET_ID.test(id)) throw new InvalidPresetIdError(id)
  /** 中文说明：变量 dir 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const dir = join(writableRoot(roots), id)
  // The roster check upstream only sees discovered presets; a directory with
  // no composition file still occupies the name and deserves a readable
  // refusal rather than a filesystem error code.
  if (await occupied(dir)) throw new PresetExistsError(id)
  try {
    await cp(dirname(source.path), dir, {
      recursive: true, dereference: true, force: false, errorOnExist: true,
    })
    await tightenModes(dir)
    /** 中文说明：变量 rendered 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const rendered = renderPresetMetadata({
      ...name === undefined ? {} : { name },
      ...source.description === undefined ? {} : { description: source.description },
    })
    /** 中文说明：变量 metadataPath 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const metadataPath = join(dir, METADATA_FILE)
    if (rendered === undefined) {
      await rm(metadataPath, { force: true })
    } else {
      await writeFileAtomic(metadataPath, rendered, { mode: 0o600, dirMode: 0o700 })
    }
  } catch (error) {
    // A half-copied directory would be invisible to discovery at best and a
    // mountable-but-incomplete preset at worst; a failed copy leaves nothing.
    await rm(dir, { recursive: true, force: true })
    throw error
  }
  return dir
}

/**
 * Delete a locally authored preset.
 *
 * A shipped preset is refused: it belongs to the deployment. A preset a live
 * session mounted is NOT refused — the composition was read at creation and is
 * never re-read, so that session keeps running exactly as it was.
 * @param roots - the configured roots.
 * @param preset - the resolved preset to remove.
 * @throws when the preset ships with the deployment or lies outside the writable root.
 */
/*
 * 中文说明：函数 deleteComposition 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param roots 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param preset 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 */
export async function deleteComposition(
  roots: readonly PresetRoot[],
  preset: AgentPreset,
): Promise<void> {
  if (preset.trust !== 'user') {
    throw new PresetNotWritableError(preset.id, 'it ships with the deployment')
  }
  /** 中文说明：变量 dir 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const dir = join(writableRoot(roots), preset.id)
  // Belt and braces over the id pattern: the resolved directory must still be
  // the one the writable root owns, whatever discovery reported.
  if (!isAbsolute(preset.path) || !preset.path.startsWith(dir)) {
    throw new PresetNotWritableError(preset.id, 'it does not live under the writable preset root')
  }
  await rm(dir, { recursive: true, force: true })
}
