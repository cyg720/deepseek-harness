/** Browser-readable catalog of built-in Preview filesystem overlays. */

/** Manifest format version emitted beside the base VFS image.
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 fixture manifest
 * 模块的职责，并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与
 * Cordis 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 * @remarks 中文说明：常量说明：PREVIEW_FIXTURE_MANIFEST_VERSION 用于处理
 * PREVIEW_FIXTURE_MANIFEST_VERSION 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const PREVIEW_FIXTURE_MANIFEST_VERSION = 1

/** Leaf name resolved beside the base image.
 * @remarks 中文说明：常量说明：PREVIEW_FIXTURE_MANIFEST_FILE 用于处理
 * PREVIEW_FIXTURE_MANIFEST_FILE 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const PREVIEW_FIXTURE_MANIFEST_FILE = 'fixtures.json'

/** One selectable built-in fixture and its ordered overlay archives. */
export interface PreviewFixtureManifestEntry {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly overlays: readonly string[]
}

/** Complete built-in fixture catalog consumed before Worker startup. */
export interface PreviewFixtureManifest {
  readonly version: number
  /** Required default fixture id, or null when the chooser should default to an empty overlay. */
  readonly defaultFixture: string | null
  readonly fixtures: readonly PreviewFixtureManifestEntry[]
}

/**
 * 功能说明：处理 recordOf 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Record<string, unknown> | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 recordOf(value)，并按返回类型处理结果。
 */
function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/**
 * Validate the static fixture catalog before it controls Worker fetches.
 * @param value - Parsed JSON response.
 * @returns A detached manifest with unique ids and non-empty overlay lists.
 * @remarks 中文说明：功能说明：解析 Preview Fixture Manifest 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：PreviewFixtureManifest；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 parsePreviewFixtureManifest(value)，并按返回类型处理结果。
 */
export function parsePreviewFixtureManifest(value: unknown): PreviewFixtureManifest {
  /**
   * 常量说明：record 用于处理 record 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const record = recordOf(value)
  if (record?.version !== PREVIEW_FIXTURE_MANIFEST_VERSION || !Array.isArray(record.fixtures)) {
    throw new Error(`preview fixture manifest must use version ${String(PREVIEW_FIXTURE_MANIFEST_VERSION)}`)
  }
  /**
   * 常量说明：fixtures 用于处理 fixtures 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const fixtures: PreviewFixtureManifestEntry[] = []
  /**
   * 常量说明：ids 用于处理 ids 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const ids = new Set<string>()
  /**
   * 变量说明：value 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const value of record.fixtures) {
    /**
     * 常量说明：fixture 用于处理 fixture 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const fixture = recordOf(value)
    /**
     * 常量说明：id 用于处理 id 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const id = fixture?.id
    /**
     * 常量说明：label 用于处理 label 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const label = fixture?.label
    /**
     * 常量说明：description 用于处理 description 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const description = fixture?.description
    /**
     * 常量说明：overlays 用于处理 overlays 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const overlays = fixture?.overlays
    /**
     * 常量说明：overlayUrls 用于处理 overlayUrls 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：overlay（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：overlay is string；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(overlay)，并按返回类型处理结果。
     */
    const overlayUrls = Array.isArray(overlays)
      ? overlays.filter((overlay): overlay is string => typeof overlay === 'string' && overlay.length > 0)
      : []
    if (typeof id !== 'string' || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(id)
      || id === 'none' || id === 'webfs'
      || typeof label !== 'string' || label.length === 0
      || typeof description !== 'string' || description.length === 0
      || !Array.isArray(overlays) || overlays.length === 0 || overlayUrls.length !== overlays.length) {
      throw new Error('preview fixture manifest contains an invalid fixture entry')
    }
    if (ids.has(id)) throw new Error(`preview fixture manifest repeats id "${id}"`)
    ids.add(id)
    fixtures.push({ id, label, description, overlays: overlayUrls })
  }
  /**
   * 常量说明：defaultFixture 用于处理 defaultFixture 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const defaultFixture = record.defaultFixture
  if (defaultFixture !== null && (typeof defaultFixture !== 'string' || !ids.has(defaultFixture))) {
    throw new Error('preview fixture manifest defaultFixture does not name a fixture')
  }
  return { version: PREVIEW_FIXTURE_MANIFEST_VERSION, defaultFixture, fixtures }
}
