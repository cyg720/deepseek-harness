/**
 * 文件职责：验证 acp/acp 中 mcp spec 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { McpServer } from '@agentclientprotocol/sdk'
import type { Config as McpClientConfig } from '@deepseek-ai/dsh-mcp-client'
import { mountAcpMcpServers } from '../src/mcp.ts'

/** Context stand-in that captures validated MCP configs without opening transports.
 * @remarks 中文说明：功能说明：处理 captureContext 相关流程；使用场景由所在模块及调用位置决定。；返回值：{ ctx:
 * Context; configs: McpClientConfig[] }；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 captureContext()，并按返回类型处理结果。 */
function captureContext(): { ctx: Context; configs: McpClientConfig[] } {
  /**
   * 常量说明：configs 用于处理 configs 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const configs: McpClientConfig[] = []
  /**
   * 常量说明：plugin 用于处理 plugin 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const plugin = vi.fn(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_plugin（unknown）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；参数：config（McpClientConfig）：提供本次操作使用的配置选项；
 * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 典型用法：在完成前置校验后调用 匿名回调(_plugin, config)，并按返回类型处理结果。
 */ (_plugin: unknown, config: McpClientConfig) => {
      configs.push(config)
      return Promise.resolve(undefined)
    })
  return { ctx: { plugin } as unknown as Context, configs }
}

describe('ACP MCP declaration mapping', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
    it('normalizes human server names and preserves standard stdio/HTTP fields', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx、configs 用于处理 ctx、configs 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { ctx, configs } = captureContext()

        await mountAcpMcpServers(ctx, [
          {
            name: 'Fancy server!',
            command: process.execPath,
            args: ['server.js'],
            env: [{ name: 'TOKEN', value: 'secret' }],
          },
          {
            type: 'http',
            name: '!!!',
            url: 'https://example.test/mcp',
            headers: [{ name: 'Authorization', value: 'Bearer token' }],
          },
        ], process.cwd())

        expect(configs).toHaveLength(2)
        expect(configs[0]).toMatchObject({
          transport: 'stdio',
          command: process.execPath,
          args: ['server.js'],
          env: { TOKEN: 'secret' },
          cwd: process.cwd(),
          failOnStartupError: true,
        })
        expect(configs[0]?.serverName).toMatch(/^Fancy_server_[0-9a-f]{8}$/)
        expect(configs[1]).toMatchObject({
          transport: 'streamable-http',
          url: 'https://example.test/mcp',
          headers: { Authorization: 'Bearer token' },
          failOnStartupError: true,
        })
        expect(configs[1]?.serverName).toMatch(/^server_[0-9a-f]{8}$/)
      })

    it.each([
      [[{ name: 'A', value: '1' }, { name: 'A', value: '2' }], /duplicate name/],
      [[{ name: '', value: '1' }], /invalid environment entry/],
      [[{ name: 'A\0', value: '1' }], /invalid environment entry/],
      [[{ name: 'A', value: '1\0' }], /invalid environment entry/],
    ] as const)('rejects invalid environment entries %#', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：env（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：message（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(env, message)，并按返回类型处理结果。
 */ async (env, message) => {
        /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const { ctx } = captureContext()
        await expect(mountAcpMcpServers(ctx, [{
          name: 'fixture', command: process.execPath, args: [], env: [...env],
        }], process.cwd())).rejects.toThrow(message)
      })

    it('rejects case-insensitive duplicate headers and malformed URLs', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const { ctx } = captureContext()
        await expect(mountAcpMcpServers(ctx, [{
          type: 'http',
          name: 'web',
          url: 'https://example.test/mcp',
          headers: [{ name: 'X-Key', value: 'one' }, { name: 'x-key', value: 'two' }],
        }], process.cwd())).rejects.toThrow(/duplicate name/)
        await expect(mountAcpMcpServers(ctx, [{
          type: 'http', name: 'web', url: 'not a URL', headers: [],
        }], process.cwd())).rejects.toThrow(/absolute HTTP/)
      })

    it('preserves legal names that collide with Object prototype setters', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx、configs 用于处理 ctx、configs 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { ctx, configs } = captureContext()

        await mountAcpMcpServers(ctx, [
          {
            name: 'stdio',
            command: process.execPath,
            args: [],
            env: [{ name: '__proto__', value: 'environment-value' }],
          },
          {
            type: 'http',
            name: 'http',
            url: 'https://example.test/mcp',
            headers: [{ name: '__proto__', value: 'header-value' }],
          },
        ], process.cwd())

        expect(configs[0]?.transport === 'stdio' && Object.hasOwn(configs[0].env, '__proto__')).toBe(true)
        expect(configs[0]?.transport === 'stdio' && configs[0].env['__proto__']).toBe('environment-value')
        expect(configs[1]?.transport === 'streamable-http' && Object.hasOwn(configs[1].headers, '__proto__')).toBe(true)
        expect(configs[1]?.transport === 'streamable-http' && configs[1].headers['__proto__']).toBe('header-value')
      })

    it('maps provider schema failures into the indexed declaration error', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const { ctx } = captureContext()
        /**
     * 常量说明：malformed 用于处理 malformed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const malformed = {
          name: 'fixture',
          command: process.execPath,
          args: 'not-an-array',
          env: [],
        } as unknown as McpServer

        await expect(mountAcpMcpServers(ctx, [malformed], process.cwd()))
          .rejects.toThrow(/mcpServers\[0\] is invalid/)
      })
  })
