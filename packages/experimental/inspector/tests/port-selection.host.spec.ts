/** Host Worker port-selection behavior.
 * @remarks 文件说明：文件职责：验证 experimental/inspector 中 port selection host spec
 * 相关行为与失败场景。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { startInspector, type InspectorHandle } from '../src/host/bridge/controller.ts'

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return
  await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
}

async function listen(server: Server, port: number): Promise<AddressInfo> {
  return await new Promise<AddressInfo>((resolve, reject) => {
    const onError = (error: Error): void => { reject(error) }
    server.once('error', onError)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', onError)
      const address = server.address()
      if (address === null || typeof address === 'string') {
        reject(new Error('test server did not bind a TCP port'))
        return
      }
      resolve(address)
    })
  })
}

async function bindWithAvailableSuccessor(): Promise<Server> {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const candidate = createServer()
    const address = await listen(candidate, 0)
    if (address.port === 65_535) {
      await closeServer(candidate)
      continue
    }
    const probe = createServer()
    try {
      await listen(probe, address.port + 1)
      return candidate
    } catch {
      await closeServer(candidate)
    } finally {
      await closeServer(probe)
    }
  }
  throw new Error('test could not reserve an occupied port with a bindable successor')
}

describe('Inspector endpoint port selection', () => {
  /**
   * 变量说明：blocker 用于处理 blocker 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let blocker: Server | undefined
  /**
   * 变量说明：inspector 用于处理 inspector 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let inspector: InspectorHandle | undefined

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  afterEach(async () => {
    await inspector?.close()
    inspector = undefined
    if (blocker !== undefined) await closeServer(blocker)
    blocker = undefined
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('advances from an occupied starting port and publishes the selected port', async () => {
    blocker = await bindWithAvailableSuccessor()
    const occupiedAddress = blocker.address()
    if (occupiedAddress === null || typeof occupiedAddress === 'string') {
      throw new Error('test server did not bind a TCP port')
    }

    inspector = await startInspector({ port: occupiedAddress.port, captureFetch: false })
    /**
     * 常量说明：selectedPort 用于处理 selectedPort 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const selectedPort = Number(new URL(inspector.endpoint.httpUrl).port)

    expect(selectedPort).toBeGreaterThan(occupiedAddress.port)
    expect(new URL(inspector.endpoint.webSocketDebuggerUrl).port).toBe(String(selectedPort))
    expect(new URL(inspector.endpoint.client.endpoint).port).toBe(String(selectedPort))
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：response（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(response)，并按返回类型处理结果。
     */
    await expect(fetch(new URL('json', inspector.endpoint.httpUrl)).then(response => response.status)).resolves.toBe(200)
  })
})
