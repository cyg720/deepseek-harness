/**
 * 文件职责：验证 e2b/e2b 中 fixture lsp 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { Buffer } from 'node:buffer'

/**
 * 变量说明：pending 用于处理 pending 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
 */
let pending = Buffer.alloc(0)
/**
 * 变量说明：source 用于处理 source 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
 */
let source = ''
/**
 * 变量说明：sourceUri 用于处理 sourceUri 相关数据，作用于当前作用域；其值可能随流程推进而变化，
 * 读写时需遵守声明类型和所在生命周期。
 */
let sourceUri = ''

/**
 * 功能说明：处理 send 相关流程；使用场景由所在模块及调用位置决定。
 * @param message （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 send(message)，并按返回类型处理结果。
 */
function send(message) {
  /**
   * 常量说明：body 用于处理 body 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const body = Buffer.from(JSON.stringify(message))
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`)
  process.stdout.write(body)
}

/**
 * 功能说明：处理 respond 相关流程；使用场景由所在模块及调用位置决定。
 * @param id （由 TypeScript 根据调用位置推断的类型）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。
 * @param result （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 respond(id, result)，并按返回类型处理结果。
 */
function respond(id, result) {
  send({ jsonrpc: '2.0', id, result })
}

/**
 * 功能说明：分发 dispatch 相关流程；使用场景由所在模块及调用位置决定。
 * @param message （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 dispatch(message)，并按返回类型处理结果。
 */
function dispatch(message) {
  switch (message.method) {
    case 'initialize':
      respond(message.id, {
        capabilities: {
          positionEncoding: 'utf-16',
          textDocumentSync: { openClose: true, change: 1 },
          definitionProvider: true,
          referencesProvider: true,
          implementationProvider: true,
          hoverProvider: true,
        },
      })
      return
    case 'textDocument/didOpen':
      source = message.params.textDocument.text
      sourceUri = message.params.textDocument.uri
      return
    case 'textDocument/didClose':
      source = ''
      sourceUri = ''
      return
    case 'textDocument/hover':
      if (!source.includes('const café = "你好"')) {
        send({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: 'multibyte source was corrupted' } })
        return
      }
      respond(message.id, {
        contents: { kind: 'markdown', value: '**remote hover** 你好 café' },
        range: { start: { line: 0, character: 6 }, end: { line: 0, character: 10 } },
      })
      return
    case 'textDocument/definition':
    case 'textDocument/references':
    case 'textDocument/implementation':
      respond(message.id, [{
        uri: sourceUri,
        range: { start: { line: 0, character: 6 }, end: { line: 0, character: 10 } },
      }])
      return
    case 'shutdown':
      respond(message.id, null)
      return
    case 'exit':
      process.exit(0)
      return
  }
}

/**
 * 功能说明：处理 drain 相关流程；使用场景由所在模块及调用位置决定。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 drain()，并按返回类型处理结果。
 */
function drain() {
  for (;;) {
    /**
     * 常量说明：headerEnd 用于处理 headerEnd 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const headerEnd = pending.indexOf('\r\n\r\n')
    if (headerEnd < 0) return
    /**
     * 常量说明：header 用于处理 header 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const header = pending.subarray(0, headerEnd).toString('ascii')
    /**
     * 常量说明：match 用于处理 match 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const match = /(?:^|\r\n)Content-Length: ([0-9]+)(?:\r\n|$)/i.exec(header)
    if (!match) throw new Error('missing Content-Length')
    /**
     * 常量说明：length 用于处理 length 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const length = Number(match[1])
    /**
     * 常量说明：bodyStart 用于处理 bodyStart 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const bodyStart = headerEnd + 4
    if (pending.length < bodyStart + length) return
    /**
     * 常量说明：body 用于处理 body 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const body = pending.subarray(bodyStart, bodyStart + length)
    pending = pending.subarray(bodyStart + length)
    dispatch(JSON.parse(body.toString('utf8')))
  }
}

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：chunk（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(chunk)，并按返回类型处理结果。
 */
process.stdin.on('data', chunk => {
  pending = Buffer.concat([pending, chunk])
  drain()
})
