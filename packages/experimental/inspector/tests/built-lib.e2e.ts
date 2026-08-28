/**
 * 文件职责：验证 experimental/inspector 中 built lib e2e 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'

/**
 * 常量说明：packageDirectory 用于处理 packageDirectory 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const packageDirectory = fileURLToPath(new URL('..', import.meta.url))
/**
 * 常量说明：built 用于处理 built 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：file（由 TypeScript
 * 根据调用位置推断的类型）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
 * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(file)，
 * 并按返回类型处理结果。
 */
const built = [
  'lib/index.js',
  'lib/worker.js',
  'node_modules/@deepseek-ai/schemastery/lib/index.mjs',
].every(file => existsSync(join(packageDirectory, file)))

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe.skipIf(!built)('experimental Inspector built artifact', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('starts its sibling Worker and evaluates the Host through plain Node', async () => {
    /**
     * 常量说明：script 用于处理 script 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const script = `
      const { startInspector } = await import('@deepseek-ai/dsh-experimental-inspector')
      const { default: WebSocket } = await import('ws')
      globalThis.__builtInspectorProbe = 42
      const inspector = await startInspector({ port: 0, captureFetch: false })
      const socket = new WebSocket(inspector.endpoint.webSocketDebuggerUrl)
      await new Promise((resolve, reject) => {
        socket.once('open', resolve)
        socket.once('error', reject)
      })
      const response = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('CDP response timeout')), 5000)
        socket.on('message', data => {
          const message = JSON.parse(Buffer.from(data).toString('utf8'))
          if (message.id !== 1) return
          clearTimeout(timer)
          resolve(message)
        })
      })
      socket.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression: 'globalThis.__builtInspectorProbe', returnByValue: true },
      }))
      const message = await response
      socket.close()
      await inspector.close()
      console.log(JSON.stringify(message.result.result))
    `
    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = await execa(process.execPath, ['--input-type=module', '-e', script], {
      cwd: packageDirectory,
      stdin: 'ignore',
      timeout: 20_000,
      killSignal: 'SIGKILL',
      reject: false,
    })

    expect(result.exitCode, `stderr:\n${result.stderr}`).toBe(0)
    expect(JSON.parse(result.stdout.trim()) as unknown).toEqual({ type: 'number', value: 42, description: '42' })
  })
})
