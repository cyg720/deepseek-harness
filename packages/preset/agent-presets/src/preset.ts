/** Agent-preset vocabulary shared by discovery, mounting, and consumers. */
/**
 * 文件职责：实现 preset.ts 承担的 Agent 预设元数据、校验与装载职责。
 * 技术维度：使用 TypeScript、Cordis 插件、配置解析和运行时不变量检查。
 * 产品维度：让用户能通过预设组合 Agent 能力，并在启动时获得明确配置反馈。
 * 逻辑维度：读取预设定义，校验元数据，解析引用并挂载对应插件。
 * 关键边界：缺失或冲突配置应尽早失败；注册必须可撤销；用户路径不得被隐式改写。
 * 新手阅读建议：先看导出类型和元数据，再读校验与挂载，最后关注失败分支。
 */

/**
 * Where a preset's composition came from. A `system` preset ships with the
 * deployment; a `user` preset was authored locally, by a person or by an
 * agent, and therefore carries the same trust as shell access.
 */
/** 中文说明：type PresetTrust 定义本模块所需的数据或行为，用于表达预设场景。 */
export type PresetTrust = 'system' | 'user'

/**
 * Ids a preset directory may use.
 *
 * The id becomes a path segment, so this is a containment boundary rather than
 * a style rule: `..`, a separator, or an absolute-looking name would place the
 * composition outside the root the deployment authorised. Discovery shares it:
 * a directory whose name no copy could ever claim is not a preset slot.
 */
/** 中文说明：常量 PRESET_ID 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
export const PRESET_ID = /^[a-z0-9][a-z0-9-]*$/

/** One preset directory that carries a mountable agent composition. */
/** 中文说明：interface AgentPreset 定义本模块所需的数据或行为，用于表达预设场景。 */
export interface AgentPreset {
  /** Stable identifier; the preset directory's name. */
  readonly id: string
  /** Trust recorded from the root this preset was discovered under. */
  readonly trust: PresetTrust
  /** Absolute path of the preset's agent composition file. */
  readonly path: string
  /** Display name from the preset's own metadata; absent falls back to {@link id}. */
  readonly name?: string
  /** One sentence on what this preset is for, when it published one. */
  readonly description?: string
  /** Declared position within its group; absent sorts after those that declare one. */
  readonly order?: number
  /**
   * Why this preset cannot compose a session, absent when it can. A broken
   * preset stays on the roster — hiding it would leave its directory blocking
   * the id with nothing to see or delete — but every mounting path refuses it
   * up front with this reason instead of failing deep inside the loader.
   */
  readonly broken?: string
}

/** One directory scanned for preset subdirectories. */
/** 中文说明：interface PresetRoot 定义本模块所需的数据或行为，用于表达预设场景。 */
export interface PresetRoot {
  /** Directory holding one subdirectory per preset; a leading `~` expands. */
  path: string
  /** Trust recorded on every preset discovered under this root. */
  trust: PresetTrust
}

/** Plugin config: which preset is the default, and where presets live. */
/** 中文说明：interface Config 定义本模块所需的数据或行为，用于表达预设场景。 */
export interface Config {
  /** Preset id mounted when a caller names none. Missing at mount time fails loud. */
  default: string
  /** Scanned roots in precedence order; an earlier root wins a duplicate id. */
  roots: PresetRoot[]
  /**
   * Append the harness home's `USER_PRESET_DIR` as a `user` root, after every
   * configured root. False mounts a roster over `roots` alone.
   */
  includeUserRoot: boolean
}

/**
 * No configured root supplies the requested preset.
 *
 * Separate from a mount failure because the two mean different things to a
 * caller: an unknown id is a bad request, while an unusable composition is a
 * broken preset the deployment must fix.
 */
/** 中文说明：class UnknownPresetError 定义本模块所需的数据或行为，用于表达预设场景。 */
export class UnknownPresetError extends Error {
  constructor(
    /** The id that was requested. */
    readonly presetId: string,
    /** Ids the roster does supply, for the caller to offer instead. */
    readonly available: readonly string[],
  ) {
    super(`agent-presets: preset "${presetId}" not found (available: ${available.join(', ') || 'none'})`)
  }
}

/** A preset exists but its composition cannot be installed. */
/** 中文说明：class PresetMountError 定义本模块所需的数据或行为，用于表达预设场景。 */
export class PresetMountError extends Error {
  constructor(
    /** The preset whose composition failed. */
    readonly presetId: string,
    /** Why it failed, without this package's own message prefix. */
    readonly reason: string,
    options?: ErrorOptions,
  ) {
    super(`agent-presets: preset "${presetId}" failed to mount: ${reason}`, options)
  }
}
