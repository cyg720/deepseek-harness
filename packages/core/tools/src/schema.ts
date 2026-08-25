/*
 * ================================ 文件注释 ================================
 * 【文件职责】定义工具作者使用的"统一 JSON 值模式 DSL"（ValueSchemaSpec 系列）：
 *   提供编译到 json-schema.ts 受控子集的投影、编译期 TypeScript 类型推断，以及
 *   首方工具定义助手 defineTool。
 * 【技术维度】三层：① 作者 DSL（带 required: true 注解、强制显式 additionalProperties、
 *   type: 'json' 透传）；② 纯类型层——条件类型递归推断参数/输出值类型（深度上限
 *   16 层后回退 JsonValue）；③ 运行时编译器——显式栈遍历把 DSL 编译为原始 JSON
 *   Schema 并再次断言子集合法。defineTool 在 execute 前自动校验参数。
 * 【产品维度】让工具作者用一份声明同时获得：模型可见的参数 schema、编译期类型检查、
 *   运行时参数校验与输出契约——写一次，三处受益。
 * 【逻辑维度】先声明各类型的 Spec 接口与联合 → 类型推断辅助（InferValue 等）→
 *   运行时编译器任务类型与执行器 → 两个导出投影函数 → validateArgs 与错误类 →
 *   DefineToolOptions + defineTool 组装最终 ToolDefinition。
 * 【关键边界】DSL 关键字白名单严格（多余键直接报错）；对象节点必须显式声明
 *   additionalProperties；presentCall/presentResult 走软校验（失败回退 undefined，
 *   不抛错），execute 走硬校验（抛 ToolArgsError）。
 * 【新手阅读建议】先看 ValueSchemaSpec 联合与 ParameterSchemaSpec 的"隐式对象根"
 *   设计，再读 defineTool 的组装过程；类型推断部分可跳过不影响使用。
 * ==========================================================================
 */

/** Unified JSON-value schema DSL, inference, compilation, and typed tool helper. @module dsh-tools/schema */

import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import type { ToolDefinition, ToolExecution, ToolExecutionResult, ToolRunContext, ToolResult } from './index.ts'
import { assertSupportedJsonSchema, isJsonSchemaRecord, isPlainJsonArray, JsonSchemaError, validateJsonSchemaValue } from './json-schema.ts'
import type { JsonSchemaNode, JsonSchemaScalar, ObjectJsonSchema } from './json-schema.ts'
import type { ToolCallView, ToolResultView } from './presentation.ts'

/** Annotation keywords shared by every author-facing schema node. */
/*
 * 【中文】所有作者侧 schema 节点共享的"注解"字段：不参与校验，但会投影进 JSON
 *   Schema 与 Code Mode 生成的类型文档，供模型与 UI 阅读。
 */
export interface ValueSchemaAnnotations {
  /** Human-readable description projected into JSON Schema and generated types. */
  /* 【中文】人类可读描述；模型主要靠它理解参数含义。 */
  description?: string
  /** Human-readable title projected into JSON Schema. */
  /* 【中文】人类可读标题。 */
  title?: string
  /** Non-validating default annotation; it must be lossless JSON data. */
  /* 【中文】默认值注解（不参与校验）；必须是无损 JSON 数据。 */
  default?: JsonValue
  /** Non-validating examples annotation; it must be lossless JSON data. */
  /* 【中文】示例注解（不参与校验）；必须是无损 JSON 数据。 */
  examples?: JsonValue
}

/** String value schema with type-correct literal constraints. */
/*
 * 【中文】字符串值模式：enum/const 的元素类型被约束为 string，写错在编译期即报错。
 */
export interface StringValueSchemaSpec extends ValueSchemaAnnotations {
  type: 'string'
  enum?: readonly string[]
  const?: string
}

/** Finite JSON-number schema with type-correct literal constraints. */
/*
 * 【中文】数字值模式（有限 JSON 数）；字面量约束类型为 number。
 */
export interface NumberValueSchemaSpec extends ValueSchemaAnnotations {
  type: 'number'
  enum?: readonly number[]
  const?: number
}

/** Integer schema with type-correct literal constraints. */
/*
 * 【中文】整数值模式；校验时额外要求值为整数。
 */
export interface IntegerValueSchemaSpec extends ValueSchemaAnnotations {
  type: 'integer'
  enum?: readonly number[]
  const?: number
}

/** Boolean value schema with type-correct literal constraints. */
/*
 * 【中文】布尔值模式。
 */
export interface BooleanValueSchemaSpec extends ValueSchemaAnnotations {
  type: 'boolean'
  enum?: readonly boolean[]
  const?: boolean
}

/** Null value schema with type-correct literal constraints. */
/*
 * 【中文】null 值模式：只接受 null。
 */
export interface NullValueSchemaSpec extends ValueSchemaAnnotations {
  type: 'null'
  enum?: readonly null[]
  const?: null
}

/** Array value schema; omitted `items` accepts any lossless JSON item. */
/*
 * 【中文】数组值模式；省略 items 表示接受任意无损 JSON 元素。
 */
export interface ArrayValueSchemaSpec extends ValueSchemaAnnotations {
  type: 'array'
  items?: ValueSchemaSpec
}

/**
 * Explicit object value schema. Openness is mandatory so a nested or output
 * object never acquires an accidental JSON Schema default.
 */
/*
 * 【中文】显式对象值模式。additionalProperties 必填——强制作者想清楚开放/封闭，
 *   避免嵌套对象或输出对象意外继承 JSON Schema 的"默认开放"。
 */
export interface ObjectValueSchemaSpec extends ValueSchemaAnnotations {
  type: 'object'
  /** 属性名 → 各属性的值模式；required: true 标注必填。 */
  properties?: ParameterSchemaSpec
  /** 必须显式写 true（接受额外键）或 false（拒绝额外键）。 */
  additionalProperties: boolean
}

/** Author-only unconstrained lossless JSON node. */
/*
 * 【中文】`type: 'json'`：作者专用的"任意无损 JSON 值"。编译时变成只带注解的
 *   节点（即 json-schema 子集里的无约束形式），不会出现在作者 DSL 之外。
 */
export interface JsonValueSchemaSpec extends ValueSchemaAnnotations {
  type: 'json'
}

/** Exact-one union schema; at least two branches are required. */
/*
 * 【中文】"恰好一个分支通过"的联合模式；元组类型保证至少两个分支。
 */
export interface OneOfValueSchemaSpec extends ValueSchemaAnnotations {
  oneOf: readonly [ValueSchemaSpec, ValueSchemaSpec, ...ValueSchemaSpec[]]
}

/** One author-facing schema for any lossless JSON value root. */
/*
 * 【中文】作者侧值模式的总联合：任何无损 JSON 值根都从这九种里选一种表达。
 */
export type ValueSchemaSpec =
  | StringValueSchemaSpec
  | NumberValueSchemaSpec
  | IntegerValueSchemaSpec
  | BooleanValueSchemaSpec
  | NullValueSchemaSpec
  | ArrayValueSchemaSpec
  | ObjectValueSchemaSpec
  | JsonValueSchemaSpec
  | OneOfValueSchemaSpec

/** One implicit parameter-root property, optionally required. */
/*
 * 【中文】参数映射里的单个属性：在值模式之上追加 `required?: true` 注解——这是
 *   DSL 表达"必填"的唯一方式（参数根自身是隐式对象，没有独立 required 列表）。
 */
export type ParameterPropertySpec = ValueSchemaSpec & { required?: true }

/**
 * Tool parameter schema. The map itself is an implicit open object root;
 * requiredness remains a per-property `required: true` annotation.
 */
/*
 * 【中文】工具参数 schema：整个映射就是一个"隐式的开放对象根"——作者直接写
 *   属性名即可，不必再包一层 `{ type: 'object', properties: … }`。必填性仍由每个
 *   属性自己的 `required: true` 表达。symbol 键被类型层直接排除。
 */
export type ParameterSchemaSpec = {
  [key: string]: ParameterPropertySpec
  [key: symbol]: never
}

/** Raw JSON Schema projection of the implicit parameter object. */
/*
 * 【中文】隐式参数对象编译后的原始 JSON Schema：保证是对象根且 properties 必在。
 */
export interface ParameterJsonSchema extends ObjectJsonSchema {
  properties: Record<string, JsonSchemaNode>
}

/** Flatten an intersection into one object type for readable hovers. */
/*
 * 【中文】把交叉类型摊平成单一对象类型——纯为了 IDE 悬停提示可读，不影响行为。
 */
type Simplify<T> = { [K in keyof T]: T[K] } & {}

/** String keys of one property map; runtime compilation rejects symbol keys. */
/*
 * 【中文】取属性映射的字符串键；symbol 键在运行时编译中会被拒绝。
 */
type StringKeyOf<S> = Extract<keyof S, string>

/** Keys of a property map marked `required: true`. */
/*
 * 【中文】筛出标记了 `required: true` 的属性键集合（映射类型 + 索引访问的惯用法）。
 */
type RequiredKeys<S> = {
  [K in StringKeyOf<S>]: S[K] extends { required: true } ? K : never
}[StringKeyOf<S>]

/** Infer the declared value of one parameter property without key optionality. */
/*
 * 【中文】推断单个属性声明的值类型（键的可选性由上层处理）；Depth 用于限制递归深度。
 */
type InferProperty<P, Depth extends unknown[]> = InferValueAt<P, Depth>

/** Infer an implicit property map into required and optional object keys. */
/*
 * 【中文】把隐式属性映射推断为 TypeScript 对象类型：required: true 的键必有值，
 *   其余键可选。
 */
type InferProperties<S, Depth extends unknown[]> = Simplify<
  & { [K in RequiredKeys<S>]: InferProperty<S[K], Depth> }
  & { [K in Exclude<StringKeyOf<S>, RequiredKeys<S>>]?: InferProperty<S[K], Depth> }
>

/** Infer an explicit object node, including its declared openness. */
/*
 * 【中文】推断显式对象节点：有 properties 时按属性映射推断；additionalProperties:
 *   true 额外并入 `Record<string, JsonValue>` 表示开放；封闭且无属性则得到
 *   `Record<string, never>`（不接受任何键）。
 */
type InferObject<S extends { additionalProperties: boolean }, Depth extends unknown[]> =
  S extends { properties: infer P }
    ? S['additionalProperties'] extends true
      ? InferProperties<P, Depth> & Record<string, JsonValue>
      : InferProperties<P, Depth>
    : S['additionalProperties'] extends true
      ? Record<string, JsonValue>
      : Record<string, never>

/** Infer a scalar node's literal constraint before its broad primitive type. */
/*
 * 【中文】标量推断优先取字面量约束：const 精确到单值，enum 取其联合，否则回退到
 *   宽泛的基本类型。
 */
type InferScalar<S, Fallback> =
  S extends { const: infer C } ? C :
    S extends { enum: readonly (infer E)[] } ? E :
      Fallback

/** Add one schema-container level to bounded compile-time inference. */
/*
 * 【中文】递归深度 +1：用元组长度计数容器层级，是 TypeScript 里给递归加界的惯用法。
 */
type NextInferenceDepth<Depth extends unknown[]> = [unknown, ...Depth]

/** Infer one node without recursively checking it against the full author union. */
type InferValueAt<S, Depth extends unknown[]> =
  Depth['length'] extends 16 ? JsonValue :
    S extends { type: 'string' } ? InferScalar<S, string> :
      S extends { type: 'number' | 'integer' } ? InferScalar<S, number> :
        S extends { type: 'boolean' } ? InferScalar<S, boolean> :
          S extends { type: 'null' } ? null :
            S extends { type: 'array' }
              ? S extends { items: infer I } ? InferValueAt<I, NextInferenceDepth<Depth>>[] : JsonValue[]
              : S extends { type: 'object'; additionalProperties: boolean }
                ? InferObject<S, NextInferenceDepth<Depth>>
                : S extends { type: 'json' } ? JsonValue :
                  S extends { oneOf: readonly unknown[] }
                    ? InferValueAt<S['oneOf'][number], NextInferenceDepth<Depth>>
                    : never

/**
 * Infer the TypeScript value accepted by an author-facing value schema. Exact
 * inference is bounded to 16 container levels, then falls back to `JsonValue`.
 */
/*
 * 【中文】对外导出：推断某个值模式对应的 TypeScript 值类型。精确推断最多下钻
 *   16 层容器，之后整体回退为 JsonValue，防止编译器递归爆炸。
 */
export type InferValue<S> = InferValueAt<S, []>

/** Infer the TypeScript argument object for an implicit parameter schema. */
/*
 * 【中文】对外导出：推断隐式参数 schema 对应的实参对象类型（defineTool 的 execute
 *   等回调据此获得类型化参数）。
 */
export type InferArgs<S> = InferProperties<S, []>

// 【中文】注解键白名单：编译时允许原样拷贝到原始 schema 的字段。
const ANNOTATION_KEYS = ['description', 'title', 'default', 'examples'] as const

/** Throw one author-schema violation through the shared schema error type. */
/*
 * 【中文】抛出一条作者 schema 违规（复用 JsonSchemaError，错误码统一）。
 */
function authorError(message: string): never {
  throw new JsonSchemaError([message])
}

/** Copy own annotation fields for validation by the raw-schema boundary. */
/*
 * 【中文】把节点上实际存在的注解字段拷到编译产物上；随后由原始 schema 边界
 *   （assertSupportedJsonSchema）校验它们的值合法性。
 */
function copyAnnotations(source: Record<string, unknown>, target: JsonSchemaNode): void {
  if (Object.hasOwn(source, 'description')) target.description = source.description as string
  if (Object.hasOwn(source, 'title')) target.title = source.title as string
  if (Object.hasOwn(source, 'default')) target.default = source.default as JsonValue
  if (Object.hasOwn(source, 'examples')) target.examples = source.examples as JsonValue
}

/** Reject author-only keys outside one node's declared vocabulary. */
/*
 * 【中文】DSL 关键字白名单检查：节点上出现任何不在 allowed 列表里的键立即报错。
 *   这是"误配置大声失败"原则的体现——拼错的字段不会被静默忽略。
 */
function assertAuthorKeys(source: Record<string, unknown>, path: string, allowed: readonly string[]): void {
  for (const key of Object.keys(source)) {
    if (!allowed.includes(key)) authorError(`${path}.${key} is not supported by the value schema DSL`)
  }
}

/** Compiled form of one implicit property map. */
/*
 * 【中文】隐式属性映射的编译产物：属性 schema 表 + 可选的必填名列表。
 */
interface CompiledPropertyMap {
  properties: Record<string, JsonSchemaNode>
  required?: string[]
}

/** Mutable holder used only while an iterative compilation root is unresolved. */
/*
 * 【中文】迭代编译时的"根占位符"：栈式任务先拿到 destination 再异步写入结果，
 *   用一个可变单字段对象把"尚未确定的根"传下去。
 */
interface CompileRoot<T> {
  value?: T
}

/** Where one compiled value node is installed. */
/*
 * 【中文】一个编译好的值节点的落点：根占位、父对象的某个属性、数组的 items 槽位，
 *   或 oneOf 分支数组的某个下标。
 */
type NodeDestination =
  | { kind: 'root'; holder: CompileRoot<JsonSchemaNode> }
  | { kind: 'property'; target: Record<string, JsonSchemaNode>; key: string }
  | { kind: 'item'; target: JsonSchemaNode }
  | { kind: 'one-of'; target: JsonSchemaNode[]; index: number }

/** Where one compiled property map is installed. */
/*
 * 【中文】一个编译好的属性映射的落点：要么是编译根，要么挂进某个对象节点的
 *   properties。
 */
type PropertyMapDestination =
  | { kind: 'root'; holder: CompileRoot<CompiledPropertyMap> }
  | { kind: 'object'; target: JsonSchemaNode }

/** Deferred work for stack-safe author-schema compilation. */
/*
 * 【中文】编译器任务类型：value（编译单个值节点）、property-map / property /
 *   property-map-tail（处理隐式属性映射及其属性、收尾装配 required）、leave
 *   （退出并解除环检测标记）。全部走显式栈，深 schema 不会递归溢出。
 */
type CompileTask =
  | { kind: 'value'; input: unknown; path: string; allowRequired: boolean; destination: NodeDestination }
  | { kind: 'property-map'; input: unknown; path: string; destination: PropertyMapDestination }
  | {
    kind: 'property'
    property: unknown
    path: string
    key: string
    properties: Record<string, JsonSchemaNode>
    required: string[]
  }
  | {
    kind: 'property-map-tail'
    compiled: CompiledPropertyMap
    required: string[]
    destination: PropertyMapDestination
  }
  | { kind: 'leave'; input: object }

/** Install a compiled node without giving `__proto__` assignment semantics. */
/*
 * 【中文】把编译好的节点安装到目标位置。属性落点刻意用 Object.defineProperty 而非
 *   普通赋值：属性名若叫 `__proto__`，普通赋值会触发原型 setter 把整个对象改掉，
 *   defineProperty 则把它当普通自有键处理。
 */
function assignCompiledNode(destination: NodeDestination, node: JsonSchemaNode): void {
  switch (destination.kind) {
    case 'root':
      destination.holder.value = node
      break
    case 'property':
      Object.defineProperty(destination.target, destination.key, {
        value: node,
        enumerable: true,
        configurable: true,
        writable: true,
      })
      break
    case 'item':
      destination.target.items = node
      break
    case 'one-of':
      destination.target[destination.index] = node
      break
  }
}

/** Install a compiled property map at its root or containing object node. */
/*
 * 【中文】把编译好的属性映射安装到根占位符或所属对象节点的 properties 上。
 */
function assignCompiledPropertyMap(destination: PropertyMapDestination, compiled: CompiledPropertyMap): void {
  if (destination.kind === 'root') {
    destination.holder.value = compiled
  } else {
    destination.target.properties = compiled.properties
  }
}

/** Execute an author-schema compilation task graph without recursive descent. */
/*
 * 【中文】编译器主循环：弹出任务、按 kind 分派——property-map 建立映射并压入各属性
 *   任务，property 校验 required 注解后转成 value 任务，value 按 oneOf/json/object/
 *   array/标量分别装配节点并下推子任务，property-map-tail 收尾写入 required，
 *   leave 退出并解除环标记。任何违规经 authorError 抛出。
 * @param initial - 初始任务（由 compilePropertyMap / compileValueSchema 构造）。
 */
function runSchemaCompiler(initial: CompileTask): void {
  // 【中文】当前栈上正在处理的对象集合：同一对象出现两次即环引用，立即报错。
  const seen = new Set<object>()
  // 【中文】待办任务栈；子任务逆序压入以保持文档顺序。
  const tasks: CompileTask[] = [initial]
  for (let task = tasks.pop(); task !== undefined; task = tasks.pop()) {
    if (task.kind === 'leave') {
      seen.delete(task.input)
      continue
    }
    if (task.kind === 'property-map-tail') {
      if (task.required.length > 0) {
        task.compiled.required = task.required
        if (task.destination.kind === 'object') task.destination.target.required = task.required
      }
      continue
    }
    if (task.kind === 'property') {
      if (!isJsonSchemaRecord(task.property)) authorError(`${task.path} must be a value schema object`)
      if (Object.hasOwn(task.property, 'required') && task.property.required !== true) {
        authorError(`${task.path}.required must be true when present`)
      }
      if (Object.hasOwn(task.property, 'required') && task.property.required === true) task.required.push(task.key)
      tasks.push({
        kind: 'value',
        input: task.property,
        path: task.path,
        allowRequired: true,
        destination: { kind: 'property', target: task.properties, key: task.key },
      })
      continue
    }
    if (task.kind === 'property-map') {
      if (!isJsonSchemaRecord(task.input)) authorError(`${task.path} must be an object of value schemas`)
      if (seen.has(task.input)) authorError(`${task.path} is circular`)
      seen.add(task.input)
      const compiled: CompiledPropertyMap = { properties: {} }
      const required: string[] = []
      assignCompiledPropertyMap(task.destination, compiled)
      tasks.push({ kind: 'leave', input: task.input })
      tasks.push({ kind: 'property-map-tail', compiled, required, destination: task.destination })
      const entries = Object.entries(task.input)
      for (let index = entries.length - 1; index >= 0; index--) {
        const entry = entries[index]
        /* v8 ignore next -- the loop is bounded by the captured entry count. */
        if (entry === undefined) continue
        tasks.push({
          kind: 'property',
          property: entry[1],
          path: `${task.path}.${entry[0]}`,
          key: entry[0],
          properties: compiled.properties,
          required,
        })
      }
      continue
    }

    const { input, path } = task
    if (!isJsonSchemaRecord(input)) authorError(`${path} must be a value schema object`)
    if (seen.has(input)) authorError(`${path} is circular`)
    seen.add(input)
    const authorKeys = [...ANNOTATION_KEYS, ...(task.allowRequired ? ['required'] : [])]
    const node: JsonSchemaNode = {}
    assignCompiledNode(task.destination, node)
    tasks.push({ kind: 'leave', input })

    if (Object.hasOwn(input, 'oneOf')) {
      assertAuthorKeys(input, path, [...authorKeys, 'oneOf', 'type'])
      if (Object.hasOwn(input, 'type')) authorError(`${path} cannot declare both type and oneOf`)
      if (!isPlainJsonArray(input.oneOf)) authorError(`${path}.oneOf must be an array of at least two value schemas`)
      const branches: JsonSchemaNode[] = []
      node.oneOf = branches
      copyAnnotations(input, node)
      for (let index = input.oneOf.length - 1; index >= 0; index--) {
        tasks.push({
          kind: 'value',
          input: input.oneOf[index],
          path: `${path}.oneOf[${index}]`,
          allowRequired: false,
          destination: { kind: 'one-of', target: branches, index },
        })
      }
      continue
    }

    const inputType = Object.hasOwn(input, 'type') ? input.type : undefined
    switch (inputType) {
      case 'json':
        assertAuthorKeys(input, path, [...authorKeys, 'type'])
        copyAnnotations(input, node)
        break
      case 'object':
        assertAuthorKeys(input, path, [...authorKeys, 'type', 'properties', 'additionalProperties'])
        if (!Object.hasOwn(input, 'additionalProperties') || typeof input.additionalProperties !== 'boolean') {
          authorError(`${path}.additionalProperties must be explicitly true or false`)
        }
        node.type = 'object'
        copyAnnotations(input, node)
        node.additionalProperties = input.additionalProperties
        if (Object.hasOwn(input, 'properties')) {
          tasks.push({
            kind: 'property-map',
            input: input.properties,
            path: `${path}.properties`,
            destination: { kind: 'object', target: node },
          })
        }
        break
      case 'array':
        assertAuthorKeys(input, path, [...authorKeys, 'type', 'items'])
        node.type = 'array'
        copyAnnotations(input, node)
        if (Object.hasOwn(input, 'items')) {
          tasks.push({
            kind: 'value',
            input: input.items,
            path: `${path}.items`,
            allowRequired: false,
            destination: { kind: 'item', target: node },
          })
        }
        break
      case 'string':
      case 'number':
      case 'integer':
      case 'boolean':
      case 'null':
        assertAuthorKeys(input, path, [...authorKeys, 'type', 'enum', 'const'])
        node.type = inputType
        copyAnnotations(input, node)
        if (Object.hasOwn(input, 'enum')) {
          if (!isPlainJsonArray(input.enum)) authorError(`${path}.enum must be a non-empty array of scalar values`)
          node.enum = Array.from(input.enum, entry => entry as JsonSchemaScalar)
        }
        if (Object.hasOwn(input, 'const')) node.const = input.const as JsonSchemaScalar
        break
      default:
        authorError(`${path}.type must be string/number/integer/boolean/null/array/object/json, or use oneOf`)
    }
  }
}

/** Compile one implicit property map, collecting per-property requiredness. */
/*
 * 【中文】编译一个隐式属性映射（参数根）：逐属性收集 `required: true`，产出
 *   { properties, required? }。
 */
function compilePropertyMap(input: unknown, path: string): CompiledPropertyMap {
  const holder: CompileRoot<CompiledPropertyMap> = {}
  runSchemaCompiler({ kind: 'property-map', input, path, destination: { kind: 'root', holder } })
  /* v8 ignore next -- the root task assigns before scheduling any descendants. */
  return holder.value ?? authorError(`${path} did not compile`)
}

/** Compile one author node without applying any consumer root restriction. */
/*
 * 【中文】编译单个作者值节点，不附加任何"根必须是什么类型"的消费方限制
 *   （那种限制由调用方按需追加）。
 */
function compileValueSchema(input: unknown, path: string): JsonSchemaNode {
  const holder: CompileRoot<JsonSchemaNode> = {}
  runSchemaCompiler({ kind: 'value', input, path, allowRequired: false, destination: { kind: 'root', holder } })
  /* v8 ignore next -- the root task assigns before scheduling any descendants. */
  return holder.value ?? authorError(`${path} did not compile`)
}

/**
 * Compile one author-facing value schema to the enforced raw JSON Schema
 * subset. The author-only `json` node becomes an annotation-only schema.
 * @param spec - schema for any JSON-value root.
 * @returns The asserted raw schema projection.
 */
/*
 * 【中文】把作者值模式编译为受控子集的原始 JSON Schema（编译后再断言一次子集
 *   合法，双保险）。`type: 'json'` 在此退化为仅注解的无约束节点。
 * @param spec - 任意 JSON 值根的作者模式。
 * @returns 已断言合法的原始 schema。
 */
export function valueSchemaSpecToJsonSchema(spec: ValueSchemaSpec): JsonSchemaNode {
  const schema = compileValueSchema(spec, 'schema')
  assertSupportedJsonSchema(schema)
  return schema
}

/**
 * Compile the implicit open parameter object into raw JSON Schema.
 * @param spec - per-property parameter definitions.
 * @returns An object-rooted raw schema with no implicit-root openness override.
 */
/*
 * 【中文】把隐式参数映射编译为对象根的原始 JSON Schema。根的开放性不加任何
 *   隐式改写（保持 JSON Schema 缺省开放）；必填列表仅在非空时写入。
 * @param spec - 逐属性的参数定义。
 * @returns 对象根原始 schema。
 */
export function parameterSchemaSpecToJsonSchema(spec: ParameterSchemaSpec): ParameterJsonSchema {
  const compiled = compilePropertyMap(spec, 'parameters')
  const schema: ParameterJsonSchema = {
    type: 'object',
    properties: compiled.properties,
    ...(compiled.required === undefined ? {} : { required: compiled.required }),
  }
  assertSupportedJsonSchema(schema)
  return schema
}

/** Invalid model-generated arguments for a typed tool. */
/*
 * 【中文】模型生成的参数未通过 schema 校验时抛出的错误（错误码 INVALID_ARGS），
 *   由 defineTool 包装出的 execute 在执行用户函数之前抛出。
 */
export class ToolArgsError extends HarnessError {
  /** Individual violations in schema-walk order. */
  /* 【中文】按遍历顺序排列的逐条违规描述。 */
  readonly violations: string[]

  constructor(violations: string[]) {
    super(`invalid arguments: ${violations.join('; ')}`, 'INVALID_ARGS')
    this.name = 'ToolArgsError'
    this.violations = violations
  }
}

/**
 * Validate model-generated arguments against an implicit parameter schema.
 * @param spec - declared parameter schema.
 * @param args - candidate arguments, however malformed.
 * @returns Path-qualified violations; empty means valid.
 */
export function validateArgs(spec: ParameterSchemaSpec, args: unknown): string[] {
  return validateJsonSchemaValue(parameterSchemaSpecToJsonSchema(spec), args, '')
}

/** Options for {@link defineTool}. */
/*
 * 【中文】defineTool 的选项：名称、描述、参数 DSL、输出契约（schema + 纯渲染函数）、
 *   可选的超时预算、并发安全分类器、执行体与两个纯呈现回调。泛型 S/O 让 execute
 *   的参数与返回值都获得精确类型。
 */
export interface DefineToolOptions<S extends ParameterSchemaSpec, O extends ValueSchemaSpec> {
  /** Tool name (must be unique). */
  readonly name: string
  /** Human-readable description sent to the model. */
  readonly description: string
  /** Per-property parameter schema compiled to an implicit open object root. */
  readonly parameters: S
  /** Canonical output schema plus pure Native and presentation projections. */
  readonly output: {
    /** Schema enforced against every successful body or policy-replaced value. */
    readonly schema: O
    /** Pure Native/model rendering of one validated canonical value. */
    render(args: InferArgs<S>, value: InferValue<NoInfer<O>>): ContentBlock[]
    /** Pure replayable presentation metadata for direct top-level calls. */
    presentationMeta?(args: InferArgs<S>, value: InferValue<NoInfer<O>>): JsonValue
  }
  /** Optional positive cooperative timeout budget in milliseconds. */
  readonly timeoutMs?: number
  /**
   * Pure classifier for sibling overlap.
   * @param args - typed validated arguments.
   * @returns Whether the call may join a parallel group.
   */
  isConcurrencySafe?(args: InferArgs<S>): boolean
  /**
   * Execute the tool after argument validation.
   * @param args - typed validated arguments.
   * @param exec - execution identity, caller, cancellation, and nesting data.
   * @returns The canonical value declared by `output.schema`.
   */
  execute(args: InferArgs<S>, exec: ToolRunContext): Promise<InferValue<NoInfer<O>>>
  /**
   * Optional last-mile content transform for every normalized outcome. Unlike
   * `execute`, arguments remain `unknown` because invalid-input failures also
   * reach this callback. See {@link ToolDefinition.finalizeContent}.
   * @param exec - immutable execution identity and arguments.
   * @param result - complete normalized outcome before materialization.
   * @returns replacement content, or `undefined` to preserve it.
   */
  finalizeContent?(exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>): ContentBlock[] | undefined
  /**
   * Pure pending-state presenter.
   * @param args - typed validated arguments.
   * @returns Tool-owned render intent, or `undefined` for the generic card.
   */
  presentCall?(args: InferArgs<S>): ToolCallView | undefined
  /**
   * Pure completed-state presenter.
   * @param args - typed validated arguments.
   * @param result - final model-facing tool result.
   * @returns Tool-owned render intent, or `undefined` for the generic card.
   */
  presentResult?(args: InferArgs<S>, result: ToolResult): ToolResultView | undefined
}

/**
 * Define a first-party tool with inferred arguments and strict execution
 * validation. Replay-only presenters validate softly and fall back to generic
 * rendering for obsolete logged arguments.
 * @param options - typed definition and optional finalizer and presenters.
 * @returns A registry-ready definition.
 */
/*
 * 【中文】定义一个首方工具：编译参数与输出 schema、生成带运行时校验的 execute
 *   （违规抛 ToolArgsError），并按需挂上 finalizeContent / presentCall /
 *   presentResult / isConcurrencySafe。关键设计：呈现回调面向"日志回放"——旧日志里
 *   的参数可能不符合当前 schema，因此它们先做软校验，失败即返回 undefined 回退到
 *   通用渲染，绝不抛错；execute 则是硬校验。
 * @param options - 类型化定义 + 可选的 finalizer 与呈现回调。
 * @returns 可注册进 ToolRuntime 的 ToolDefinition。
 */
export function defineTool<const S extends ParameterSchemaSpec, const O extends ValueSchemaSpec>(
  options: DefineToolOptions<S, O>,
): ToolDefinition {
  // Object-literal methods do not use `this`; retaining references is safe.
  // 【中文】以下七处提前解构用户回调：方法引用不依赖 this，放入对象字面量安全（见各 oxlint 注释）。
  // oxlint-disable-next-line typescript/unbound-method
  const userExecute = options.execute
  // oxlint-disable-next-line typescript/unbound-method
  const userFinalizeContent = options.finalizeContent
  // oxlint-disable-next-line typescript/unbound-method
  const userRender = options.output.render
  // oxlint-disable-next-line typescript/unbound-method
  const userPresentationMeta = options.output.presentationMeta
  // oxlint-disable-next-line typescript/unbound-method
  const userPresentCall = options.presentCall
  // oxlint-disable-next-line typescript/unbound-method
  const userPresentResult = options.presentResult
  // oxlint-disable-next-line typescript/unbound-method
  const userIsConcurrencySafe = options.isConcurrencySafe
  if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) {
    throw new Error(`defineTool(${options.name}): timeoutMs must be a positive finite number`)
  }
  const parameters = parameterSchemaSpecToJsonSchema(options.parameters)
  const outputSchema = valueSchemaSpecToJsonSchema(options.output.schema)
  const validate = (args: unknown): string[] => validateJsonSchemaValue(parameters, args, '')
  const tool: ToolDefinition = {
    name: options.name,
    description: options.description,
    parameters: parameters as unknown as Record<string, unknown>,
    output: {
      schema: outputSchema,
      render(args: unknown, value: JsonValue): ContentBlock[] {
        return userRender(args as InferArgs<S>, value as unknown as InferValue<NoInfer<O>>)
      },
      ...userPresentationMeta !== undefined ? {
        presentationMeta(args: unknown, value: JsonValue): JsonValue {
          return userPresentationMeta(args as InferArgs<S>, value as unknown as InferValue<NoInfer<O>>)
        },
      } : {},
    },
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    // 【中文】包装后的执行体：先硬校验参数（失败抛 ToolArgsError，模型可据此自纠），
    //   再调用用户的类型化 execute。
    async execute(args: unknown, exec: ToolRunContext): Promise<JsonValue> {
      const violations = validate(args)
      if (violations.length > 0) throw new ToolArgsError(violations)
      return userExecute(args as InferArgs<S>, exec) as Promise<JsonValue>
    },
  }
  if (userFinalizeContent) {
    tool.finalizeContent = (exec, result) => userFinalizeContent(exec, result)
  }
  // Presentation is display-only and may run on REPLAY of arbitrary logged args
  // (possibly from an older schema), so it must never throw: validate softly and
  // fall back to `undefined` (a generic UI presentation) on any mismatch, rather
  // than the hard `ToolArgsError` the execute path raises.
  // 【中文】呈现回调只做展示，还可能在"旧日志回放"里拿到不符合当前 schema 的参数：
  //   因此软校验失败时返回 undefined（UI 回退通用卡片），而不是像 execute 那样硬抛。
  if (userPresentCall) {
    tool.presentCall = (args: unknown): ToolCallView | undefined => {
      if (validate(args).length > 0) return undefined
      return userPresentCall(args as InferArgs<S>)
    }
  }
  if (userPresentResult) {
    tool.presentResult = (args: unknown, result: ToolResult): ToolResultView | undefined => {
      if (validate(args).length > 0) return undefined
      return userPresentResult(args as InferArgs<S>, result)
    }
  }
  if (userIsConcurrencySafe) {
    tool.isConcurrencySafe = (args: unknown): boolean => {
      if (validate(args).length > 0) return false
      return userIsConcurrencySafe(args as InferArgs<S>)
    }
  }
  return tool
}
