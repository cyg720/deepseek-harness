/** Incremental UTF-8 parser for Server-Sent Events carried by captured responses.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 event source 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type { InspectorEventSourceMessage } from './observation.ts'

/** Parse response bytes into consumer-neutral Server-Sent Event messages.
 * @remarks 中文说明：类说明：InspectorEventSourceParser 用于集中封装 处理
 * InspectorEventSourceParser 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；
 * 使用场景：由 experimental/inspector 在对应插件或业务生命周期内创建和调用。 */
export class InspectorEventSourceParser {
  /**
   * 常量说明：decoder 用于处理 decoder 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly decoder = new TextDecoder()
  /**
   * 变量说明：line 用于处理 line 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private line = ''
  /**
   * 变量说明：eventName 用于处理 eventName 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private eventName = ''
  /**
   * 变量说明：eventId 用于处理 eventId 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private eventId = ''
  /**
   * 变量说明：data 用于处理 data 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private data = ''
  /**
   * 变量说明：afterCarriageReturn 用于处理 afterCarriageReturn 相关数据，作用于成员；
   * 其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private afterCarriageReturn = false

  /**
   * Consume one response-body chunk.
   * @param bytes - Next bytes in response order.
   * @returns Complete events terminated by an empty line in this chunk.
   * @remarks 中文说明：功能说明：处理 push 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：bytes（Uint8Array）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：readonly
   * InspectorEventSourceMessage[]；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 push(bytes)，并按返回类型处理结果。
   */
  push(bytes: Uint8Array): readonly InspectorEventSourceMessage[] {
    return this.consume(this.decoder.decode(bytes, { stream: true }))
  }

  /**
   * 功能说明：处理 consume 相关流程；使用场景由所在模块及调用位置决定。
   * @param chunk （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns InspectorEventSourceMessage[]；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 consume(chunk)，并按返回类型处理结果。
   */
  private consume(chunk: string): InspectorEventSourceMessage[] {
    /**
     * 常量说明：messages 用于处理 messages 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const messages: InspectorEventSourceMessage[] = []
    /**
     * 变量说明：start 用于启动 start 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let start = 0
    /**
     * 变量说明：index 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (let index = 0; index < chunk.length; index++) {
      if (this.afterCarriageReturn && chunk[index] === '\n') {
        this.afterCarriageReturn = false
        start = index + 1
        continue
      }
      this.afterCarriageReturn = false
      if (chunk[index] !== '\r' && chunk[index] !== '\n') continue
      this.line += chunk.slice(start, index)
      /**
       * 常量说明：message 用于处理 message 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const message = this.parseLine()
      if (message !== undefined) messages.push(message)
      this.line = ''
      start = index + 1
      this.afterCarriageReturn = chunk[index] === '\r'
    }
    this.line += chunk.slice(start)
    return messages
  }

  /**
   * 功能说明：解析 Line 相关流程；使用场景由所在模块及调用位置决定。
   * @returns InspectorEventSourceMessage | undefined；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 parseLine()，并按返回类型处理结果。
   */
  private parseLine(): InspectorEventSourceMessage | undefined {
    if (this.line.length === 0) {
      /**
       * 常量说明：data 用于处理 data 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const data = this.data
      this.data = ''
      /**
       * 常量说明：eventName 用于处理 eventName 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const eventName = this.eventName
      this.eventName = ''
      if (data.length === 0) return undefined
      return {
        eventName: eventName || 'message',
        eventId: this.eventId,
        data: data.slice(0, -1),
      }
    }
    if (this.line.startsWith(':')) return undefined
    /**
     * 常量说明：colon 用于处理 colon 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const colon = this.line.indexOf(':')
    /**
     * 常量说明：field 用于处理 field 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const field = colon === -1 ? this.line : this.line.slice(0, colon)
    /**
     * 变量说明：value 用于处理 value 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let value = colon === -1 ? '' : this.line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    switch (field) {
      case 'event':
        this.eventName = value
        return undefined
      case 'data':
        this.data += `${value}\n`
        return undefined
      case 'id':
        if (!value.includes('\0')) this.eventId = value
        return undefined
      default:
        return undefined
    }
  }
}
