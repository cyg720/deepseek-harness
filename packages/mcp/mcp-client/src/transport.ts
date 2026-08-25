/**
 * Transport factory: creates the appropriate MCP transport based on the
 * plugin's resolved config. Stdio spawns a child process (with credential
 * scrubbing); Streamable HTTP connects to a URL.
 *
 * @module
 */
/*
 * 中文说明：
 * - 文件职责：根据已解析的 MCP 插件配置创建标准输入输出或可流式 HTTP 传输实例。
 * - 技术维度：使用 MCP TypeScript SDK、判别联合、URL 和子进程环境变量清理。
 * - 产品维度：让用户以本地命令或远程地址连接 MCP 工具服务，同时减少凭据意外继承。
 * - 逻辑维度：先合并安全父环境与显式环境，再按 transport 类型组装对应 SDK 传输。
 * - 关键边界：传入配置必须已经解析校验；stdio 会启动子进程，HTTP 类型转换仅处理 SDK 声明差异。
 * - 新手阅读建议：先看 Config 的两个分支，再比较各分支交给 SDK 的 command/env 与 URL/headers。
 */

import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import type { Config } from './index.ts'

/**
 * The subprocess seam's scrubbed parent env (credential-shaped and stale
 * `DSH_*` names dropped), plus the spec's explicit env. The MCP SDK owns the
 * actual spawn, so this transport shares the scrub definition rather than the
 * spawn path.
 */
/* 中文：构建子进程环境；extra 是用户显式变量，返回清理后的父环境与 extra 合并结果，后者同名时优先。 */
function buildChildEnv(extra: Record<string, string>): Record<string, string> {
  return { ...scrubbedParentEnv(), ...extra }
}

/**
 * Create an MCP transport from the resolved plugin config.
 *
 * @param config - Resolved plugin config discriminated on `transport`.
 * @returns A connected-ready MCP Transport (stdio or Streamable HTTP).
 */
/*
 * 中文：从 config 创建可连接的 MCP 传输；返回 stdio 或流式 HTTP 实例。示例：createTransport(resolvedConfig)。
 * @param config 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function createTransport(config: Config): Transport {
  switch (config.transport) {
    case 'stdio':
      return new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: buildChildEnv(config.env),
        cwd: config.cwd,
      })
    case 'streamable-http':
      // The MCP SDK's StreamableHTTPClientTransport has optional callback
      // properties typed without `| undefined` (exactOptionalPropertyTypes
      // mismatch with the Transport interface); the SDK constructed the
      // object, so the cast records only that widening.
      // 中文：SDK 的可选回调声明与 Transport 的精确可选属性规则不一致；该转换只放宽 SDK 自建对象的类型。
      return new StreamableHTTPClientTransport(
        new URL(config.url),
        { requestInit: { headers: config.headers } },
      ) as Transport
  }
}
