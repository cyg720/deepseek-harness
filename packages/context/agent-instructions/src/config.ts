/**
 * ================================ 文件注释 ================================
 * 【文件职责】工作区指令发现与渲染的配置规范化：把用户可见配置解析成
 *             带默认值、经校验的运行时配置，并生成"基线身份"用于
 *             恢复会话时的兼容性检查。
 * 【技术维度】schemastary 校验 + 默认值合并；node:path 相对路径计算；
 *             dsh-home-paths 解析 Harness 主目录（用户级全局 AGENTS.md 所在）。
 * 【产品维度】决定"从哪里找指令文件"：项目根向上匹配标记、同目录候选文件
 *             （AGENTS.md/CLAUDE.md 及 .local 覆盖层）、单文件大小上限、
 *             渲染总量上限。
 * 【逻辑维度】1) 默认常量与 Config 接口；2) ResolvedConfig 解析后形态；3)
 *             workspaceBaselineIdentity：基线身份序列化；4) resolveConfig /
 *             resolveDiscoveryConfig：默认值与候选过滤（拒绝路径分隔符）。
 * 【关键边界】maxBytes 是必填项且非正数/非有限值时禁用加载；候选文件必须是
 *             纯文件名（不能是路径，也不能是 '.'/'..'）；基线身份决定
 *             恢复会话时指令缓存是否仍可用。
 * 【新手阅读建议】先看 Config 各字段的语义，再看两个 resolve 函数的默认值
 *                 合并，最后看 workspaceBaselineIdentity 的构成。
 * ==========================================================================
 */

/**
 * Configuration normalization for workspace instruction discovery and rendering.
 *
 * @module @deepseek-ai/dsh-agent-instructions/config
 */

import { relative } from 'node:path'
import z from '@deepseek-ai/schemastery'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

/** 默认项目根标记：向上走到含 .git 的目录即视为项目根。 */
const DEFAULT_PROJECT_ROOT_MARKERS = ['.git'] as const
/** 默认同目录指令候选：AGENTS.md 优先，CLAUDE.md 次之。 */
const DEFAULT_INSTRUCTION_FILE_CANDIDATES = ['AGENTS.md', 'CLAUDE.md'] as const
/** 默认本地覆盖层候选：在基础文件之后加载。 */
const DEFAULT_LOCAL_INSTRUCTION_FILE_CANDIDATES = ['AGENTS.local.md', 'CLAUDE.local.md'] as const
/** 单文件最大读取字节数：1 MiB，更大的指令文件被忽略。 */
const DEFAULT_MAX_SOURCE_BYTES = 1_048_576
/** 候选文件中被保留的路径段集合：''、'.'、'..' 均不是合法的纯文件名。 */
const RESERVED_PATH_SEGMENTS = new Set(['', '.', '..'])

/** User-facing workspace instruction loader configuration. */
/** 面向用户的工作区指令加载器配置（可通过 cordis.yml 覆盖）。 */
export interface Config {
  /** Harness home containing the fixed user-global `AGENTS.md`; defaults to `$DSH_HOME` or `~/.dsh`. */
  /** 含固定用户全局 AGENTS.md 的 Harness 主目录；缺省用 $DSH_HOME 或 ~/.dsh。 */
  dshHome?: string
  /** Directory entries that identify the project root while walking upward from the session cwd. */
  /** 从会话 cwd 向上走时用于识别项目根的目录条目（如 .git）。 */
  projectRootMarkers?: string[]
  /** UTF-8 byte cap for one rendered baseline or dynamic batch; non-positive or non-finite disables loading. */
  /** 单次渲染基线或动态批次的总 UTF-8 字节上限；非正数或非有限值禁用加载。 */
  maxBytes: number
  /** Maximum UTF-8 bytes read from one instruction file; larger files are ignored. */
  /** 单个指令文件最多读取的 UTF-8 字节数；更大的文件被忽略。 */
  maxSourceBytes?: number
  /**
   * Ordered same-directory project candidates; every existing file loads, with
   * per-directory trimmed-content duplicates collapsed to the earliest candidate.
   */
  /**
   * 同目录项目候选（按顺序）：存在的每个文件都会加载，每目录内按裁剪后
   * 内容去重，重复折叠到最靠前的候选。
   */
  instructionFileCandidates?: string[]
  /**
   * Ordered same-directory local-overlay candidates loaded after the base files
   * under the same per-directory trimmed-content dedup; empty disables the overlay.
   */
  /**
   * 同目录本地覆盖层候选（按顺序）：在基础文件之后加载，同样按每目录裁剪后
   * 内容去重；空数组禁用覆盖层。
   */
  localInstructionFileCandidates?: string[]
}

/** Config 的 schemastery 校验模式：解析配置并填充默认值。 */
export const Config: z<Config> = z.object({
  dshHome: z.string(),
  projectRootMarkers: z.array(z.string()).default([...DEFAULT_PROJECT_ROOT_MARKERS]),
  maxBytes: z.number().required(),
  maxSourceBytes: z.number().step(1).min(1).default(DEFAULT_MAX_SOURCE_BYTES),
  instructionFileCandidates: z.array(z.string()).default([...DEFAULT_INSTRUCTION_FILE_CANDIDATES]),
  localInstructionFileCandidates: z.array(z.string()).default([...DEFAULT_LOCAL_INSTRUCTION_FILE_CANDIDATES]),
})

/** Normalized instruction discovery configuration. */
/** 规范化的指令发现配置（渲染前的子集）。 */
export interface ResolvedDiscoveryConfig {
  dshHome: string
  projectRootMarkers: string[]
  instructionFileCandidates: string[]
  localInstructionFileCandidates: string[]
}

/** Normalized configuration used by discovery and reconciliation. */
/** 发现与对账共用的规范化配置（完整形态）。 */
export interface ResolvedConfig extends ResolvedDiscoveryConfig {
  maxBytes: number
  maxSourceBytes: number
}

/**
 * Identify the discovery, precedence, and budget semantics of one baseline.
 * @param config - normalized plugin configuration.
 * @param cwd - absolute session working directory.
 * @param projectRoot - project root selected for the current baseline.
 * @returns stable serialized identity for compatibility checks on resume.
 */
/**
 * 生成一个基线的稳定序列化身份：内容覆盖发现、优先级与预算的全部语义。
 * 恢复会话时用它与持久化的基线身份比对，判断指令缓存是否仍兼容可用。
 * @param config 规范化后的插件配置
 * @param cwd 绝对会话工作目录（项目根以其相对形式记录）
 * @param projectRoot 当前基线选定的项目根
 * @returns 供恢复兼容性检查的稳定序列化身份
 */
export function workspaceBaselineIdentity(
  config: ResolvedConfig,
  cwd: string,
  projectRoot: string,
): string {
  return JSON.stringify({
    projectRoot: relative(cwd, projectRoot),
    projectRootMarkers: config.projectRootMarkers,
    maxBytes: config.maxBytes,
    maxSourceBytes: config.maxSourceBytes,
    instructionFileCandidates: config.instructionFileCandidates,
    localInstructionFileCandidates: config.localInstructionFileCandidates,
  })
}

/**
 * Resolve defaults, the harness home, and valid same-directory candidates.
 * @param config - user-facing plugin configuration.
 * @returns normalized runtime configuration.
 */
/**
 * 解析默认值、Harness 主目录与合法的同目录候选，得到规范化运行时配置。
 * @param config 面向用户的插件配置
 * @returns 规范化后的运行时配置
 */
export function resolveConfig(config: Config): ResolvedConfig {
  return {
    ...resolveDiscoveryConfig(config),
    maxBytes: config.maxBytes,
    maxSourceBytes: config.maxSourceBytes ?? DEFAULT_MAX_SOURCE_BYTES,
  }
}

/**
 * Resolve the subset of configuration used before instruction content is rendered.
 * @param config - optional discovery controls.
 * @returns normalized home, root markers, and instruction candidates.
 */
/**
 * 解析在渲染指令内容之前就需要的那部分配置。
 * @param config 可选发现控制项（dshHome/根标记/候选文件）
 * @returns 规范化后的主目录、根标记与指令候选
 */
export function resolveDiscoveryConfig(
  config: Pick<Config, 'dshHome' | 'projectRootMarkers' | 'instructionFileCandidates' | 'localInstructionFileCandidates'>,
): ResolvedDiscoveryConfig {
  return {
    dshHome: resolveDshHome(config.dshHome),
    projectRootMarkers: config.projectRootMarkers ?? [...DEFAULT_PROJECT_ROOT_MARKERS],
    instructionFileCandidates: resolveInstructionFileCandidates(
      config.instructionFileCandidates,
      DEFAULT_INSTRUCTION_FILE_CANDIDATES,
    ),
    localInstructionFileCandidates: resolveInstructionFileCandidates(
      config.localInstructionFileCandidates,
      DEFAULT_LOCAL_INSTRUCTION_FILE_CANDIDATES,
    ),
  }
}

/**
 * 过滤指令候选：必须是纯文件名（不含路径分隔符、不是 ''/'.'/'..'），
 * 其余非法候选直接丢弃。
 * @param candidates 用户提供的候选（可缺省）
 * @param fallback 缺省时的默认候选
 * @returns 过滤后的合法候选列表
 */
function resolveInstructionFileCandidates(candidates: string[] | undefined, fallback: readonly string[]): string[] {
  return (candidates ?? [...fallback]).filter(candidate => (
    !RESERVED_PATH_SEGMENTS.has(candidate) && !/[\\/]/.test(candidate)
  ))
}
