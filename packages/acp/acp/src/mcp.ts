/** Standard ACP MCP-server declarations translated into Agent-scoped DSH MCP clients.
 * @remarks 文件说明：文件职责：实现 acp/acp 中 mcp 模块的职责，并向相邻模块提供可复用能力。；
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的 acp/acp 能力，
 * 使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import type { Context } from '@deepseek-ai/cordis'
import { createHash } from 'node:crypto'
import { validateHeaderName, validateHeaderValue } from 'node:http'
import { isAbsolute } from 'node:path'
import type { McpServer } from '@agentclientprotocol/sdk'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'

/**
 * 常量说明：VALID_SERVER_NAME 用于处理 VALID_SERVER_NAME 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const VALID_SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/

/** Caller-correctable MCP declaration failure.
 * @remarks 中文说明：类说明：AcpMcpConfigError 用于集中封装 处理 AcpMcpConfigError 相关状态与行为。；
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由 acp/acp 在对应插件或业务生命周期内创建和调用。 */
export class AcpMcpConfigError extends Error {
  /**
   * 功能说明：处理 AcpMcpConfigError 相关流程；使用场景由所在模块及调用位置决定。
   * @param message （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new AcpMcpConfigError(message) 创建实例，并在所属生命周期内使用。
   */
  constructor(message: string) {
    super(message)
    this.name = 'AcpMcpConfigError'
  }
}

/**
 * Validate and mount one session's complete standard MCP server list before Agent publication.
 * @param agentCtx - unpublished Agent scope that owns the MCP clients and tools.
 * @param servers - stable ACP stdio or HTTP server declarations.
 * @param sessionCwd - canonical primary workspace used by stdio servers.
 * @remarks 中文说明：功能说明：处理 mountAcpMcpServers 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：agentCtx（Context）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：servers（readonly McpServer[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：sessionCwd（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<void>；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * mountAcpMcpServers(agentCtx, servers, sessionCwd)，并按返回类型处理结果。
 */
export async function mountAcpMcpServers(
  agentCtx: Context,
  servers: readonly McpServer[],
  sessionCwd: string,
): Promise<void> {
  /**
   * 常量说明：configs 用于处理 configs 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const configs = resolveMcpConfigs(servers, sessionCwd)
  for (const /* 变量说明：config 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。 */ config of configs) await agentCtx.plugin(McpClient, config)
}

/** Convert the stable stdio/HTTP ACP transports and reject every other transport.
 * @remarks 中文说明：功能说明：解析 Mcp Configs 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：servers（readonly McpServer[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：sessionCwd（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：McpClient.Config[]；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * resolveMcpConfigs(servers, sessionCwd)，并按返回类型处理结果。 */
function resolveMcpConfigs(servers: readonly McpServer[], sessionCwd: string): McpClient.Config[] {
  /**
   * 常量说明：names 用于处理 names 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const names = new Set<string>()
  return servers.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：server（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：index（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(server, index)，并按返回类型处理结果。
 */ (server, index) => {
    /**
     * 常量说明：serverName 用于处理 serverName 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
      const serverName = normalizeServerName(server.name)
      if (names.has(serverName)) {
        throw new AcpMcpConfigError(`mcpServers contains duplicate normalized name: ${serverName}`)
      }
      names.add(serverName)
      if (!('type' in server)) {
        if (!isAbsolute(server.command)) {
          throw new AcpMcpConfigError(`mcpServers[${index}].command must be an absolute path`)
        }
        /**
       * 常量说明：env 用于处理 env 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
        const env = entriesToRecord(server.env, `mcpServers[${index}].env`, 'environment')
        /**
       * 常量说明：config 用于处理 config 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
        const config = validateClientConfig(index, /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => McpClient.Config({
            transport: 'stdio',
            serverName,
            command: server.command,
            args: server.args,
            env,
            cwd: sessionCwd,
            failOnStartupError: true,
          }))
        return { ...config, env }
      }
      if (server.type === 'http') {
        assertHttpUrl(server.url, `mcpServers[${index}].url`)
        /**
       * 常量说明：headers 用于处理 headers 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
        const headers = entriesToRecord(server.headers, `mcpServers[${index}].headers`, 'header')
        /**
       * 常量说明：config 用于处理 config 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
        const config = validateClientConfig(index, /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => McpClient.Config({
            transport: 'streamable-http',
            serverName,
            url: server.url,
            headers,
            failOnStartupError: true,
          }))
        return { ...config, headers }
      }
      throw new AcpMcpConfigError(`mcpServers[${index}] transport ${server.type} is not supported`)
    })
}

/** Convert ordered ACP name/value entries without silently accepting duplicate keys.
 * @remarks 中文说明：功能说明：处理 entriesToRecord 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：entries（readonly { name: string; value: string }[]）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；参数说明：field（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：kind（'environment' | 'header'）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：Record<string, string>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 entriesToRecord(entries, field, kind)，并按返回类型处理结果。 */
function entriesToRecord(
  entries: readonly { name: string; value: string }[],
  field: string,
  kind: 'environment' | 'header',
): Record<string, string> {
  // Valid environment and header names include "__proto__"; a null prototype
  // keeps that entry as data instead of invoking Object.prototype's setter.
  /**
   * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const result = Object.create(null) as Record<string, string>
  /**
   * 常量说明：names 用于处理 names 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const names = new Set<string>()
  for (const /* 变量说明：entry 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。 */ entry of entries) {
    if (kind === 'header') {
      try {
        validateHeaderName(entry.name)
        validateHeaderValue(entry.name, entry.value)
      } catch (/* 变量说明：_invalidHeader 保存当前捕获的异常；使用前应按项目约定缩小其类型。 */ _invalidHeader) {
        throw new AcpMcpConfigError(`${field} contains an invalid header entry`)
      }
    } else if (
      entry.name.length === 0
      || entry.name.includes('=')
      || entry.name.includes('\0')
      || entry.value.includes('\0')
    ) {
      throw new AcpMcpConfigError(`${field} contains an invalid environment entry`)
    }
    /**
     * 常量说明：identity 用于处理 identity 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const identity = kind === 'header' ? entry.name.toLowerCase() : entry.name
    if (names.has(identity)) throw new AcpMcpConfigError(`${field} contains duplicate name: ${entry.name}`)
    names.add(identity)
    result[entry.name] = entry.value
  }
  return result
}

/** Produce a stable DSH tool namespace from ACP's human-readable server name.
 * @remarks 中文说明：功能说明：规范化 Server Name 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：name（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 normalizeServerName(name)，并按返回类型处理结果。 */
function normalizeServerName(name: string): string {
  if (name.trim().length === 0 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new AcpMcpConfigError('mcpServers contains an invalid server name')
  }
  if (VALID_SERVER_NAME.test(name)) return name
  /**
   * 常量说明：slug 用于处理 slug 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const slug = name.normalize('NFKD')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 20) || 'server'
  /**
   * 常量说明：digest 用于处理 digest 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const digest = createHash('sha256').update(name).digest('hex').slice(0, 8)
  return `${slug}_${digest}`.slice(0, 32)
}

/** Require the stable Streamable HTTP transport URL schemes.
 * @remarks 中文说明：功能说明：断言 Http Url 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：field（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 assertHttpUrl(value, field)，
 * 并按返回类型处理结果。 */
function assertHttpUrl(value: string, field: string): void {
  try {
    /**
     * 常量说明：url 用于处理 url 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('unsupported protocol')
  } catch (/* 变量说明：_invalidUrl 保存当前捕获的异常；使用前应按项目约定缩小其类型。 */ _invalidUrl) {
    throw new AcpMcpConfigError(`${field} must be an absolute HTTP(S) URL`)
  }
}

/** Map the existing MCP provider's schema error into ACP invalid params.
 * @remarks 中文说明：功能说明：校验 Client Config 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：index（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：parse（() =>
 * McpClient.Config）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：McpClient.Config；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * validateClientConfig(index, parse)，并按返回类型处理结果。 */
function validateClientConfig(index: number, parse: () => McpClient.Config): McpClient.Config {
  try {
    return parse()
  } catch (/* 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。 */ error: unknown) {
    /* v8 ignore next -- Schemastery validation rejects with Error instances. */
    /**
     * 常量说明：detail 用于处理 detail 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const detail = error instanceof Error ? error.message : String(error)
    throw new AcpMcpConfigError(`mcpServers[${index}] is invalid: ${detail}`)
  }
}
