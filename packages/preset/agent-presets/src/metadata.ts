/**
 * A preset's display metadata: the name and description a picker shows.
 *
 * It lives in its own file because the composition is a top-level list of
 * plugin rows — YAML cannot carry sibling keys beside it, and faking a
 * metadata row would hand the Loader something to load. Keeping it separate
 * also keeps the composition exactly what its name says: a Cordis file the
 * loader owns and the cordis preset can author.
 *
 * The file carries display text ONLY. `id` is the directory name and `trust`
 * comes from the root a preset was discovered under, so neither is writable
 * here — otherwise a locally authored preset could claim to be a shipped one.
 *
 * Every read failure degrades to no metadata. A preset whose display text is
 * missing, malformed, or unreadable still mounts: presentation is not a
 * capability, and a broken name must never become an agent that cannot start.
 * @module @deepseek-ai/dsh-agent-presets/metadata
 */
/**
 * 文件职责：实现 metadata.ts 承担的 Agent 预设元数据、校验与装载职责。
 * 技术维度：使用 TypeScript、Cordis 插件、配置解析和运行时不变量检查。
 * 产品维度：让用户能通过预设组合 Agent 能力，并在启动时获得明确配置反馈。
 * 逻辑维度：读取预设定义，校验元数据，解析引用并挂载对应插件。
 * 关键边界：缺失或冲突配置应尽早失败；注册必须可撤销；用户路径不得被隐式改写。
 * 新手阅读建议：先看导出类型和元数据，再读校验与挂载，最后关注失败分支。
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import yaml from 'js-yaml'

/** The optional display-metadata file beside a preset's composition. */
/** 中文说明：常量 METADATA_FILE 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
export const METADATA_FILE = 'preset.yml'

/** Display text a preset may publish about itself. */
/** 中文说明：interface PresetMetadata 定义本模块所需的数据或行为，用于表达预设场景。 */
export interface PresetMetadata {
  /** Human-facing name; falls back to the preset id when absent. */
  readonly name?: string
  /** One sentence on what this preset is for. */
  readonly description?: string
  /**
   * Position within its group; lower comes first. A preset that declares
   * none sorts after every preset that does, then by id — so the shipped set
   * can read in capability order while authored ones stay alphabetical.
   */
  readonly order?: number
}

/** A non-empty trimmed string, or undefined for anything else. */
/** 中文说明：函数 text 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  /** 中文说明：变量 trimmed 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * Read one preset directory's display metadata.
 *
 * Absent, unparsable, and wrongly-shaped files are all the same answer —
 * empty metadata — because the caller renders a picker, not a diagnostic.
 * @param directory - the preset directory.
 * @returns the display text the preset published, possibly empty.
 */
/** 中文说明：函数 readPresetMetadata 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export async function readPresetMetadata(directory: string): Promise<PresetMetadata> {
  /** 中文说明：变量 raw 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let raw: string
  try {
    raw = await readFile(join(directory, METADATA_FILE), 'utf8')
  } catch {
    // Absent is the common case: metadata is optional and most presets,
    // including every one authored by duplicating another, carry none.
    return {}
  }
  /** 中文说明：变量 parsed 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let parsed: unknown
  try {
    parsed = yaml.load(raw)
  } catch {
    // Malformed display text is not worth failing discovery over; the picker
    // falls back to the id, and the composition still mounts.
    return {}
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
  /** 中文说明：变量 record 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const record = parsed as Record<string, unknown>
  /** 中文说明：变量 name 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const name = text(record.name)
  /** 中文说明：变量 description 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const description = text(record.description)
  /** 中文说明：变量 order 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const order = typeof record.order === 'number' && Number.isFinite(record.order)
    ? record.order
    : undefined
  return {
    ...name === undefined ? {} : { name },
    ...description === undefined ? {} : { description },
    ...order === undefined ? {} : { order },
  }
}

/**
 * Render display metadata as the file's contents.
 *
 * Absent fields are omitted rather than written empty, so a preset with no
 * description does not ship a key that reads as an intentional blank.
 * @param metadata - the display text to store.
 * @returns the YAML document, or undefined when there is nothing to store.
 */
/** 中文说明：函数 renderPresetMetadata 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export function renderPresetMetadata(metadata: PresetMetadata): string | undefined {
  /** 中文说明：变量 name 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const name = text(metadata.name)
  /** 中文说明：变量 description 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const description = text(metadata.description)
  const { order } = metadata
  if (name === undefined && description === undefined && order === undefined) return undefined
  return yaml.dump({
    ...name === undefined ? {} : { name },
    ...description === undefined ? {} : { description },
    ...order === undefined ? {} : { order },
  }, { lineWidth: -1 })
}
