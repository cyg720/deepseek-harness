/**
 * Pure request-projection geometry shared by attachment providers and
 * provider-side request pricing. @module @deepseek-ai/dsh-attachment/request-projection
 */

/**
 * Compute aspect-preserving integer dimensions within a hard total-pixel budget.
 * @param width - positive source width.
 * @param height - positive source height.
 * @param maxPixels - positive width-times-height cap.
 * @returns inward-rounded dimensions; small images are not enlarged.
 * @remarks 文件说明：文件职责：实现 attachment/attachment 中 request projection 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * attachment/attachment 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 * @remarks 中文说明：功能说明：处理 requestImageDimensions 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：width（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：height（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：maxPixels（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：{ width:
 * number; height: number }；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * requestImageDimensions(width, height, maxPixels)，并按返回类型处理结果。
 */
export function requestImageDimensions(
  width: number,
  height: number,
  maxPixels: number,
): { width: number; height: number } {
  /**
   * 常量说明：scale 用于处理 scale 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const scale = Math.min(1, Math.sqrt(maxPixels / (width * height)))
  if (scale === 1) return { width, height }
  if (width >= height) {
    /**
     * 变量说明：projectedWidth 用于处理 projectedWidth 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let projectedWidth = Math.max(1, Math.floor(width * scale))
    /**
     * 变量说明：projectedHeight 用于处理 projectedHeight 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let projectedHeight = Math.max(1, Math.round(projectedWidth * height / width))
    while (projectedWidth * projectedHeight > maxPixels && projectedWidth > 1) {
      projectedWidth -= 1
      projectedHeight = Math.max(1, Math.round(projectedWidth * height / width))
    }
    return { width: projectedWidth, height: projectedHeight }
  }
  /**
   * 变量说明：projectedHeight 用于处理 projectedHeight 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let projectedHeight = Math.max(1, Math.floor(height * scale))
  /**
   * 变量说明：projectedWidth 用于处理 projectedWidth 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let projectedWidth = Math.max(1, Math.round(projectedHeight * width / height))
  while (projectedWidth * projectedHeight > maxPixels && projectedHeight > 1) {
    projectedHeight -= 1
    projectedWidth = Math.max(1, Math.round(projectedHeight * width / height))
  }
  return { width: projectedWidth, height: projectedHeight }
}
