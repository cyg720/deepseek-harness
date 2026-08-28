/** Relationship-preserving identity redaction for committed session snapshots.
 * @remarks 文件说明：文件职责：实现 test-support/session-snapshot 中 identity 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * test-support/session-snapshot 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 * @remarks 中文说明：常量说明：UUID_FRAGMENT_RE 用于处理 UUID_FRAGMENT_RE 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */

const UUID_FRAGMENT_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
/**
 * 常量说明：LEGACY_TOKEN_RE 用于处理 LEGACY_TOKEN_RE 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const LEGACY_TOKEN_RE = /^\{\{(?:sessionId|messageId)\}\}$/
/**
 * 常量说明：CANONICAL_TOKEN_RE 用于处理 CANONICAL_TOKEN_RE 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const CANONICAL_TOKEN_RE = /^\{\{(session|message|approval|workflow|command|rpc|retry|id):([1-9]\d*)\}\}$/
/**
 * 常量说明：ID_KEY_RE 用于处理 ID_KEY_RE 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const ID_KEY_RE = /(?:^id$|Id$|Ids$)/

type IdentityKind = 'session' | 'message' | 'approval' | 'workflow' | 'command' | 'rpc' | 'retry' | 'id'

interface ParsedLog {
  readonly records: Record<string, unknown>[]
  readonly trailingNewline: boolean
}

/**
 * 功能说明：判断是否为 Record 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns value is Record<string, unknown>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 isRecord(value)，并按返回类型处理结果。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * 功能说明：解析 Log 相关流程；使用场景由所在模块及调用位置决定。
 * @param log （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns ParsedLog；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 parseLog(log)，并按返回类型处理结果。
 */
function parseLog(log: string): ParsedLog {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：line（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(line)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：line（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(line)，并按返回类型处理结果。
   */
  return {
    records: log.split(/\r?\n/)
      .filter(line => line.trim() !== '')
      .map(line => JSON.parse(line) as Record<string, unknown>),
    trailingNewline: log.endsWith('\n'),
  }
}

/**
 * 功能说明：处理 messageId 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 messageId(value)，并按返回类型处理结果。
 */
function messageId(value: unknown): string | undefined {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || typeof value.role !== 'string'
    || !Array.isArray(value.content)
    || !isRecord(value.source)) return undefined
  return value.id
}

/**
 * 功能说明：处理 redactedCandidate 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 redactedCandidate(value)，并按返回类型处理结果。
 */
function redactedCandidate(value: string): boolean {
  return UUID_FRAGMENT_RE.test(value) || LEGACY_TOKEN_RE.test(value) || CANONICAL_TOKEN_RE.test(value)
}

/**
 * Replace volatile opaque ids while preserving equality relationships across a parent and its child logs.
 * @param logs - one scenario's primary-first session JSONL fixtures.
 * @returns compact JSONL with typed first-seen identity tokens.
 * @remarks 中文说明：功能说明：处理 redactSessionSnapshotIds 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：logs（readonly string[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string[]；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * redactSessionSnapshotIds(logs)，并按返回类型处理结果。
 */
export function redactSessionSnapshotIds(logs: readonly string[]): string[] {
  /**
   * 常量说明：parsed 用于处理 parsed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const parsed = logs.map(parseLog)
  /**
   * 常量说明：tokenByValue 用于处理 tokenByValue 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const tokenByValue = new Map<string, string>()
  /**
   * 常量说明：nextByKind 用于处理 nextByKind 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const nextByKind = new Map<IdentityKind, number>()

  /**
   * 常量说明：claim 用于处理 claim 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 claim 相关流程；使用场景由所在模块及调用位置决定。
   * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param kind （IdentityKind）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param always （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 claim(value, kind, always)，并按返回类型处理结果。
   */
  const claim = (value: unknown, kind: IdentityKind, always = false): void => {
    if (typeof value !== 'string' || value.length === 0 || tokenByValue.has(value)) return
    if (!always && !redactedCandidate(value)) return
    /**
     * 常量说明：canonical 用于处理 canonical 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const canonical = CANONICAL_TOKEN_RE.exec(value)
    if (canonical !== null) {
      /**
       * 常量说明：canonicalKind 用于处理 canonicalKind 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const canonicalKind = canonical[1] as IdentityKind
      /**
       * 常量说明：ordinal 用于处理 ordinal 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const ordinal = Number(canonical[2])
      nextByKind.set(canonicalKind, Math.max(nextByKind.get(canonicalKind) ?? 0, ordinal))
      tokenByValue.set(value, value)
      return
    }
    /**
     * 常量说明：next 用于处理 next 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const next = (nextByKind.get(kind) ?? 0) + 1
    nextByKind.set(kind, next)
    tokenByValue.set(value, `{{${kind}:${next}}}`)
  }

  /**
   * 变量说明：log 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const log of parsed) {
    /**
     * 常量说明：header 用于处理 header 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const header = log.records[0]
    if (header?.type === 'session') claim(header.id, 'session', true)
  }

  /**
   * 常量说明：collect 用于收集 collect 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：收集 collect 相关流程；使用场景由所在模块及调用位置决定。
   * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param recordType （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 collect(value, recordType)，并按返回类型处理结果。
   */
  const collect = (value: unknown, recordType?: unknown): void => {
    if (typeof value === 'string') {
      /**
       * 变量说明：match 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const match of value.matchAll(/\bas message ([0-9a-f-]{36})\b/gi)) claim(match[1], 'message')
      /**
       * 变量说明：match 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const match of value.matchAll(/\bAnonymous user: ([0-9a-f-]{36})\b/gi)) claim(match[1], 'id')
      return
    }
    if (Array.isArray(value)) {
      /**
       * 变量说明：item 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const item of value) collect(item, recordType)
      return
    }
    if (!isRecord(value)) return

    /**
     * 常量说明：identifiedMessage 用于处理 identifiedMessage 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const identifiedMessage = messageId(value)
    if (identifiedMessage !== undefined) claim(identifiedMessage, 'message')
    /**
     * 变量说明：childKey、item 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const [childKey, item] of Object.entries(value)) {
      if (recordType === 'approval/asked' || recordType === 'approval/decided') {
        if (childKey === 'id') claim(item, 'approval')
      } else if (childKey === 'commandId') {
        claim(item, 'command', true)
      } else if (childKey === 'rpcId') {
        claim(item, 'rpc', true)
      } else if (childKey === 'retryId') {
        claim(item, 'retry')
      } else if (childKey === 'runId') {
        claim(item, 'workflow')
      } else if (ID_KEY_RE.test(childKey)) {
        claim(item, 'id')
      }
      collect(item, recordType)
    }
  }
  /**
   * 变量说明：log 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const log of parsed) {
    /**
     * 变量说明：record 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const record of log.records) collect(record, record.type)
  }

  /**
   * 常量说明：replacements 用于处理 replacements 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：[left]（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：[right]（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调([left], [right])，
   * 并按返回类型处理结果。
   */
  const replacements = [...tokenByValue]
    .sort(([left], [right]) => right.length - left.length)
  /**
   * 常量说明：replace 用于处理 replace 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 replace 相关流程；使用场景由所在模块及调用位置决定。
   * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns unknown；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 replace(value)，并按返回类型处理结果。
   */
  const replace = (value: unknown): unknown => {
    if (typeof value === 'string') {
      /**
       * 常量说明：exact 用于处理 exact 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const exact = tokenByValue.get(value)
      if (exact !== undefined) return exact
      /**
       * 变量说明：output 用于处理 output 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
       */
      let output = value
      /**
       * 变量说明：source、token 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const [source, token] of replacements) output = output.split(source).join(token)
      return output
    }
    if (Array.isArray(value)) return value.map(replace)
    if (isRecord(value)) {
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：[key, item]（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调([key, item])，并按返回类型处理结果。
       */
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replace(item)]))
    }
    return value
  }

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：log（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(log)，并按返回类型处理结果。
   */
  return parsed.map((log) => {
    /**
     * 常量说明：content 用于处理 content 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：record（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(record)，并按返回类型处理结果。
     */
    const content = log.records.map(record => JSON.stringify(replace(record))).join('\n')
    return log.trailingNewline ? `${content}\n` : content
  })
}
