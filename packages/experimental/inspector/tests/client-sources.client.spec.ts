/** Client-face source catalog behavior.
 * @remarks 文件说明：文件职责：验证 experimental/inspector 中 client sources client
 * spec 相关行为与失败场景。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import { describe, expect, it } from 'vitest'
import { ClientSourceCatalog } from '../src/client/cdp/sources.ts'
import { inspectorId } from '../src/shared/bridge/ids.ts'

/**
 * 常量说明：scriptKey 用于处理 scriptKey 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const scriptKey = inspectorId<'RuntimeScriptKey'>('bundle', 'scriptKey')

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('Client source catalog', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('describes scripts and transfers UTF-8 source and maps in bounded chunks', async () => {
    /**
     * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const source = 'const greeting = "你好"\nconsole.log(greeting)\n'
    /**
     * 常量说明：sourceMap 用于处理 sourceMap 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const sourceMap = JSON.stringify({ version: 3, sources: ['client.ts'], mappings: 'AAAA' })
    /**
     * 常量说明：catalog 用于处理 catalog 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const catalog = new ClientSourceCatalog([{
      scriptKey,
      url: 'http://client.test/plugins/inspector/client.js?rev=abc',
      hash: 'abc',
      sourceMapUrl: 'http://client.test/plugins/inspector/client.js.map?rev=abc',
      isModule: false,
      loadSource: async () => source,
      loadSourceMap: async () => sourceMap,
    }])

    await expect(catalog.execute({ op: 'list-scripts' }, 1_024)).resolves.toEqual({
      op: 'list-scripts',
      scripts: [{
        scriptKey,
        url: 'http://client.test/plugins/inspector/client.js?rev=abc',
        hash: 'abc',
        buildId: '',
        sourceMapUrl: 'http://client.test/plugins/inspector/client.js.map?rev=abc',
        startLine: 0,
        startColumn: 0,
        endLine: 2,
        endColumn: 0,
        isModule: false,
        length: source.length,
      }],
    })

    /**
     * 常量说明：bytes 用于处理 bytes 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const bytes: Uint8Array[] = []
    /**
     * 变量说明：offset 用于处理 offset 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let offset = 0
    while (true) {
      /**
       * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const result = await catalog.execute({
        op: 'get-content-chunk',
        scriptKey,
        content: 'source',
        offset,
        maxBytes: 7,
      }, 1_024)
      if (result.op !== 'get-content-chunk' || !result.available) throw new Error('missing source chunk')
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：character（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(character)，并按返回类型处理结果。
       */
      bytes.push(Uint8Array.from(atob(result.data), character => character.charCodeAt(0)))
      offset = result.nextOffset
      if (result.eof) break
    }
    /**
     * 常量说明：combined 用于处理 combined 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：total（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：chunk（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(total, chunk)，并按返回类型处理结果。
     */
    const combined = new Uint8Array(bytes.reduce((total, chunk) => total + chunk.byteLength, 0))
    /**
     * 变量说明：cursor 用于处理 cursor 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let cursor = 0
    /**
     * 变量说明：chunk 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const chunk of bytes) {
      combined.set(chunk, cursor)
      cursor += chunk.byteLength
    }
    expect(new TextDecoder().decode(combined)).toBe(source)

    /**
     * 常量说明：map 用于映射 map 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const map = await catalog.execute({
      op: 'get-content-chunk',
      scriptKey,
      content: 'source-map',
      offset: 0,
      maxBytes: 1_024,
    }, 1_024)
    if (map.op !== 'get-content-chunk' || !map.available) throw new Error('missing source map')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：character（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(character)，并按返回类型处理结果。
     */
    expect(new TextDecoder().decode(Uint8Array.from(atob(map.data), character => character.charCodeAt(0))))
      .toBe(sourceMap)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('rejects assets above the configured aggregate limit', async () => {
    /**
     * 常量说明：catalog 用于处理 catalog 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const catalog = new ClientSourceCatalog([{
      scriptKey,
      url: 'http://client.test/client.js',
      hash: 'abc',
      loadSource: async () => 'x'.repeat(101),
    }])
    await expect(catalog.execute({ op: 'list-scripts' }, 100)).rejects.toMatchObject({ code: 'result-too-large' })
  })
})
