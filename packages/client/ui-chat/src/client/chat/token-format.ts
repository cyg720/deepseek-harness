/**
 * 文件职责：实现 client/ui-chat 中 token format 模块的职责，并向相邻模块提供可复用能力。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：支撑 DeepSeek Harness 的 client/ui-chat 能力，使上层功能能够稳定组合和扩展。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import type { ChatViewSlotProps } from '../contract/slots.ts'

/**
 * Compact token count: 517 / 12.2K / 517K / 1.2M.
 * @param value - non-negative token count.
 * @param t - Chat locale seat.
 * @returns locale-owned compact display string.
 * @remarks 中文说明：功能说明：格式化 Tokens 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：t（ChatViewSlotProps['t']）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 formatTokens(value, t)，
 * 并按返回类型处理结果。
 */
export function formatTokens(value: number, t: ChatViewSlotProps['t']): string {
  /**
   * 常量说明：scaled 用于处理 scaled 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 scaled 相关流程；使用场景由所在模块及调用位置决定。
   * @param candidate （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 scaled(candidate)，并按返回类型处理结果。
   */
  const scaled = (candidate: number): string =>
    candidate >= 100 ? String(Math.round(candidate)) : String(Math.round(candidate * 10) / 10)
  if (value < 1_000) return String(value)
  if (value < 1_000_000) return t('number.thousand', { value: scaled(value / 1_000) })
  return t('number.million', { value: scaled(value / 1_000_000) })
}

/**
 * Exact integer token count with locale-owned digit grouping.
 * @param value - non-negative safe integer token count.
 * @param t - Chat locale seat.
 * @returns an unrounded display string.
 * @remarks 中文说明：功能说明：格式化 Exact Tokens 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：t（ChatViewSlotProps['t']）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 formatExactTokens(value,
 * t)，并按返回类型处理结果。
 */
export function formatExactTokens(value: number, t: ChatViewSlotProps['t']): string {
  /**
   * 常量说明：digits 用于处理 digits 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const digits = String(value)
  /**
   * 常量说明：groups 用于处理 groups 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const groups: string[] = []
  /**
   * 变量说明：end 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (let end = digits.length; end > 0; end -= 3) {
    groups.unshift(digits.slice(Math.max(0, end - 3), end))
  }
  return groups.join(t('number.groupSeparator'))
}

/** Round a cache-read ratio to exact percentage units, with positive ties rounded up.
 * @remarks 中文说明：功能说明：处理 roundedPercentUnits 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：cacheReadTokens（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：denominator（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：decimalPlaces（0 | 1）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：number；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * roundedPercentUnits(cacheReadTokens, denominator, decimalPlaces)，
 * 并按返回类型处理结果。 */
function roundedPercentUnits(cacheReadTokens: number, denominator: number, decimalPlaces: 0 | 1): number {
  /**
   * 常量说明：unitsPerPercent 用于处理 unitsPerPercent 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const unitsPerPercent = decimalPlaces === 0 ? 1 : 10
  /**
   * 常量说明：scale 用于处理 scale 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const scale = unitsPerPercent * 100
  /**
   * 常量说明：doubledScale 用于处理 doubledScale 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const doubledScale = scale * 2
  /**
   * 常量说明：denominatorQuotient 用于处理 denominatorQuotient 相关数据，作用于当前作用域；
   * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const denominatorQuotient = Math.floor(denominator / doubledScale)
  /**
   * 常量说明：denominatorRemainder 用于处理 denominatorRemainder 相关数据，作用于当前作用域；
   * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const denominatorRemainder = denominator % doubledScale
  /**
   * 变量说明：lower 用于处理 lower 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let lower = 0
  /**
   * 变量说明：upper 用于处理 upper 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let upper = scale
  while (lower < upper) {
    /**
     * 常量说明：candidate 用于处理 candidate 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const candidate = Math.floor((lower + upper + 1) / 2)
    /**
     * 常量说明：factor 用于处理 factor 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const factor = candidate * 2 - 1
    /**
     * 常量说明：threshold 用于处理 threshold 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const threshold = factor * denominatorQuotient
      + Math.ceil(factor * denominatorRemainder / doubledScale)
    if (cacheReadTokens >= threshold) lower = candidate
    else upper = candidate - 1
  }
  return lower
}

/**
 * 功能说明：处理 displayPercentUnits 相关流程；使用场景由所在模块及调用位置决定。
 * @param units （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param decimalPlaces （0 | 1）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 displayPercentUnits(units, decimalPlaces)，并按返回类型处理结果。
 */
function displayPercentUnits(units: number, decimalPlaces: 0 | 1): string {
  if (decimalPlaces === 0) return String(units)
  /**
   * 常量说明：whole 用于处理 whole 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const whole = Math.floor(units / 10)
  /**
   * 常量说明：tenths 用于处理 tenths 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const tenths = units % 10
  return tenths === 0 ? String(whole) : `${whole}.${tenths}`
}

/**
 * Display-ready cache-hit share without rounding a partial hit to 100%.
 * @param cacheReadTokens - exact prompt tokens served from cache.
 * @param promptTokens - exact aggregate prompt tokens.
 * @param decimalPlaces - ordinary-ratio precision; partial hits that would
 * round to 100 automatically use enough additional precision to stay honest.
 * @returns percentage text, or null when there was no prompt input.
 * @remarks 中文说明：功能说明：格式化 Cache Hit Percent 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：cacheReadTokens（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：promptTokens（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：decimalPlaces（0 | 1）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string |
 * null；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * formatCacheHitPercent(cacheReadTokens, promptTokens, decimalPlaces)，
 * 并按返回类型处理结果。
 */
export function formatCacheHitPercent(
  cacheReadTokens: number,
  promptTokens: number,
  decimalPlaces: 0 | 1 = 0,
): string | null {
  if (promptTokens === 0) return null
  /**
   * 常量说明：missedInputTokens 用于处理 missedInputTokens 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const missedInputTokens = promptTokens - cacheReadTokens
  if (missedInputTokens === 0) return '100'

  /**
   * 常量说明：roundedUnits 用于处理 roundedUnits 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const roundedUnits = roundedPercentUnits(cacheReadTokens, promptTokens, decimalPlaces)
  /**
   * 常量说明：fullHitUnits 用于处理 fullHitUnits 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const fullHitUnits = decimalPlaces === 0 ? 100 : 1_000
  if (roundedUnits < fullHitUnits) return displayPercentUnits(roundedUnits, decimalPlaces)

  /**
   * 变量说明：distinguishingPlaces 用于处理 distinguishingPlaces 相关数据，作用于当前作用域；
   * 其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let distinguishingPlaces = 1
  /**
   * 变量说明：scaledDoubleGap 用于处理 scaledDoubleGap 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let scaledDoubleGap = missedInputTokens * 200
  /**
   * 常量说明：denominatorTens 用于处理 denominatorTens 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const denominatorTens = Math.floor(promptTokens / 10)
  while (scaledDoubleGap <= denominatorTens) {
    scaledDoubleGap *= 10
    distinguishingPlaces += 1
  }
  /**
   * 常量说明：denominatorOnes 用于处理 denominatorOnes 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const denominatorOnes = promptTokens % 10
  /**
   * 变量说明：roundedLoss 用于处理 roundedLoss 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let roundedLoss = 5
  /**
   * 变量说明：loss 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (let loss = 1; loss < 5; loss += 1) {
    /**
     * 常量说明：factor 用于处理 factor 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const factor = loss * 2 + 1
    /**
     * 常量说明：threshold 用于处理 threshold 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const threshold = factor * denominatorTens + Math.floor(factor * denominatorOnes / 10)
    if (scaledDoubleGap <= threshold) {
      roundedLoss = loss
      break
    }
  }
  return `99.${'9'.repeat(distinguishingPlaces - 1)}${10 - roundedLoss}`
}
