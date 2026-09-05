/** Parse and validate one recorded-session snapshot manifest.
 * @remarks 文件说明：文件职责：实现 test-support/session-snapshot 中 manifest 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * test-support/session-snapshot 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import { isAbsolute } from 'node:path'
import * as yaml from 'js-yaml'

/** Public `dsh` profile used to control a recorded-session scenario. */
export type SnapshotProfile = 'headless' | 'sdk' | 'acp' | 'web'

/** How a canonical session may be regenerated. */
export type SnapshotRecording = 'live' | 'authored'

/** Request-header ownership metadata for one composition. */
export interface SnapshotHeaderManifest {
  /** Stable class name shared only by byte-identical request headers. */
  class: string
  /** Whether this scenario owns the class's tokenized header sequence. */
  pin?: true
  /** Scenario that owns the readable system-prompt sidecar. */
  systemPromptSource?: string
  /** Scenario that owns the readable tool-schema sidecar. */
  toolSchemasSource?: string
  /** Child fixture indexes that own distinct system-prompt sidecars. */
  childSystemPrompts?: number[]
  /** Child fixture indexes that own distinct tool-schema sidecars. */
  childToolSchemas?: number[]
  /** Legitimate changed-header count after the initial request header. */
  changes?: number
}

/** Replay facts that cannot be reconstructed from successful model chunks. */
export interface SnapshotReplayManifest {
  /** A scenario-local `replay.override.json` replaces or patches the recorded model script. */
  override: true
}

/** Host requirements for a scenario's process-level controller. */
export type SnapshotPlatform = 'posix' | 'pwsh'

/** Deployment permission preset selected before the scenario starts. */
export type SnapshotPermission = 'read-only' | 'workspace-write' | 'danger-full-access'

/** Scenario-local workspace preparation and expected-state metadata. */
export interface SnapshotWorkspaceManifest {
  /** Named setup needed for state Git cannot represent directly. */
  setup?: string
  /** Whether `workspace.expected/` owns the complete final world state. */
  final?: true
  /** Place the generated cwd under the user's home instead of a temporary root. */
  parent?: 'home'
}

/** Controller input that cannot enter a session because admission rejects it. */
export interface SnapshotInputAttachment {
  /** Content-addressed attachment id stored in the session message. */
  id: string
  /** MIME type supplied by the controlling interface. */
  mediaType: string
  /** Complete base64 payload needed to reconstruct the input block. */
  data: string
}

/** Controller input bytes or rejected text that the persisted session cannot retain. */
export interface SnapshotInputManifest {
  /** One-shot task absent from the canonical log only when no user event was accepted. */
  task?: string
  /** Binary inputs keyed by the content-addressed ids retained in session JSONL. */
  attachments?: SnapshotInputAttachment[]
}

/** Optional reference to another scenario's canonical session. */
export interface SnapshotSessionReference {
  /** Repository-relative POSIX path to the owning scenario's selected parent Session fixture. */
  source: string
}

/** Historical-format behavior one retained scenario permanently exercises. */
export type SnapshotSessionFormatCoverage =
  | 'multi-hop'
  | 'packed-row'
  | 'retry-failure'
  | 'shipped-profile'
  | 'adjacent-migration'

/** Explicit historical generation retained by an owning scenario. */
export interface SnapshotSessionFormatManifest {
  /** Selected fixture generation; absent manifest metadata tracks the current writer. */
  readonly version: number
  /** Migration behaviors that require this historical fixture. */
  readonly coverage: readonly SnapshotSessionFormatCoverage[]
}

/** Declarative ownership metadata stored beside a recorded session. */
export interface SnapshotManifest {
  /** Manifest format version. */
  version: 1
  /** Scenario directory name, repeated for reviewable move and copy diagnostics. */
  scenario?: string
  /** Shipped profile whose public interface controls the scenario. */
  profile: SnapshotProfile
  /** Composition id whose sole pin owns its profile patches. */
  composition?: string
  /** Whether the session is live-recordable or deliberately authored. */
  recording?: SnapshotRecording
  /** Request-header class and sidecar ownership. */
  header?: SnapshotHeaderManifest
  /** Exceptional replay metadata absent for ordinary successful recordings. */
  replay?: SnapshotReplayManifest
  /** Optional host requirement; portable scenarios omit it. */
  platform?: SnapshotPlatform
  /** Explicit process fallback permission preset. */
  permission?: SnapshotPermission
  /** Test-only string environment additions needed by the declared composition. */
  environment?: Record<string, string>
  /** Workspace setup and external final-state ownership. */
  workspace?: SnapshotWorkspaceManifest
  /** Exceptional controller input absent for ordinary log-driven scenarios. */
  input?: SnapshotInputManifest
  /** Absent when this directory owns its selected parent fixture; present for a read-only borrower. */
  session?: SnapshotSessionReference
  /** Historical generation retained by an owner instead of tracking the current writer. */
  sessionFormat?: SnapshotSessionFormatManifest
}

/** Snapshot execution modes that may read or replace committed fixture generations. */
export type SnapshotSessionWriteMode = 'replay' | 'record' | 'refresh'

/**
 * Whether one run writes current-writer Session fixtures for this scenario.
 * Explicit historical generations remain immutable replay inputs; record and
 * refresh may still update their non-Session expected outputs.
 *
 * @param manifest - Parsed scenario ownership and retained-generation metadata.
 * @param mode - Snapshot execution mode.
 * @returns True only when a write-capable mode tracks the current writer.
 */
export function writesCurrentSessionFixtures(
  manifest: SnapshotManifest,
  mode: SnapshotSessionWriteMode,
): boolean {
  return mode !== 'replay' && manifest.session === undefined && manifest.sessionFormat === undefined
}

/**
 * 常量说明：PROFILES 用于处理 PROFILES 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const PROFILES = new Set<SnapshotProfile>(['headless', 'sdk', 'acp', 'web'])
/**
 * 常量说明：RECORDINGS 用于处理 RECORDINGS 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const RECORDINGS = new Set<SnapshotRecording>(['live', 'authored'])
/**
 * 常量说明：PLATFORMS 用于处理 PLATFORMS 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const PLATFORMS = new Set<SnapshotPlatform>(['posix', 'pwsh'])
/**
 * 常量说明：PERMISSIONS 用于处理 PERMISSIONS 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const PERMISSIONS = new Set<SnapshotPermission>(['read-only', 'workspace-write', 'danger-full-access'])
const SESSION_FORMAT_COVERAGE = new Set<SnapshotSessionFormatCoverage>([
  'multi-hop',
  'packed-row',
  'retry-failure',
  'shipped-profile',
  'adjacent-migration',
])
const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * 功能说明：处理 record 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param label （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Record<string, unknown>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 record(value, label)，并按返回类型处理结果。
 */
function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a mapping`)
  }
  return value as Record<string, unknown>
}

/**
 * 功能说明：处理 exactKeys 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （Record<string, unknown>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param allowed （readonly string[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param label （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 exactKeys(value, allowed, label)，并按返回类型处理结果。
 */
function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  /**
   * 常量说明：unknown 用于处理 unknown 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：key（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(key)，并按返回类型处理结果。
   */
  const unknown = Object.keys(value).filter(key => !allowed.includes(key)).sort()
  if (unknown.length > 0) throw new Error(`${label} has unknown field(s): ${unknown.join(', ')}`)
}

/**
 * 功能说明：处理 name 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param label （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 name(value, label)，并按返回类型处理结果。
 */
function name(value: unknown, label: string): string {
  if (typeof value !== 'string' || !NAME_RE.test(value)) {
    throw new Error(`${label} must be a lower-kebab-case name`)
  }
  return value
}

/**
 * 功能说明：处理 scenarioSource 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param label （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 scenarioSource(value, label)，并按返回类型处理结果。
 */
function scenarioSource(value: unknown, label: string): string {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：segment（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(segment)，并按返回类型处理结果。
   */
  if (typeof value !== 'string' || !value.split('/').every(segment => NAME_RE.test(segment))) {
    throw new Error(`${label} must be a lower-kebab-case name or corpus-relative path`)
  }
  return value
}

/**
 * 功能说明：处理 positiveIndexes 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param label （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns number[]；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 positiveIndexes(value, label)，并按返回类型处理结果。
 */
function positiveIndexes(value: unknown, label: string): number[] {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item)，并按返回类型处理结果。
   */
  if (!Array.isArray(value)
    || value.some(item => !Number.isInteger(item) || Number(item) < 1)
    || new Set(value).size !== value.length) {
    throw new Error(`${label} must be an array of unique positive integers`)
  }
  return [...value as number[]]
}

/**
 * Parse one `snapshot.yml` without admitting JavaScript YAML tags or unknown fields.
 * @param source - complete manifest text.
 * @param path - diagnostic path.
 * @returns validated manifest metadata.
 * @remarks 中文说明：功能说明：解析 Snapshot Manifest 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：source（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：path（由 TypeScript
 * 根据调用位置推断的类型）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：SnapshotManifest；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * parseSnapshotManifest(source, path)，并按返回类型处理结果。
 */
export function parseSnapshotManifest(source: string, path = 'snapshot.yml'): SnapshotManifest {
  /**
   * 变量说明：parsed 用于处理 parsed 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let parsed: unknown
  /**
   * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
   */
  try {
    parsed = yaml.load(source, { schema: yaml.JSON_SCHEMA })
  } catch (error) {
    throw new Error(`session-snapshot: ${path}: invalid YAML: ${String(error)}`)
  }

  /**
   * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
   */
  try {
    /**
     * 常量说明：root 用于处理 root 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const root = record(parsed, 'manifest')
    exactKeys(root, [
      'version',
      'scenario',
      'profile',
      'composition',
      'recording',
      'header',
      'replay',
      'platform',
      'permission',
      'environment',
      'workspace',
      'input',
      'session',
      'sessionFormat',
    ], 'manifest')
    if (root.version !== 1) throw new Error('manifest.version must equal 1')
    /**
     * 常量说明：scenario 用于处理 scenario 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const scenario = root.scenario === undefined ? undefined : name(root.scenario, 'manifest.scenario')
    if (typeof root.profile !== 'string' || !PROFILES.has(root.profile as SnapshotProfile)) {
      throw new Error('manifest.profile must be headless, sdk, acp, or web')
    }

    /**
     * 常量说明：composition 用于处理 composition 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const composition = root.composition === undefined
      ? undefined
      : name(root.composition, 'manifest.composition')
    /**
     * 变量说明：recording 用于处理 recording 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let recording: SnapshotRecording | undefined
    if (root.recording !== undefined) {
      if (typeof root.recording !== 'string' || !RECORDINGS.has(root.recording as SnapshotRecording)) {
        throw new Error('manifest.recording must be live or authored')
      }
      recording = root.recording as SnapshotRecording
    }

    /**
     * 变量说明：header 用于处理 header 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let header: SnapshotHeaderManifest | undefined
    if (root.header !== undefined) {
      /**
       * 常量说明：value 用于处理 value 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const value = record(root.header, 'manifest.header')
      exactKeys(value, [
        'class',
        'pin',
        'systemPromptSource',
        'toolSchemasSource',
        'childSystemPrompts',
        'childToolSchemas',
        'changes',
      ], 'manifest.header')
      if (value.pin !== undefined && value.pin !== true) {
        throw new Error('manifest.header.pin must equal true when present')
      }
      if (value.changes !== undefined && (!Number.isInteger(value.changes) || Number(value.changes) < 0)) {
        throw new Error('manifest.header.changes must be a non-negative integer')
      }
      header = {
        class: name(value.class, 'manifest.header.class'),
        ...(value.pin === true ? { pin: true as const } : {}),
        ...(value.systemPromptSource === undefined
          ? {}
          : { systemPromptSource: scenarioSource(value.systemPromptSource, 'manifest.header.systemPromptSource') }),
        ...(value.toolSchemasSource === undefined
          ? {}
          : { toolSchemasSource: scenarioSource(value.toolSchemasSource, 'manifest.header.toolSchemasSource') }),
        ...(value.childSystemPrompts === undefined
          ? {}
          : { childSystemPrompts: positiveIndexes(value.childSystemPrompts, 'manifest.header.childSystemPrompts') }),
        ...(value.childToolSchemas === undefined
          ? {}
          : { childToolSchemas: positiveIndexes(value.childToolSchemas, 'manifest.header.childToolSchemas') }),
        ...(value.changes === undefined ? {} : { changes: Number(value.changes) }),
      }
    }

    /**
     * 变量说明：replay 用于处理 replay 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let replay: SnapshotReplayManifest | undefined
    if (root.replay !== undefined) {
      /**
       * 常量说明：value 用于处理 value 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const value = record(root.replay, 'manifest.replay')
      exactKeys(value, ['override'], 'manifest.replay')
      if (value.override !== true) throw new Error('manifest.replay.override must equal true')
      replay = { override: true }
    }

    /**
     * 变量说明：platform 用于处理 platform 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let platform: SnapshotPlatform | undefined
    if (root.platform !== undefined) {
      if (typeof root.platform !== 'string' || !PLATFORMS.has(root.platform as SnapshotPlatform)) {
        throw new Error('manifest.platform must be posix or pwsh')
      }
      platform = root.platform as SnapshotPlatform
    }

    /**
     * 变量说明：permission 用于处理 permission 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let permission: SnapshotPermission | undefined
    if (root.permission !== undefined) {
      if (typeof root.permission !== 'string' || !PERMISSIONS.has(root.permission as SnapshotPermission)) {
        throw new Error('manifest.permission must be read-only, workspace-write, or danger-full-access')
      }
      permission = root.permission as SnapshotPermission
    }

    /**
     * 变量说明：environment 用于处理 environment 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let environment: Record<string, string> | undefined
    if (root.environment !== undefined) {
      /**
       * 常量说明：value 用于处理 value 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const value = record(root.environment, 'manifest.environment')
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：[key, item]（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调([key, item])，并按返回类型处理结果。
       */
      if (Object.entries(value).some(([key, item]) => !/^[A-Z][A-Z0-9_]*$/.test(key) || typeof item !== 'string')) {
        throw new Error('manifest.environment must map uppercase environment names to strings')
      }
      environment = value as Record<string, string>
    }

    /**
     * 变量说明：workspace 用于处理 workspace 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let workspace: SnapshotWorkspaceManifest | undefined
    if (root.workspace !== undefined) {
      /**
       * 常量说明：value 用于处理 value 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const value = record(root.workspace, 'manifest.workspace')
      exactKeys(value, ['setup', 'final', 'parent'], 'manifest.workspace')
      if (value.final !== undefined && value.final !== true) {
        throw new Error('manifest.workspace.final must equal true when present')
      }
      if (value.parent !== undefined && value.parent !== 'home') {
        throw new Error('manifest.workspace.parent must equal home')
      }
      workspace = {
        ...(value.setup === undefined ? {} : { setup: name(value.setup, 'manifest.workspace.setup') }),
        ...(value.final === true ? { final: true as const } : {}),
        ...(value.parent === 'home' ? { parent: 'home' as const } : {}),
      }
      if (Object.keys(workspace).length === 0) throw new Error('manifest.workspace must not be empty')
    }

    /**
     * 变量说明：input 用于处理 input 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let input: SnapshotInputManifest | undefined
    if (root.input !== undefined) {
      /**
       * 常量说明：value 用于处理 value 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const value = record(root.input, 'manifest.input')
      exactKeys(value, ['task', 'attachments'], 'manifest.input')
      if (value.task !== undefined && (typeof value.task !== 'string' || value.task.trim() === '')) {
        throw new Error('manifest.input.task must be a non-empty string when present')
      }
      /**
       * 变量说明：attachments 用于处理 attachments 相关数据，作用于当前作用域；其值可能随流程推进而变化，
       * 读写时需遵守声明类型和所在生命周期。
       */
      let attachments: SnapshotInputAttachment[] | undefined
      if (value.attachments !== undefined) {
        if (!Array.isArray(value.attachments) || value.attachments.length === 0) {
          throw new Error('manifest.input.attachments must be a non-empty array')
        }
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
         * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：index（由 TypeScript
         * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item, index)，并按返回类型处理结果。
         */
        attachments = value.attachments.map((item, index) => {
          /**
           * 常量说明：attachment 用于处理 attachment 相关数据，作用于当前作用域；初始化后不可重新赋值，
           * 但对象内部是否可变仍由其类型决定。
           */
          const attachment = record(item, `manifest.input.attachments[${index}]`)
          exactKeys(attachment, ['id', 'mediaType', 'data'], `manifest.input.attachments[${index}]`)
          if (typeof attachment.id !== 'string' || !attachment.id.startsWith('sha256:')) {
            throw new Error(`manifest.input.attachments[${index}].id must start with sha256:`)
          }
          if (typeof attachment.mediaType !== 'string' || !attachment.mediaType.includes('/')) {
            throw new Error(`manifest.input.attachments[${index}].mediaType must be a MIME type`)
          }
          if (typeof attachment.data !== 'string' || attachment.data.length === 0) {
            throw new Error(`manifest.input.attachments[${index}].data must be non-empty base64`)
          }
          return { id: attachment.id, mediaType: attachment.mediaType, data: attachment.data }
        })
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：attachment（由 TypeScript
         * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(attachment)，并按返回类型处理结果。
         */
        if (new Set(attachments.map(attachment => attachment.id)).size !== attachments.length) {
          throw new Error('manifest.input.attachments must have unique ids')
        }
      }
      if (value.task === undefined && attachments === undefined) {
        throw new Error('manifest.input must declare task or attachments')
      }
      input = {
        ...(value.task === undefined ? {} : { task: value.task }),
        ...(attachments === undefined ? {} : { attachments }),
      }
    }

    /**
     * 变量说明：session 用于处理 session 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let session: SnapshotSessionReference | undefined
    if (root.session !== undefined) {
      /**
       * 常量说明：value 用于处理 value 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const value = record(root.session, 'manifest.session')
      exactKeys(value, ['source'], 'manifest.session')
      if (typeof value.source !== 'string' || value.source.trim() === '') {
        throw new Error('manifest.session.source must be a non-empty string')
      }
      if (isAbsolute(value.source) || value.source.includes('\\') || value.source.includes('\0')) {
        throw new Error('manifest.session.source must be a relative POSIX path')
      }
      session = { source: value.source }
    }

    let sessionFormat: SnapshotSessionFormatManifest | undefined
    if (root.sessionFormat !== undefined) {
      const value = record(root.sessionFormat, 'manifest.sessionFormat')
      exactKeys(value, ['version', 'coverage'], 'manifest.sessionFormat')
      if (!Number.isSafeInteger(value.version) || Number(value.version) < 0 || Object.is(value.version, -0)) {
        throw new Error('manifest.sessionFormat.version must be a non-negative safe integer')
      }
      if (!Array.isArray(value.coverage) || value.coverage.length === 0
        || value.coverage.some(item => typeof item !== 'string'
          || !SESSION_FORMAT_COVERAGE.has(item as SnapshotSessionFormatCoverage))
        || new Set(value.coverage).size !== value.coverage.length) {
        throw new Error(
          'manifest.sessionFormat.coverage must be a non-empty array of unique supported coverage names',
        )
      }
      if (session !== undefined) {
        throw new Error('manifest.sessionFormat is only valid when the scenario owns its Session fixtures')
      }
      sessionFormat = {
        version: Number(value.version),
        coverage: [...value.coverage as SnapshotSessionFormatCoverage[]],
      }
    }

    return {
      version: 1,
      ...(scenario === undefined ? {} : { scenario }),
      profile: root.profile as SnapshotProfile,
      ...(composition === undefined ? {} : { composition }),
      ...(recording === undefined ? {} : { recording }),
      ...(header === undefined ? {} : { header }),
      ...(replay === undefined ? {} : { replay }),
      ...(platform === undefined ? {} : { platform }),
      ...(permission === undefined ? {} : { permission }),
      ...(environment === undefined ? {} : { environment }),
      ...(workspace === undefined ? {} : { workspace }),
      ...(input === undefined ? {} : { input }),
      ...(session === undefined ? {} : { session }),
      ...(sessionFormat === undefined ? {} : { sessionFormat }),
    }
  } catch (error) {
    /* v8 ignore next -- every parser and validator above throws Error instances. */
    throw new Error(`session-snapshot: ${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
}
