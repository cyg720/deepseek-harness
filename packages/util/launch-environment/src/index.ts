/**
 * Immutable launch-time environment snapshot that records which layer
 * supplied each value. Harness consumers resolve through it instead of a flattened
 * `process.env`; launchers may still materialize accepted values for config
 * expressions and third-party libraries.
 * @module @deepseek-ai/dsh-launch-environment
 */
/**
 * 文件职责：实现 index.ts 覆盖的通用运行时工具行为与边界场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、HTTP、类型投影或异步资源控制。
 * 产品维度：保障 Agent 的通用运行时工具能力稳定、可复现且可诊断。
 * 逻辑维度：准备或解析输入，执行核心流程，再转换并核对结果、错误与清理。
 * 关键边界：网络和生成数据不可信；超时与取消必须传播；临时资源必须可靠释放。
 * 新手阅读建议：先看公开类型和夹具，再读主流程，最后关注校验、超时与失败路径。
 */

import type { Context } from '@deepseek-ai/cordis'

/**
 * Which layer supplied a value, from most to least trusted: the environment
 * this process inherited, the invoking directory's `.env`, the Harness home's
 * `.env`.
 */
/** 中文说明：type LaunchEnvironmentSource 定义本模块所需的数据或行为，用于表达通用运行时工具场景。 */
export type LaunchEnvironmentSource = 'process' | 'project-env' | 'user-env'

/** Layer order, most trusted first. */
/** 中文说明：常量 SOURCE_ORDER 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const SOURCE_ORDER: readonly LaunchEnvironmentSource[] = ['process', 'project-env', 'user-env']

/** One resolved variable and the layer it came from. */
/** 中文说明：interface LaunchEnvironmentEntry 定义本模块所需的数据或行为，用于表达通用运行时工具场景。 */
export interface LaunchEnvironmentEntry {
  /** The value as the layer supplied it; may be empty, which each owner judges for itself. */
  value: string
  /** The layer that supplied it. */
  source: LaunchEnvironmentSource
  /** Absolute path of the file that supplied it; absent for `process`. */
  path?: string
}

/**
 * The frozen environment of one launch. Construct through
 * {@link createLaunchEnvironmentSnapshot}; nothing mutates it afterwards, so a
 * later `chdir`, workspace switch, or resumed session observes the same
 * values a consumer resolved at boot.
 */
/** 中文说明：interface LaunchEnvironmentSnapshot 定义本模块所需的数据或行为，用于表达通用运行时工具场景。 */
export interface LaunchEnvironmentSnapshot {
  /**
   * Resolve one name across every layer, most trusted first.
   * @param name - the variable name.
   * @returns the winning entry, or `undefined` when no layer supplies it.
   */
  get(name: string): LaunchEnvironmentEntry | undefined
  /**
   * Resolve one name only from `sources`, retaining canonical trust order;
   * omitted layers are unreachable.
   * @param name - the variable name.
   * @param sources - the layers allowed in the canonical trust order.
   * @returns the first matching entry, or `undefined`.
   */
  getFrom(name: string, sources: readonly LaunchEnvironmentSource[]): LaunchEnvironmentEntry | undefined
}

/**
 * The map key one variable name resolves under. Windows treats environment
 * names case-insensitively; every other platform does not.
 * @param name - the variable name as written.
 * @returns the key to store and look up by.
 */
/** 中文说明：函数 lookupKey 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function lookupKey(name: string): string {
  /* v8 ignore next -- native Windows coverage exercises the folding arm; POSIX covers the exact one */
  return process.platform === 'win32' ? name.toUpperCase() : name
}

/** One layer's raw contents, as {@link createLaunchEnvironmentSnapshot} receives them. */
/** 中文说明：interface LaunchEnvironmentLayerInput 定义本模块所需的数据或行为，用于表达通用运行时工具场景。 */
export interface LaunchEnvironmentLayerInput {
  source: LaunchEnvironmentSource
  /** Absolute path of the file behind this layer; omit for `process`. */
  path?: string
  values: Readonly<Record<string, string>>
}

/**
 * Build the snapshot from each layer's contents.
 * @param layers - the layers in any order; the result searches them by canonical trust order.
 * @returns the immutable snapshot.
 */
/** 中文说明：函数 createLaunchEnvironmentSnapshot 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export function createLaunchEnvironmentSnapshot(layers: readonly LaunchEnvironmentLayerInput[]): LaunchEnvironmentSnapshot {
  // Copy every layer so later mutations cannot change the snapshot. Fold names
  // on Windows so case variants cannot split precedence; POSIX remains exact.
  /** 中文说明：变量 bySource 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const bySource = new Map<LaunchEnvironmentSource, { path?: string; values: Map<string, string> }>()
  /** 中文说明：该循环依次处理输入或结果；循环变量仅在当前循环中有效。 */
  for (const layer of layers) {
    bySource.set(layer.source, {
      ...layer.path === undefined ? {} : { path: layer.path },
      values: new Map(Object.entries(layer.values).map(([name, value]) => [lookupKey(name), value])),
    })
  }
  /** 中文说明：函数值 getFrom 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const getFrom = (name: string, sources: readonly LaunchEnvironmentSource[]): LaunchEnvironmentEntry | undefined => {
    /** 中文说明：变量 key 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const key = lookupKey(name)
    /** 中文说明：该循环依次处理输入或结果；循环变量仅在当前循环中有效。 */
    for (const source of SOURCE_ORDER) {
      if (!sources.includes(source)) continue
      /** 中文说明：变量 layer 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const layer = bySource.get(source)
      /** 中文说明：变量 value 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const value = layer?.values.get(key)
      if (value === undefined) continue
      return { value, source, ...layer?.path === undefined ? {} : { path: layer.path } }
    }
    return undefined
  }
  return {
    get: name => getFrom(name, SOURCE_ORDER),
    getFrom,
  }
}

/** Context slot the launcher fills with this run's snapshot before any config entry mounts. */
/** 中文说明：常量 DSH_LAUNCH_ENVIRONMENT_KEY 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
export const DSH_LAUNCH_ENVIRONMENT_KEY = 'launchEnvironment'

/**
 * Return the launcher's snapshot, or the inherited environment as the sole
 * layer when the host provided none.
 * @param ctx - the consuming plugin's context.
 * @returns the snapshot to resolve user-facing values against.
 */
/** 中文说明：函数 launchEnvironmentOf 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export function launchEnvironmentOf(ctx: Context): LaunchEnvironmentSnapshot {
  return ctx.get(DSH_LAUNCH_ENVIRONMENT_KEY)
    ?? createLaunchEnvironmentSnapshot([{ source: 'process', values: process.env as Record<string, string> }])
}

declare module '@deepseek-ai/cordis' {
  /** 中文说明：interface Context 定义本模块所需的数据或行为，用于表达通用运行时工具场景。 */
  interface Context {
    /** Launcher-owned snapshot of this run's environment; absent in compositions the product CLI did not boot. */
    launchEnvironment?: LaunchEnvironmentSnapshot
  }
}
