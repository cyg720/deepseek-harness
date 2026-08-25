/**
 * Tool bridge: discovers MCP tools, registers them on the harness ToolRuntime
 * under deterministic server-qualified public names, and handles re-sync when
 * the server's tool list changes.
 *
 * Naming contract (see the mcp-client Agent Note "Naming invariants"): every MCP tool
 * has the stable identity `(serverName, rawName)`; the model-facing public name
 * is `mcp__<serverName>__<rawName>`, normalized to the DeepSeek function-name
 * constraints. The raw name is only ever sent on the wire (`tools/call`); the
 * public name is never parsed to recover it.
 *
 * @module
 */
/*
 * 文件职责：实现 tools.ts 承担的MCP 客户端连接、工具映射与生命周期职责。
 * 技术维度：使用 TypeScript、Cordis 插件、MCP/JSON-RPC 协议和异步资源管理。
 * 产品维度：让 Agent 能发现并调用外部 MCP 服务器提供的工具。
 * 逻辑维度：建立连接，协商能力，映射远端工具，并将调用结果转换为 Harness 数据。
 * 关键边界：远端数据必须在协议入口校验；断线、取消和关闭必须释放资源。
 * 新手阅读建议：先看公开类型与配置，再读连接建立和工具映射，最后关注重连与清理。
 */

import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import { isImageAdmissionError } from '@deepseek-ai/dsh-attachment'
import type { AttachmentStore, ImageAttachmentRef, ImageMediaType, SaveImageAttachment } from '@deepseek-ai/dsh-attachment'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ToolDefinition, ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { assertSupportedJsonSchema } from '@deepseek-ai/dsh-tools'
import type { JsonSchemaNode, JsonValue } from '@deepseek-ai/dsh-tools'

/** Resolved options relevant to tool bridging. */
/* 中文说明：interface ToolBridgeOptions 定义本模块所需的数据或行为，用于表达当前协议场景。 */
export interface ToolBridgeOptions {
  /** Whether a registry conflict is contained or rejects this synchronization. */
  registrationFailure: 'contain' | 'throw'
  serverName: string
  toolCallTimeoutMs: number
}

/** State for one sync generation: the current set of disposers keyed by public name. */
/* 中文说明：type ToolDisposers 定义本模块所需的数据或行为，用于表达当前协议场景。 */
export type ToolDisposers = Map<string, () => void>

/** Canonical MCP result exposed to Code Mode without discarding protocol blocks. */
/* 中文说明：type McpResult 定义本模块所需的数据或行为，用于表达当前协议场景。 */
export type McpResult<Structured extends JsonValue = JsonValue> = {
  content: JsonValue[]
  structuredContent?: Structured
}

/**
 * DeepSeek function-name contract: at most 64 characters. Wire-protocol
 * constant, not configuration.
 */
/* 中文说明：常量 MAX_PUBLIC_NAME_LENGTH 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const MAX_PUBLIC_NAME_LENGTH = 64

/** DeepSeek function-name contract: only `[A-Za-z0-9_-]` is allowed. */
/* 中文说明：常量 INVALID_NAME_CHARS 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const INVALID_NAME_CHARS = /[^A-Za-z0-9_-]/g

/** Hex chars of the SHA-256 identity hash appended on lossy normalization. */
/* 中文说明：常量 HASH_LENGTH 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const HASH_LENGTH = 12

/** Raw result record: the bridge owns JSON-value validation after transport. */
/* 中文说明：变量 RawCallToolResultSchema 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const RawCallToolResultSchema = z.record(z.string(), z.unknown())

/** Raster formats supported by the durable attachment vocabulary. */
/* 中文说明：常量 IMAGE_MEDIA_TYPES 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const IMAGE_MEDIA_TYPES: readonly ImageMediaType[] = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]

/** Canonical RFC 4648 base64, excluding whitespace and URL-safe aliases. */
/* 中文说明：常量 CANONICAL_BASE64 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

/** List without mutating the SDK's per-page output-validator cache. */
/* 中文说明：函数 listToolsUncached 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function listToolsUncached(client: Client, cursor?: string) {
  return client.request(
    { method: 'tools/list', ...cursor === undefined ? {} : { params: { cursor } } },
    ListToolsResultSchema,
  )
}

/** Call without the SDK pre-validating an output schema the bridge may not support. */
/* 中文说明：函数 callToolUncached 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function callToolUncached(
  client: Client,
  rawName: string,
  args: Record<string, unknown>,
  exec: ToolExecution,
  opts: ToolBridgeOptions,
) {
  return client.request(
    { method: 'tools/call', params: { name: rawName, arguments: args } },
    RawCallToolResultSchema,
    {
      signal: exec.signal,
      timeout: opts.toolCallTimeoutMs,
    },
  )
}

/**
 * Derive the model-facing public name for one MCP tool.
 *
 * Deterministic pure function of `(serverName, rawName)`: the clean case is
 * `mcp__<serverName>__<rawName>` verbatim. When character replacement or
 * truncation to the DeepSeek function-name contract (64 chars,
 * `[A-Za-z0-9_-]`) changes the name, a 12-hex-char SHA-256 hash of the
 * identity is appended so distinct MCP identities never collapse into the
 * same public name.
 *
 * @param serverName - Stable local namespace from plugin config.
 * @param rawName - The MCP server's own tool name.
 * @returns The globally unique, model-facing ToolRuntime name.
 */
/*
 * 中文说明：函数 publicToolName 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param serverName 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param rawName 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function publicToolName(serverName: string, rawName: string): string {
  /** 中文说明：变量 joined 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const joined = `mcp__${serverName}__${rawName}`
  /** 中文说明：变量 normalized 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const normalized = joined.replace(INVALID_NAME_CHARS, '_')
  if (normalized === joined && normalized.length <= MAX_PUBLIC_NAME_LENGTH) return normalized
  /** 中文说明：变量 hash 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const hash = createHash('sha256').update(`${serverName}\0${rawName}`).digest('hex').slice(0, HASH_LENGTH)
  return `${normalized.slice(0, MAX_PUBLIC_NAME_LENGTH - HASH_LENGTH - 1)}_${hash}`
}

/**
 * Sync the MCP server's tool list into the harness ToolRuntime.
 *
 * Two phases keep the swap safe:
 *
 * 1. Fetch: drain uncached `tools/list` pagination and build the full next
 *    generation of `ToolDefinition`s under public names. Any failure here
 *    (network error, duplicate raw name in the server's list) rejects and
 *    leaves the previous generation registered untouched.
 * 2. Swap: dispose the previous generation, register the new one. A registry
 *    conflict here can only mean a foreign registration squats on this
 *    server's `mcp__<serverName>__` namespace — the partial generation is
 *    rolled back (zero tools from this server) and logged. Initial strict
 *    synchronization may propagate the conflict so its parent transaction
 *    rejects; ordinary clients and later re-syncs return an empty map.
 *
 * @param client - Connected MCP Client instance used to list and call tools.
 * @param ctx - Cordis context providing the `tools` service for registration.
 * @param opts - Bridge options: server namespace and per-call timeout.
 * @param previous - Disposer map from the prior sync generation; disposed
 *   during the swap phase (only after the fetch phase succeeded).
 * @returns A map of registered public tool names to their unregister
 *   disposers — the exact set of live registrations owned by this server.
 */
/*
 * 中文说明：函数 syncTools 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param client 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param ctx 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param opts 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param previous 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export async function syncTools(
  client: Client,
  ctx: Context,
  opts: ToolBridgeOptions,
  previous: ToolDisposers,
): Promise<ToolDisposers> {
  // Phase 1: fetch and build the next generation without touching the registry.
  /** 中文说明：变量 definitions 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const definitions = new Map<string, ToolDefinition>()
  /** 中文说明：变量 cursor 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let cursor: string | undefined
  do {
    /** 中文说明：变量 response 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const response = await listToolsUncached(client, cursor)
    /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
    for (const tool of response.tools) {
      /** 中文说明：变量 publicName 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const publicName = publicToolName(opts.serverName, tool.name)
      if (definitions.has(publicName)) {
        throw new Error(
          `mcp-client(${opts.serverName}): server listed tool "${tool.name}" more than once — invalid tool list`,
        )
      }
      definitions.set(publicName, createDefinition(
        client,
        ctx,
        publicName,
        tool.name,
        tool.description ?? '',
        tool.inputSchema,
        supportedOutputSchema(tool.outputSchema),
        tool.execution?.taskSupport === 'required',
        opts,
      ))
    }
    cursor = response.nextCursor
  } while (cursor)

  // Phase 2: swap generations.
  /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
  for (const dispose of previous.values()) dispose()
  /** 中文说明：变量 disposers 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const disposers: ToolDisposers = new Map()
  try {
    /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
    for (const [publicName, definition] of definitions) {
      disposers.set(publicName, ctx.tools.register(definition))
    }
  } catch (error) {
    // A conflict on an `mcp__<serverName>__`-qualified name means a foreign
    // registration occupies this server's namespace. Roll back so the model
    // sees either the full generation or none of it — never a partial set.
    /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
    for (const dispose of disposers.values()) dispose()
    ctx.logger.error(`mcp-client(${opts.serverName}): tool registration failed, no tools registered: ${String(error)}`)
    if (opts.registrationFailure === 'throw') throw error
    return new Map()
  }
  return disposers
}

/**
 * The shape we read from each MCP content block. Intentionally looser than the
 * SDK's `ContentBlock` type: we're at a network trust boundary (data arrives
 * from an external MCP server process via JSON-RPC), so fields that the SDK
 * declares required may be absent at runtime if the server is buggy.
 */
/* 中文说明：interface McpContentBlock 定义本模块所需的数据或行为，用于表达当前协议场景。 */
interface McpContentBlock {
  type: string
  text?: string
  mimeType?: string
  data?: string
  name?: string
  uri?: string
}

/** Async rich projection staged for one exact ToolRuntime execution. */
/* 中文说明：interface PreparedProjection 定义本模块所需的数据或行为，用于表达当前协议场景。 */
interface PreparedProjection {
  /** Canonical MCP value returned by execute before registry materialization. */
  value: McpResult
  /** Synchronous output.render projection expected before finalization. */
  fallback: ContentBlock[]
  /** Image-enriched or explicit-refusal projection prepared during execute. */
  content: ContentBlock[]
}

/** Keep a supported advertised schema; unsupported MCP vocabulary falls back to JsonValue. */
/* 中文说明：函数 supportedOutputSchema 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function supportedOutputSchema(candidate: unknown): JsonSchemaNode | undefined {
  if (candidate === undefined) return undefined
  try {
    assertSupportedJsonSchema(candidate)
    return candidate
  } catch {
    return undefined
  }
}

/**
 * Build one generation-local tool definition and its execution-local rich projections.
 * @param client - connected MCP client used for calls.
 * @param ctx - plugin context carrying optional attachment and model services.
 * @param publicName - registry-qualified public tool name.
 * @param rawName - MCP wire tool name.
 * @param description - model-facing tool description.
 * @param parameters - MCP input schema.
 * @param structuredSchema - supported structured-output schema, when advertised.
 * @param taskRequired - whether this MCP tool requires unsupported task execution.
 * @param opts - bridge timeout and namespace options.
 * @returns a complete ToolRuntime definition.
 */
/* 中文说明：函数 createDefinition 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function createDefinition(
  client: Client,
  ctx: Context,
  publicName: string,
  rawName: string,
  description: string,
  parameters: Record<string, unknown>,
  structuredSchema: JsonSchemaNode | undefined,
  taskRequired: boolean,
  opts: ToolBridgeOptions,
): ToolDefinition {
  /** 中文说明：变量 projections 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const projections = new WeakMap<ToolExecution, PreparedProjection>()
  return {
    name: publicName,
    description,
    parameters,
    output: createOutput(rawName, structuredSchema),
    execute: createExecutor(client, ctx, rawName, taskRequired, opts, projections),
    finalizeContent(exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>) {
      /** 中文说明：变量 projection 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const projection = projections.get(exec)
      if (projection === undefined) return undefined
      projections.delete(exec)
      if (result.isError) return undefined
      if (!isDeepStrictEqual(result.value, projection.value)) return undefined
      if (!isDeepStrictEqual(result.content, projection.fallback)) return undefined
      return projection.content
    },
  }
}

/** Build the canonical result schema and existing Native text projection. */
/* 中文说明：函数 createOutput 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function createOutput(rawName: string, structuredSchema: JsonSchemaNode | undefined): ToolDefinition['output'] {
  return {
    schema: {
      type: 'object',
      properties: {
        content: { type: 'array', items: {} },
        structuredContent: structuredSchema ?? {},
      },
      required: structuredSchema === undefined ? ['content'] : ['content', 'structuredContent'],
      additionalProperties: false,
    },
    render(_args: unknown, value: JsonValue) {
      /** 中文说明：变量 result 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const result = value as unknown as McpResult
      return [{ type: 'text', text: extractText(result.content, rawName) }]
    },
  }
}

/**
 * Create an execute function for one MCP tool. The executor closes over the
 * raw MCP tool name and sends an uncached `tools/call` request with it (never
 * the public name), with abort signal and timeout, then maps the result to
 * harness ContentBlocks. Owning the raw request prevents the SDK's internal
 * per-page schema cache from pre-validating a different contract.
 *
 * When the MCP server returns `isError: true`, the executor throws so that
 * the ToolRuntime's catch path produces an `isError` result for the model.
 */
/* 中文说明：函数 createExecutor 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function createExecutor(
  client: Client,
  ctx: Context,
  rawName: string,
  taskRequired: boolean,
  opts: ToolBridgeOptions,
  projections: WeakMap<ToolExecution, PreparedProjection>,
): ToolDefinition['execute'] {
  return async (args: unknown, exec: ToolExecution) => {
    if (taskRequired) {
      throw new Error(`Tool "${rawName}" requires task-based execution, which this bridge does not support`)
    }
    // The agent loop passes `JSON.parse(model_arguments)` which is usually an
    // object, but can be any JSON value if the model misbehaves (outputs a bare
    // string/number/null). Fallback to {} lets the MCP server produce a
    // specific "missing required param" error the model can learn from.
    /** 中文说明：变量 argsObj 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const argsObj = (typeof args === 'object' && args !== null ? args : {}) as Record<string, unknown>
    /** 中文说明：变量 result 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await callToolUncached(client, rawName, argsObj, exec, opts)

    // The SDK may return a legacy `toolResult` shape; normalize to content array.
    if (!Array.isArray(result.content)) {
      /** 中文说明：变量 rendered 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const rendered: unknown = 'toolResult' in result
        ? JSON.stringify(result.toolResult)
        : '(no output)'
      /** 中文说明：变量 text 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const text = typeof rendered === 'string' ? rendered : '(no output)'
      if (result.isError === true) throw new Error(text)
      return {
        content: [{ type: 'text', text }],
        ...result.structuredContent !== undefined
          ? { structuredContent: result.structuredContent as JsonValue }
          : {},
      }
    }

    // Trust boundary: the SDK's return type erases to `any[]` due to the
    // union of CallToolResult | CompatibilityCallToolResult; extractText
    // validates each element.
    /** 中文说明：变量 content 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const content = result.content as unknown as JsonValue[]
    /** 中文说明：变量 text 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const text = extractText(content, rawName)

    // MCP isError → throw so ToolRuntime produces an isError result for the model.
    if (result.isError === true) {
      throw new Error(text)
    }

    /** 中文说明：变量 value 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const value: McpResult = {
      content,
      ...result.structuredContent !== undefined
        ? { structuredContent: result.structuredContent as JsonValue }
        : {},
    }
    if (containsImage(content)) {
      /** 中文说明：变量 fallback 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const fallback: ContentBlock[] = [{ type: 'text', text: extractText(content, rawName) }]
      /** 中文说明：变量 projected 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const projected = await prepareImageProjection(ctx, exec, content, rawName)
      projections.set(exec, { value, fallback, content: projected })
    }
    return value
  }
}

/** Whether an untrusted MCP content array contains a declared image block. */
/* 中文说明：函数 containsImage 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function containsImage(content: JsonValue[]): boolean {
  return content.some(value => isRecord(value) && value.type === 'image')
}

/** Narrow one JSON value to a string-keyed object. */
/* 中文说明：函数 isRecord 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function isRecord(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Narrow a declared MIME string to the durable image vocabulary. */
/* 中文说明：函数 isImageMediaType 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function isImageMediaType(value: string): value is ImageMediaType {
  return IMAGE_MEDIA_TYPES.includes(value as ImageMediaType)
}

/** Decode one untrusted MCP image block without accepting base64 aliases. */
/* 中文说明：函数 decodeImage 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function decodeImage(block: McpContentBlock): SaveImageAttachment {
  if (block.mimeType === undefined || !isImageMediaType(block.mimeType)) {
    throw new Error('the declared media type is not PNG, JPEG, WebP, or GIF')
  }
  if (block.data === undefined || !CANONICAL_BASE64.test(block.data)) {
    throw new Error('the image data is not canonical base64')
  }
  /** 中文说明：变量 data 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const data = Buffer.from(block.data, 'base64')
  if (data.toString('base64') !== block.data) {
    throw new Error('the image data is not canonical base64')
  }
  return { data, mediaType: block.mimeType }
}

/**
 * Resolve the active model route and durable store for an image-bearing result.
 * @param ctx - plugin context with optional services.
 * @param exec - exact tool execution whose agent supplies the latest route.
 * @returns the attachment store after exact positive image-capability proof.
 */
/* 中文说明：函数 resolveImageAdmission 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
async function resolveImageAdmission(ctx: Context, exec: ToolExecution): Promise<AttachmentStore> {
  /** 中文说明：变量 attachments 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const attachments = ctx.get('attachments')
  if (attachments === undefined) throw new Error('no attachment store is mounted')
  /** 中文说明：变量 routed 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const routed = exec.agent?.session.requestHeader()?.config
  /** 中文说明：变量 provider 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const provider = routed?.provider ?? exec.agent?.options.provider
  /** 中文说明：变量 model 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const model = routed?.model ?? exec.agent?.options.model
  /** 中文说明：变量 llm 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const llm = ctx.get('llm')
  if (provider === undefined || model === undefined || llm === undefined) {
    throw new Error('the current model route could not be resolved')
  }
  /** 中文说明：变量 info 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let info: Awaited<ReturnType<typeof llm.resolveModelInfo>>
  try {
    info = await llm.resolveModelInfo(provider, model, exec.signal)
  } catch {
    throw new Error('the current model route could not be verified')
  }
  if (info.inputModalities === undefined || !info.inputModalities.includes('image')) {
    throw new Error(`model "${model}" does not declare image input`)
  }
  if (exec.signal.aborted) throw new Error('the tool call was canceled before image storage')
  return attachments
}

/** Stable diagnostic text for an image block that was not admitted. */
/* 中文说明：函数 imageDiagnostic 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function imageDiagnostic(block: McpContentBlock, reason: string): string {
  /** 中文说明：变量 mediaType 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const mediaType = block.mimeType ?? 'unknown media type'
  return `[image unavailable: ${mediaType}; ${reason}; raw image data remains available to programmatic callers]`
}

/**
 * Decode, preflight, and durably save one MCP result's ordered image batch.
 * Any refusal projects every image as text while retaining the canonical raw
 * value for programmatic callers.
 */
/* 中文说明：函数 prepareImageProjection 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
async function prepareImageProjection(
  ctx: Context,
  exec: ToolExecution,
  content: JsonValue[],
  toolName: string,
): Promise<ContentBlock[]> {
  /** 中文说明：变量 decoded 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const decoded: SaveImageAttachment[] = []
  /** 中文说明：变量 validationErrors 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const validationErrors = new Map<number, string>()
  /** 中文说明：变量 imageIndexes 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const imageIndexes: number[] = []
  /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
  for (const [index, value] of content.entries()) {
    if (!isRecord(value) || value.type !== 'image') continue
    imageIndexes.push(index)
    try {
      decoded.push(decodeImage(value as unknown as McpContentBlock))
    } catch (error: unknown) {
      // decodeImage owns every throw above and always produces Error.
      validationErrors.set(index, (error as Error).message)
    }
  }
  if (validationErrors.size > 0) {
    return projectContent(content, toolName, (block, index) => ({
      type: 'text',
      text: imageDiagnostic(
        block,
        validationErrors.get(index) ?? 'another image in the same result was invalid',
      ),
    }))
  }

  /** 中文说明：变量 attachments 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let attachments: AttachmentStore
  try {
    attachments = await resolveImageAdmission(ctx, exec)
  } catch (error: unknown) {
    // resolveImageAdmission contains provider failures and throws Error only.
    /** 中文说明：变量 reason 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const reason = (error as Error).message
    return projectContent(content, toolName, block => ({ type: 'text', text: imageDiagnostic(block, reason) }))
  }

  try {
    /** 中文说明：变量 refs 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const refs = await attachments.saveImages(decoded)
    /** 中文说明：函数值 byIndex 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
    const byIndex = new Map(imageIndexes.map((index, offset) => [index, refs[offset] as ImageAttachmentRef] as const))
    return projectContent(content, toolName, (_block, index) => ({
      type: 'image',
      attachment: byIndex.get(index) as ImageAttachmentRef,
    }))
  } catch (error: unknown) {
    /** 中文说明：变量 reason 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const reason = isImageAdmissionError(error)
      ? `image admission rejected the result: ${error.message}`
      : 'durable image storage rejected the result'
    return projectContent(content, toolName, block => ({
      type: 'text',
      text: imageDiagnostic(block, reason),
    }))
  }
}

/**
 * Extract text from an MCP content array into a single string.
 * - text blocks: join with '\n'
 * - image/audio/resource blocks: replaced with a placeholder
 *
 * Defensive: fields that the MCP spec declares required (mimeType, text) are
 * guarded with fallbacks because this is a network trust boundary.
 */
/* 中文说明：函数 extractText 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function extractText(mcpContent: JsonValue[], toolName: string): string {
  /** 中文说明：变量 content 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const content = projectContent(mcpContent, toolName)
  // The default image projector below also returns text, so this local call
  // cannot produce a core image block.
  return content.map(block => (block as Extract<ContentBlock, { type: 'text' }>).text).join('\n')
}

/**
 * Project ordered MCP blocks into the core content vocabulary.
 * Text-like runs are newline-coalesced; admitted images split those runs at
 * their original position.
 */
/* 中文说明：函数 projectContent 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function projectContent(
  mcpContent: JsonValue[],
  toolName: string,
  image: (block: McpContentBlock, index: number) => ContentBlock = block => ({
    type: 'text',
    text: imageDiagnostic(block, 'this result was not admitted to durable model context'),
  }),
): ContentBlock[] {
  /** 中文说明：变量 projected 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const projected: ContentBlock[] = []
  /** 中文说明：变量 text 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const text: string[] = []
  /** 中文说明：函数值 flushText 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const flushText = (): void => {
    if (text.length === 0) return
    projected.push({ type: 'text', text: text.splice(0).join('\n') })
  }

  /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
  for (const [index, value] of mcpContent.entries()) {
    if (!isRecord(value)) {
      text.push('[unsupported MCP content block: expected an object]')
      continue
    }
    /** 中文说明：变量 block 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const block = value as unknown as McpContentBlock
    switch (block.type) {
      case 'text':
        if (block.text !== undefined) text.push(block.text)
        break
      case 'image':
        flushText()
        projected.push(image(block, index))
        break
      case 'resource_link':
        if (block.name === undefined || block.uri === undefined) {
          text.push('[resource link unavailable: the MCP block is missing its name or URI]')
        } else {
          text.push(`Resource link: ${block.name} (${block.uri})`)
        }
        break
      case 'audio':
        text.push(`[audio result unsupported: ${block.mimeType ?? 'unknown media type'}; raw audio data remains available to programmatic callers]`)
        break
      case 'resource':
        text.push('[embedded resource unsupported; raw resource data remains available to programmatic callers]')
        break
      default:
        text.push(`[unsupported MCP content type: ${block.type}]`)
    }
  }
  flushText()
  return projected.length > 0
    ? projected
    : [{ type: 'text', text: `(${toolName} returned no model-visible content)` }]
}
