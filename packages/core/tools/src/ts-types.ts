/**
 * ================================ 文件注释 ================================
 * 【文件职责】Code Mode 的 TypeScript 代码生成：把注册工具的 schema 纯投影为模型
 *   编程所用的 TypeScript SDK 文本（即提示词里的 `tools:sdk` 段，含 `declare const
 *   tools` 声明）。
 * 【技术维度】两阶段渲染：先用 assertSupportedJsonSchema 校验 schema，再用显式帧栈
 *   （SchemaRenderFrame）遍历并组装"可拼接的类型文档"（TypeDocument），避免递归与
 *   深链字符串的平方级开销；非法/不支持输入降级为 `unknown` 而不抛错。
 * 【产品维度】在 code 模式下原生工具 schema 不随请求下发，这份生成文本是模型了解
 *   每个工具参数名、类型、必填性与返回形状的唯一来源。
 * 【逻辑维度】类型定义 → 键名/缩进/JSDoc 行等小工具函数 → 标量与字面量约束渲染 →
 *   类型文档结构及其展平 → 帧式 schema 遍历器 renderSupportedSchema → 导出入口
 *   jsonSchemaToTs 与整段 SDK 渲染器 renderToolsSdk。
 * 【关键边界】输出是确定性文本（工具按字典序输出），同集合必得逐字节相同结果；
 *   生成的 TS 只作提示词、不做类型检查，因此宽松优先于严格。
 * 【新手阅读建议】先读 jsonSchemaToTs 了解输入输出，再对照 renderSupportedSchema 的
 *   phase='start'/'children' 两阶段理解帧遍历；最后看 renderToolsSdk 如何拼装整段。
 * ==========================================================================
 */

/**
 * Code Mode codegen: the pure projection from registered tool schemas to the TypeScript SDK
 * text the model programs against (the `tools:sdk` prompt section). Sibling of
 * `json-schema.ts` — `schemas()` (native function calling) and this module (the generated
 * `declare const tools` API) are two projections of the same store.
 * @module @deepseek-ai/dsh-tools/src/ts-types
 */

import type { ToolSchema } from '@deepseek-ai/dsh-llm'
import { assertSupportedJsonSchema } from './json-schema.ts'
import type { JsonSchemaNode, JsonSchemaScalar } from './json-schema.ts'
/** Internal Code Mode projection: the model-facing schema plus the canonical output schema. */
/**
 * 【中文】Code Mode 内部使用的投影类型：在模型可见 schema 之上追加该工具的
 *   "规范输出 schema"（工具绑定返回的、已验证的规范值形状），供生成返回类型。
 */
export interface ToolSdkSchema extends ToolSchema {
  /** Validated canonical value returned by the tool binding. */
  /** 【中文】工具绑定返回的已验证规范值 schema。 */
  output: JsonSchemaNode
}

/** Property names that are valid bare TS identifiers; anything else is quoted. */
/**
 * 【中文】合法的裸 TypeScript 标识符模式（字母/下标/$ 开头）；不匹配的名字一律
 *   加引号输出，保证任何字段名都可达且不产生别名歧义。
 */
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/** Render an object key: bare when it is a valid identifier, quoted otherwise (every name stays reachable, no aliasing). */
/**
 * 【中文】渲染对象键：合法标识符直接裸写（如 `foo`），否则 JSON 引号包裹
 *   （如 `"my-tool"`）。
 */
function renderKey(name: string): string {
  return IDENTIFIER.test(name) ? name : JSON.stringify(name)
}

/** One `indent`-deep line prefix (two spaces per level). */
/**
 * 【中文】按层级缩进的前缀（每层两个空格）。
 */
function pad(indent: number): string {
  return '  '.repeat(indent)
}

/** A one-line JSDoc block for a schema `description`, or no lines when there is none. */
/**
 * 【中文】把 schema 的 description 折叠成单行 JSDoc；没有描述则不产生任何行。
 * @param description - 节点描述（任意值，非字符串按无处理）。
 * @param indent - 缩进层级。
 * @returns 仅含一行（或零行）的数组。
 */
function docLines(description: unknown, indent: number): string[] {
  if (typeof description !== 'string' || description.length === 0) return []
  // Collapse prose to stable one-line docs and escape comment closers so a
  // schema description cannot terminate generated JSDoc.
  // 【中文】空白折叠为稳定单行，并转义 `*/`——防止 schema 描述提前"闭合"生成的 JSDoc。
  const collapsed = description.replace(/\s+/g, ' ').trim()
  return [`${pad(indent)}/** ${collapsed.replaceAll('*/', String.raw`*\/`)} */`]
}

/** Render one scalar already validated by the unified schema boundary. */
/**
 * 【中文】渲染一个已通过统一校验的标量字面量：直接 JSON 序列化（字符串带引号）。
 */
function renderScalar(value: JsonSchemaScalar): string {
  return JSON.stringify(value)
}

/** Render a validated scalar `const`/`enum`, falling back to the broad type. */
/**
 * 【中文】渲染标量的字面量约束：const → 单一字面量；enum → `A | B | C`；
 *   都没有则回退宽类型（integer 映射为 number）。
 */
function renderConstrainedScalar(node: Record<string, unknown>, type: string): string {
  const broad = type === 'integer' ? 'number' : type
  if (Object.hasOwn(node, 'const')) return renderScalar(node.const as JsonSchemaScalar)
  if (Object.hasOwn(node, 'enum')) {
    return (node.enum as JsonSchemaScalar[]).map(renderScalar).join(' | ')
  }
  return broad
}

/** A composable type document that can be flattened without recursive string concatenation. */
/**
 * 【中文】可组合的"类型文档"：parts 是字符串与子文档的树，flatten 时才拼成最终文本。
 *   containsUnionOrIntersection 记录是否含 `|`/`&`，供数组项决定要不要加括号——
 *   `(A | B)[]` 与 `A & B[]` 的区别全靠它。用文档树替代递归字符串拼接，避免深
 *   schema 下的平方级开销。
 */
interface TypeDocument {
  readonly parts: readonly (string | TypeDocument)[]
  readonly containsUnionOrIntersection: boolean
}

/** Build one document from captured parts while retaining the legacy array-parenthesization test. */
/**
 * 【中文】由已捕获的部分构建文档，同时计算联合/交叉标记（含对子文档递归检查）。
 * @param parts - 字符串片段或子文档的有序列表。
 * @returns 组装好的文档节点。
 */
function typeDocumentFrom(parts: readonly (string | TypeDocument)[]): TypeDocument {
  return {
    parts,
    containsUnionOrIntersection: parts.some(part => typeof part === 'string'
      ? part.includes('|') || part.includes('&')
      : part.containsUnionOrIntersection),
  }
}

/** Build a small document without an intermediate array at each call site. */
/**
 * 【中文】便捷构造：可变参数版 typeDocumentFrom，省去调用点的临时数组。
 */
function typeDocument(...parts: (string | TypeDocument)[]): TypeDocument {
  return typeDocumentFrom(parts)
}

/** Flatten a nested document with an explicit work stack. */
/**
 * 【中文】用显式工作栈展平嵌套文档为最终字符串：子文档逆序压栈保证顺序，
 *   字符串直接入 chunks，最后拼接。全程无递归。
 */
function flattenTypeDocument(document: TypeDocument): string {
  // 【中文】chunks 收集最终片段；tasks 是待处理工作栈（字符串或子文档）。
  const chunks: string[] = []
  const tasks: (string | TypeDocument)[] = [document]
  for (let task = tasks.pop(); task !== undefined; task = tasks.pop()) {
    if (typeof task === 'string') {
      chunks.push(task)
      continue
    }
    for (let index = task.parts.length - 1; index >= 0; index--) {
      const part = task.parts[index]
      /* v8 ignore next -- the loop is bounded by the captured part count. */
      if (part !== undefined) tasks.push(part)
    }
  }
  return chunks.join('')
}

/** One explicit call frame for stack-safe schema-to-TypeScript rendering. */
/**
 * 【中文】schema→TS 渲染的显式调用帧：替代递归调用栈。phase='start' 时按节点类型
 *   分派（oneOf/array/object 各自调度子帧），phase='children' 时聚合子文档——
 *   oneOf 用 ` | ` 连接、数组按需加括号、对象逐属性装配并处理开放性。
 */
interface SchemaRenderFrame {
  readonly node: JsonSchemaNode
  readonly indent: number
  phase: 'start' | 'children'
  kind?: 'oneOf' | 'array' | 'object'
  children: { node: JsonSchemaNode; indent: number }[]
  childIndex: number
  childDocuments: TypeDocument[]
  entries: [string, JsonSchemaNode][]
}

/** Initialize one schema-render frame with empty aggregation state. */
/**
 * 【中文】构造一个空白渲染帧（聚合状态全部归零）。
 */
function schemaRenderFrame(node: JsonSchemaNode, indent: number): SchemaRenderFrame {
  return { node, indent, phase: 'start', children: [], childIndex: 0, childDocuments: [], entries: [] }
}

/** Render an already asserted schema to a composable document. */
/**
 * 【中文】帧式渲染内核：输入已通过 assertSupportedJsonSchema 的 schema，输出可展平
 *   的类型文档。oneOf → `A | B`；数组 → `T[]`（联合/交叉加括号）；对象 → 多行
 *   字面量（必填无 `?`），additionalProperties 非 false 时追加
 *   `& Record<string, JsonValue>` 表示开放；无类型节点 → `JsonValue`。
 */
function renderSupportedSchema(schema: JsonSchemaNode, indent: number): TypeDocument {
  // 【中文】显式帧栈；rootDocument 接住根帧完成时的文档。
  const frames: SchemaRenderFrame[] = [schemaRenderFrame(schema, indent)]
  let rootDocument: TypeDocument | undefined
  const finish = (document: TypeDocument): void => {
    frames.pop()
    const parent = frames.at(-1)
    if (parent === undefined) rootDocument = document
    else parent.childDocuments.push(document)
  }

  while (frames.length > 0) {
    const frame = frames.at(-1)
    /* v8 ignore next -- the loop condition guarantees a current frame. */
    if (frame === undefined) break
    if (frame.phase === 'children') {
      if (frame.childIndex < frame.children.length) {
        const child = frame.children[frame.childIndex]
        /* v8 ignore next -- childIndex is bounded by children.length. */
        if (child === undefined) throw new Error('missing schema render child')
        frame.childIndex++
        frames.push(schemaRenderFrame(child.node, child.indent))
        continue
      }
      if (frame.kind === 'oneOf') {
        const parts: (string | TypeDocument)[] = []
        for (let index = 0; index < frame.childDocuments.length; index++) {
          if (index > 0) parts.push(' | ')
          const child = frame.childDocuments[index]
          /* v8 ignore next -- child documents correspond one-to-one with children. */
          if (child !== undefined) parts.push(child)
        }
        finish(typeDocumentFrom(parts))
        continue
      }
      if (frame.kind === 'array') {
        const child = frame.childDocuments[0]
        /* v8 ignore next -- array frames always schedule exactly one child. */
        if (child === undefined) throw new Error('missing array item type')
        finish(child.containsUnionOrIntersection
          ? typeDocument('(', child, ')[]')
          : typeDocument(child, '[]'))
        continue
      }

      const required = new Set(frame.node.required)
      const parts: (string | TypeDocument)[] = ['{']
      for (let index = 0; index < frame.entries.length; index++) {
        const entry = frame.entries[index]
        const child = frame.childDocuments[index]
        /* v8 ignore next -- object entries and child documents have the same length. */
        if (entry === undefined || child === undefined) throw new Error('missing object property type')
        const [name, prop] = entry
        for (const line of docLines(prop.description, frame.indent + 1)) parts.push('\n', line)
        parts.push('\n', `${pad(frame.indent + 1)}${renderKey(name)}${required.has(name) ? '' : '?'}: `, child, ';')
      }
      parts.push('\n', `${pad(frame.indent)}}`)
      const declared = typeDocumentFrom(parts)
      finish(frame.node.additionalProperties === false
        ? declared
        : typeDocument(declared, ' & Record<string, JsonValue>'))
      continue
    }

    const node = frame.node
    if (node.oneOf !== undefined) {
      frame.kind = 'oneOf'
      frame.children = Array.from(node.oneOf, child => ({ node: child, indent: frame.indent }))
      frame.childIndex = 0
      frame.childDocuments = []
      frame.phase = 'children'
      continue
    }
    if (node.type === undefined) {
      finish(typeDocument('JsonValue'))
      continue
    }
    switch (node.type) {
      case 'string':
      case 'number':
      case 'integer':
      case 'boolean':
      case 'null':
        finish(typeDocument(renderConstrainedScalar(node as Record<string, unknown>, node.type)))
        break
      case 'array':
        if (node.items === undefined) {
          finish(typeDocument('JsonValue[]'))
        } else {
          frame.kind = 'array'
          frame.children = [{ node: node.items, indent: frame.indent }]
          frame.childIndex = 0
          frame.childDocuments = []
          frame.phase = 'children'
        }
        break
      case 'object': {
        const open = node.additionalProperties !== false
        const entries = Object.entries(node.properties ?? {})
        if (entries.length === 0) {
          finish(typeDocument(open ? 'Record<string, JsonValue>' : 'Record<string, never>'))
        } else {
          frame.kind = 'object'
          frame.entries = entries
          frame.children = entries.map(([, child]) => ({ node: child, indent: frame.indent + 1 }))
          frame.childIndex = 0
          frame.childDocuments = []
          frame.phase = 'children'
        }
        break
      }
      /* v8 ignore next -- assertSupportedJsonSchema narrowed this closed type union. */
      default:
        finish(typeDocument('unknown'))
    }
  }

  /* v8 ignore next -- every root frame produces one document. */
  return rootDocument ?? typeDocument('unknown')
}

/**
 * Map one enforced JSON-Schema node to a TypeScript type literal. Supports
 * every unified schema construct and returns `unknown` for malformed or
 * unsupported inputs without throwing.
 * @param schema - the JSON-Schema node (any shape; hostile inputs degrade).
 * @param indent - the indentation level for nested object members.
 * @returns the TS type text (multi-line for objects with properties).
 */
/**
 * 【中文】导出入口：把一个 JSON-Schema 节点映射为 TypeScript 类型字面量。支持统一
 *   schema 的全部构造；任何畸形/不支持的输入都降级为 `unknown` 而不抛错——生成
 *   的是提示词文本，宁可宽不可崩。
 * @param schema - 任意形状的 JSON-Schema 节点（敌意输入安全降级）。
 * @param indent - 嵌套对象成员的缩进层级。
 * @returns TypeScript 类型文本（含属性的对象为多行）。
 */
export function jsonSchemaToTs(schema: unknown, indent = 0): string {
  try {
    assertSupportedJsonSchema(schema)
    return flattenTypeDocument(renderSupportedSchema(schema, indent))
  } catch {
    return 'unknown'
  }
}

/** The fixed model-facing usage contract rendered above the declarations (see the Code Mode Agent Note's "What the model sees"). */
/**
 * 【中文】固定不变的模型侧使用说明，渲染在类型声明之前：run_code 的两个必填参数、
 *   tools.name(args) 调用方式、ToolCallError 的 try/catch、Promise.all 的并发规则、
 *   以及"只有 print/return 的内容才算程序输出"的策展要求。文本逐字固定（模型可见
 *   文本需快照钉住），不要随意改动措辞。
 */
const SDK_INSTRUCTIONS = `## Writing code for run_code

\`run_code\` takes two required arguments: \`code\` — the body of an async TypeScript function (erasable syntax only — no \`enum\` or namespaces; type annotations are advisory, the code runs type-stripped) — and \`description\`, a short summary of what the program does. Inside the program:

- Call tools as \`await tools.name(args)\` — quoted access for exotic names: \`tools["my-tool"](args)\`. Every call resolves to the tool's typed canonical JSON value. Tool arguments must be lossless JSON.
- A FAILED tool call rejects with \`ToolCallError\`, whose \`toolName\` identifies the failed tool and whose \`message\` is human-readable — \`try/catch\` it to handle and continue.
- Independent read-only calls MAY overlap under \`Promise.all\` (safe calls run concurrently; mutating calls run alone, in submission order). Sequence dependent work with \`await\`.
- Emit results with \`return\` and/or \`console.log(...)\`. Only what you print or return is program output. A successful tool result containing an image is attached after the run so you can inspect it on the next step; every other intermediate result stays out of the conversation, so extract just what you need.

The available tools:`

/**
 * Render the full `tools:sdk` prompt section: the fixed usage instructions
 * plus one `declare const tools` interface covering every given tool.
 * Deterministic — tools are emitted in lexicographic name order, so an
 * unchanged tool set produces byte-identical text across assemblies. The sort
 * is not a total order on byte-equal names, so two schemas sharing a name
 * would render in argument order; the caller's visible-capability map is keyed
 * by name, so the input never carries a duplicate.
 * @param schemas - the tool schemas to declare (the caller excludes
 *   `run_code` itself).
 * @returns the complete section text.
 */
export function renderToolsSdk(schemas: ToolSdkSchema[]): string {
  // 【中文】按名字典序排序保证输出确定性：同一工具集合永远生成逐字节相同的文本。
  const sorted = [...schemas].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  // 【中文】ToolArgsMap / ToolOutputMap 两个接口的成员行：每个工具一行参数类型 + 一行输出类型。
  const argsMembers: string[] = []
  const outputMembers: string[] = []
  for (const schema of sorted) {
    argsMembers.push(...docLines(schema.description, 1))
    argsMembers.push(`${pad(1)}${renderKey(schema.name)}: ${jsonSchemaToTs(schema.parameters, 1)};`)
    outputMembers.push(`${pad(1)}${renderKey(schema.name)}: ${jsonSchemaToTs(schema.output, 1)};`)
  }
  // 【中文】两个映射接口：参数映射 + 输出映射；空集合时输出空接口体。
  const argsMap = `interface ToolArgsMap {${argsMembers.length > 0 ? `\n${argsMembers.join('\n')}\n` : ''}}`
  const outputMap = `interface ToolOutputMap {${outputMembers.length > 0 ? `\n${outputMembers.join('\n')}\n` : ''}}`
  // 【中文】核心声明块：工具名联合、ToolCallError 错误类、以及把每个名字映射为
  //   `(args) => Promise<输出>` 的 tools 单例。
  const declaration = [
    argsMap,
    outputMap,
    'type ToolName = keyof ToolOutputMap',
    ['declare class ToolCallError extends Error {', '  readonly name: "ToolCallError";', '  readonly toolName: ToolName;', '}'].join('\n'),
    ['declare const tools: {', '  [K in ToolName]: (args: ToolArgsMap[K]) => Promise<ToolOutputMap[K]>;', '}'].join('\n'),
  ].join('\n\n')
  const jsonValue = 'type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }'
  return `${SDK_INSTRUCTIONS}\n\n\`\`\`ts\n${jsonValue}\n\n${declaration}\n\`\`\``
}
