/**
 * DeepSeek v4 vision-token accounting: the provider's published image-token
 * calculator (api-docs.deepseek.com, Token & Token Usage) ported verbatim.
 * The provider resizes every request image onto a 14px-patch grid, downsamples
 * 3:1 per axis, and caps one image at 384 tokens; the port prices the
 * pad-to-4 alignment at its 3-token upper bound because request pricing has
 * no preceding-token position. Actual usage remains authoritative.
 *
 * @module dsh-llm-deepseek/image-tokens
 */

/** Vision patch edge in pixels.
 * @remarks 文件说明：文件职责：实现 llm/llm-deepseek 中 image tokens 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的 llm/llm-deepseek
 * 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 * @remarks 中文说明：常量说明：PATCH_SIZE 用于处理 PATCH_SIZE 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
const PATCH_SIZE = 14
/** Per-axis patch-to-token downsampling ratio.
 * @remarks 中文说明：常量说明：DOWNSAMPLE_RATIO 用于处理 DOWNSAMPLE_RATIO 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
const DOWNSAMPLE_RATIO = 3
/** Provider cap on tokens for one request image.
 * @remarks 中文说明：常量说明：MAX_IMAGE_TOKENS 用于处理 MAX_IMAGE_TOKENS 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
const MAX_IMAGE_TOKENS = 384
/** Token-alignment quantum; pricing charges its worst-case `QUANTUM - 1` pad.
 * @remarks 中文说明：常量说明：COMPRESS_PAD_TO 用于处理 COMPRESS_PAD_TO 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
const COMPRESS_PAD_TO = 4
/** Width is clamped to this multiple of height before grid projection.
 * @remarks 中文说明：常量说明：MAX_WIDTH_HEIGHT_RATIO 用于处理 MAX_WIDTH_HEIGHT_RATIO
 * 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
const MAX_WIDTH_HEIGHT_RATIO = 8
/** Total-pixel floor; smaller images are scaled up before grid projection.
 * @remarks 中文说明：常量说明：MIN_PIXELS 用于处理 MIN_PIXELS 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
const MIN_PIXELS = 384 * 384

/**
 * 常量说明：intDiv 用于处理 intDiv 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 intDiv 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param divisor （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns number；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 intDiv(value, divisor)，并按返回类型处理结果。
 */
const intDiv = (value: number, divisor: number): number => Math.floor(value / divisor)
/**
 * 常量说明：ceilDiv 用于处理 ceilDiv 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 ceilDiv 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param divisor （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns number；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 ceilDiv(value, divisor)，并按返回类型处理结果。
 */
const ceilDiv = (value: number, divisor: number): number => Math.floor((value + divisor - 1) / divisor)

interface GridResize {
  readonly gridHeight: number
  readonly gridWidth: number
  readonly bestHeight: number
  readonly bestWidth: number
  readonly numTokens: number
}

/** Token count of one grid, including row separators and framing.
 * @remarks 中文说明：功能说明：处理 gridTokens 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：gridHeight（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：gridWidth（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：number；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 gridTokens(gridHeight,
 * gridWidth)，并按返回类型处理结果。 */
function gridTokens(gridHeight: number, gridWidth: number): number {
  /**
   * 变量说明：tokens 用于处理 tokens 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let tokens = gridHeight * (gridWidth + 1) + 2
  if (gridHeight % 2 === 1) tokens += gridWidth + 1
  tokens += (ceilDiv(gridHeight, 2) * (gridWidth + 1) % 2) * 2
  return tokens
}

/** Solve the largest grid within `budget` tokens preserving the aspect ratio.
 * @remarks 中文说明：功能说明：处理 solveResizeRatio 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：height（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：width（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：budget（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：GridResize；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 solveResizeRatio(height,
 * width, budget)，并按返回类型处理结果。 */
function solveResizeRatio(height: number, width: number, budget: number): GridResize {
  /**
   * 常量说明：aspect 用于处理 aspect 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const aspect = height / width
  /**
   * 常量说明：idealGridWidth 用于处理 idealGridWidth 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const idealGridWidth = Math.sqrt((budget - 2) / aspect + 0.25) - 0.5
  /**
   * 常量说明：idealGridHeight 用于处理 idealGridHeight 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const idealGridHeight = idealGridWidth * aspect
  /**
   * 变量说明：bestHeight 用于处理 bestHeight 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let bestHeight: number
  /**
   * 变量说明：bestWidth 用于处理 bestWidth 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let bestWidth: number
  if (idealGridWidth < 1) {
    /**
     * 常量说明：solvedGridWidth 用于处理 solvedGridWidth 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const solvedGridWidth = 1
    /**
     * 变量说明：solvedGridHeight 用于处理 solvedGridHeight 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let solvedGridHeight = intDiv(budget - 2, solvedGridWidth + 1)
    // v8 ignore: at the provider budget the one-column solve always lands on
    // the odd 189-row grid, so the even path is unreachable; kept for parity
    // with the published solver.
    /* v8 ignore next */
    if (solvedGridHeight % 2 === 1) solvedGridHeight -= 1
    bestWidth = solvedGridWidth * PATCH_SIZE * DOWNSAMPLE_RATIO
    bestHeight = solvedGridHeight * PATCH_SIZE * DOWNSAMPLE_RATIO
  /* v8 ignore start -- unreachable at the provider budget: idealGridWidth >= 1
     bounds the aspect at (budget - 2) / 2, making idealGridHeight >= 2 for
     every budget this module solves; kept for parity with the published
     solver. */
  } else if (idealGridHeight < 2) {
    /**
     * 常量说明：solvedGridHeight 用于处理 solvedGridHeight 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const solvedGridHeight = 2
    /**
     * 常量说明：solvedGridWidth 用于处理 solvedGridWidth 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const solvedGridWidth = intDiv(budget - 2, solvedGridHeight) - 1
    if (!(solvedGridWidth > 1)) throw new Error('deepseek image tokens: no grid fits the token budget')
    bestWidth = solvedGridWidth * PATCH_SIZE * DOWNSAMPLE_RATIO
    bestHeight = solvedGridHeight * PATCH_SIZE * DOWNSAMPLE_RATIO
  /* v8 ignore stop */
  } else {
    /**
     * 常量说明：solvedGridWidth 用于处理 solvedGridWidth 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const solvedGridWidth = Math.trunc(idealGridWidth)
    /**
     * 变量说明：solvedGridHeight 用于处理 solvedGridHeight 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let solvedGridHeight = Math.trunc(idealGridHeight)
    if (solvedGridHeight % 2 === 1) solvedGridHeight -= 1
    /**
     * 常量说明：widthScale 用于处理 widthScale 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const widthScale = solvedGridWidth * PATCH_SIZE * DOWNSAMPLE_RATIO / width
    /**
     * 常量说明：heightScale 用于处理 heightScale 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const heightScale = solvedGridHeight * PATCH_SIZE * DOWNSAMPLE_RATIO / height
    /**
     * 常量说明：scale 用于处理 scale 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const scale = Math.min(widthScale, heightScale)
    bestWidth = Math.trunc(width * scale / PATCH_SIZE) * PATCH_SIZE
    bestHeight = Math.trunc(height * scale / PATCH_SIZE) * PATCH_SIZE
  }
  /**
   * 常量说明：gridHeight 用于处理 gridHeight 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const gridHeight = ceilDiv(intDiv(bestHeight, PATCH_SIZE), DOWNSAMPLE_RATIO)
  /**
   * 常量说明：gridWidth 用于处理 gridWidth 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const gridWidth = ceilDiv(intDiv(bestWidth, PATCH_SIZE), DOWNSAMPLE_RATIO)
  return { gridHeight, gridWidth, bestHeight, bestWidth, numTokens: gridTokens(gridHeight, gridWidth) }
}

/** Project padded pixel dimensions onto the largest in-budget token grid.
 * @remarks 中文说明：功能说明：处理 safeResize 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：height（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：width（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：paddedHeight（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：paddedWidth（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：GridResize；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 safeResize(height, width,
 * paddedHeight, paddedWidth)，并按返回类型处理结果。 */
function safeResize(height: number, width: number, paddedHeight: number, paddedWidth: number): GridResize {
  /**
   * 常量说明：gridHeight 用于处理 gridHeight 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const gridHeight = ceilDiv(intDiv(paddedHeight, PATCH_SIZE), DOWNSAMPLE_RATIO)
  /**
   * 常量说明：gridWidth 用于处理 gridWidth 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const gridWidth = ceilDiv(intDiv(paddedWidth, PATCH_SIZE), DOWNSAMPLE_RATIO)
  /**
   * 常量说明：pad 用于处理 pad 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const pad = COMPRESS_PAD_TO - 1
  /**
   * 常量说明：budget 用于处理 budget 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const budget = MAX_IMAGE_TOKENS - pad
  /**
   * 变量说明：result 用于处理 result 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let result: GridResize = {
    gridHeight,
    gridWidth,
    bestHeight: paddedHeight,
    bestWidth: paddedWidth,
    numTokens: gridTokens(gridHeight, gridWidth),
  }
  if (result.numTokens > budget) {
    result = solveResizeRatio(height, width, budget)
    /* v8 ignore next 4 -- the published solver's safety net; the closed-form
       solve stays within budget for every geometry the clamps admit. */
    /**
     * 变量说明：reduced 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (let reduced = budget; result.numTokens > budget; reduced -= 1) {
      result = solveResizeRatio(height, width, reduced)
    }
  }
  return { ...result, numTokens: result.numTokens + pad }
}

/** One clamp-scale-pad-project pass; the caller iterates it to a fixpoint.
 * @remarks 中文说明：功能说明：处理 resizeOnce 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：width（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：height（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：GridResize；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 resizeOnce(width, height)，
 * 并按返回类型处理结果。 */
function resizeOnce(width: number, height: number): GridResize {
  /**
   * 变量说明：clampedWidth 用于处理 clampedWidth 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let clampedWidth = width
  /**
   * 变量说明：clampedHeight 用于处理 clampedHeight 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let clampedHeight = height
  if (clampedWidth > clampedHeight * MAX_WIDTH_HEIGHT_RATIO) {
    clampedWidth = clampedHeight * MAX_WIDTH_HEIGHT_RATIO
  }
  /**
   * 常量说明：pixels 用于处理 pixels 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const pixels = clampedWidth * clampedHeight
  if (pixels < MIN_PIXELS && pixels > 0) {
    /**
     * 常量说明：scale 用于处理 scale 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const scale = Math.sqrt(MIN_PIXELS / pixels)
    clampedWidth = Math.trunc(clampedWidth * scale)
    clampedHeight = Math.trunc(clampedHeight * scale)
  }
  /**
   * 常量说明：paddedWidth 用于处理 paddedWidth 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const paddedWidth = ceilDiv(clampedWidth, PATCH_SIZE) * PATCH_SIZE
  /**
   * 常量说明：paddedHeight 用于处理 paddedHeight 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const paddedHeight = ceilDiv(clampedHeight, PATCH_SIZE) * PATCH_SIZE
  return safeResize(clampedHeight, clampedWidth, paddedHeight, paddedWidth)
}

/**
 * 功能说明：处理 sameResize 相关流程；使用场景由所在模块及调用位置决定。
 * @param a （GridResize）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param b （GridResize）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 sameResize(a, b)，并按返回类型处理结果。
 */
function sameResize(a: GridResize, b: GridResize): boolean {
  return a.gridHeight === b.gridHeight
    && a.gridWidth === b.gridWidth
    && a.bestHeight === b.bestHeight
    && a.bestWidth === b.bestWidth
    && a.numTokens === b.numTokens
}

/**
 * Vision tokens DeepSeek v4 charges for one request image of the given
 * dimensions, at the worst-case alignment pad.
 * @param width - positive integer request-image width in pixels.
 * @param height - positive integer request-image height in pixels.
 * @returns the provider vision-token price, at most 384.
 * @remarks 中文说明：功能说明：处理 deepSeekImageTokens 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：width（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：height（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：number；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 deepSeekImageTokens(width, height)，
 * 并按返回类型处理结果。
 */
export function deepSeekImageTokens(width: number, height: number): number {
  /**
   * 变量说明：result 用于处理 result 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let result = resizeOnce(width, height)
  /**
   * 变量说明：iteration 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (let iteration = 1; iteration < 10; iteration += 1) {
    /**
     * 常量说明：next 用于处理 next 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const next = resizeOnce(result.bestWidth, result.bestHeight)
    if (sameResize(next, result)) return result.numTokens
    result = next
  }
  /* v8 ignore next 2 -- the published solver's non-convergence guard; every
     pass is a projection, so a second identical pass is a fixpoint. */
  throw new Error(`deepseek image tokens: resize did not converge for ${width}x${height}`)
}
