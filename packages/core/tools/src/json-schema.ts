/**
 * ================================ 文件注释 ================================
 * 【文件职责】定义并强制执行本项目统一使用的 JSON Schema 子集：工具输出、Code Mode
 *   生成类型、子代理与工作流共享这一份"受支持的 schema"判定与"值校验"实现。
 * 【技术维度】两阶段设计：① assertSupportedJsonSchema 校验 schema 本身（拒绝子集之外
 *   的关键字，而不是静默不校验）；② validateJsonSchemaValue 用显式栈（非递归）校验
 *   具体值并返回路径化违规列表。另含跨 JS realm 的纯 JSON 记录/数组判定。
 * 【产品维度】模型给出的工具参数、工具产出的规范值都经这里把关；schema 错误一次性
 *   列出全部违规路径，便于作者一次修完。
 * 【逻辑维度】类型与错误类 → realm 无关的纯度判定 → schema 树校验（栈式遍历）→
 *   两个断言入口 → 值校验（帧式遍历，oneOf 精确匹配一次）→ 导出的验证函数。
 * 【关键边界】只支持单标量 type、对象三件套、数组 items、enum/const、恰好一个分支的
 *   oneOf；注解关键字（description 等）不参与校验但必须是无损 JSON。所有遍历刻意
 *   不用递归调用栈，深 schema 不会栈溢出。
 * 【新手阅读建议】先读 JsonSchemaNode 了解子集形状，再看 checkSchemaNode 的任务类型
 *   （enter/leave/*-tail）理解栈式遍历套路，最后看 checkValue 的 ValueFrame 对照。
 * ==========================================================================
 */

/**
 * Enforced JSON Schema subset shared by tool outputs, generated Code Mode
 * types, subagents, and workflows. The subset accepts any JSON root, an
 * annotation-only schema for unconstrained JSON, one scalar `type`, object
 * `properties`/`required`/boolean `additionalProperties`, array `items`,
 * type-correct scalar `enum`/`const`, and exact-one `oneOf`.
 *
 * Unsupported or misplaced keywords reject rather than being accepted without
 * enforcement. Consumers that require an object root apply
 * {@link assertObjectJsonSchema} before accepting input.
 * @module dsh-tools/json-schema
 */

import { assertNever, HarnessError } from '@deepseek-ai/dsh-llm'
import { isJsonValue, type JsonValue } from '@deepseek-ai/dsh-session'

/** Scalar JSON values supported by `enum` and `const`. */
/**
 * 【中文】enum/const 字面量约束允许的标量值：字符串、数字、布尔或 null。
 */
export type JsonSchemaScalar = string | number | boolean | null

/** Single-type keywords accepted by the enforced subset. */
/**
 * 【中文】子集接受的全部 `type` 取值。注意不支持类型数组（如 `["string","null"]`），
 *   一个节点只能声明一种类型；联合请用 oneOf 表达。
 */
export type JsonSchemaType = 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null'

/** Scalar-only schema types accepted by literal constraints. */
/**
 * 【中文】字面量约束（enum/const）只允许出现在标量类型上——从 JsonSchemaType 中
 *   剔除 object 与 array 后的剩余集合。
 */
type JsonSchemaScalarType = Exclude<JsonSchemaType, 'object' | 'array'>

/**
 * One raw JSON Schema node in the enforced subset. The optional fields express
 * the external wire schema; {@link assertSupportedJsonSchema} rejects invalid
 * combinations before a caller treats the node as trusted.
 */
/**
 * 【中文】受支持子集内的一个原始 JSON Schema 节点。字段全部可选——这是"线上传入、
 *   尚未验证"的形态；必须先经 assertSupportedJsonSchema 校验才可当作可信节点使用。
 */
export interface JsonSchemaNode {
  /** Omit with no constraints for any JSON value, or use `oneOf`. */
  /** 【中文】省略且无其他约束 = 接受任意 JSON 值；联合用 oneOf，不能与 type 并存。 */
  type?: JsonSchemaType
  /** Exactly one branch must validate; at least two branches are required. */
  /** 【中文】恰好一个分支通过才算有效；至少要两个分支。 */
  oneOf?: JsonSchemaNode[]
  /** Nested property schemas (`type: 'object'` only). */
  /** 【中文】嵌套属性 schema（仅 type: 'object' 时合法）。 */
  properties?: Record<string, JsonSchemaNode>
  /** Required property names; each must appear in `properties`. */
  /** 【中文】必填属性名列表；每个名字必须出现在 properties 里。 */
  required?: string[]
  /** `false` rejects undeclared keys; absent/`true` follows JSON Schema's open default. */
  /** 【中文】false 拒绝未声明的键；缺省或 true 遵循 JSON Schema 默认的开放语义。 */
  additionalProperties?: boolean
  /** Item schema (`type: 'array'` only); absent accepts any JSON item. */
  /** 【中文】数组项 schema（仅 type: 'array' 时合法）；缺省接受任意项。 */
  items?: JsonSchemaNode
  /** Allowed values for a scalar node. */
  /** 【中文】标量节点的允许值列表（非空）。 */
  enum?: JsonSchemaScalar[]
  /** The single allowed value for a scalar node. */
  /** 【中文】标量节点的唯一允许值。 */
  const?: JsonSchemaScalar
  /** Annotation, ignored for validation. */
  /** 【中文】注解：不参与校验，但必须是字符串。 */
  description?: string
  /** Annotation, ignored for validation. */
  /** 【中文】注解：不参与校验，但必须是字符串。 */
  title?: string
  /** Annotation, ignored for validation but required to be lossless JSON. */
  /** 【中文】注解：不参与校验，但必须是无损 JSON 数据。 */
  default?: JsonValue
  /** Annotation, ignored for validation but required to be lossless JSON. */
  /** 【中文】注解：不参与校验，但必须是无损 JSON 数据。 */
  examples?: JsonValue
}

/** A consumer-constrained object-rooted schema. */
/**
 * 【中文】要求根节点为对象的 schema 形态：子代理/工作流的结构化输出等消费方在
 *   接收输入前先用 assertObjectJsonSchema 收敛到这一形态。
 */
export type ObjectJsonSchema = JsonSchemaNode & { type: 'object' }

/**
 * Thrown when a raw schema falls outside the enforced subset. `violations`
 * lists every offending path instead of stopping at the first author error.
 */
/**
 * 【中文】schema 超出受支持子集时抛出的错误。特点：一次性收集全部违规路径
 *   （violations），而不是遇到第一个错误就停——作者能一轮修完所有问题。
 */
export class JsonSchemaError extends HarnessError {
  /** Individual schema violations in walk order. */
  /** 【中文】按遍历顺序排列的逐条违规描述（带路径前缀）。 */
  readonly violations: string[]

  constructor(violations: string[]) {
    super(`unsupported JSON schema: ${violations.join('; ')}`, 'UNSUPPORTED_SCHEMA')
    this.name = 'JsonSchemaError'
    this.violations = violations
  }
}

// 【中文】子集承认的全部"约束关键字"：出现在 schema 里会被校验；其余未列关键字一律拒绝。
const CONSTRAINT_KEYWORDS = new Set([
  'type',
  'oneOf',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'const',
])
// 【中文】注解关键字：不参与校验，但值本身必须是无损 JSON/正确类型。
const ANNOTATION_KEYWORDS = new Set(['description', 'title', 'default', 'examples'])
// 【中文】合法 type 全集，用于快速包含性检查与错误信息展示。
const SCHEMA_TYPES: readonly JsonSchemaType[] = ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']

/* jscpd:ignore-start -- this realm boundary mirrors the session-owned lossless-JSON intrinsic test */
/** Whether a realm-owned intrinsic prototype is backed by its native constructor. */
/**
 * 【中文】判定某个原型是否由对应内建构造函数（Object/Array）原生支撑。跨 iframe/VM
 *   场景下 `instanceof` 不可靠，所以改为核对构造函数名、prototype 反指与原生函数
 *   源码特征三重证据；任何一步抛错都按 false 处理。
 */
function hasIntrinsicConstructor(prototype: object, name: 'Array' | 'Object'): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'constructor')
  const constructor: unknown = descriptor?.value
  if (typeof constructor !== 'function') return false
  try {
    return constructor.name === name
      && constructor.prototype === prototype
      && Function.prototype.toString.call(constructor) === `function ${name}() { [native code] }`
  } catch {
    return false
  }
}

/** Whether a candidate is one realm's intrinsic `Object.prototype`. */
/**
 * 【中文】判断一个对象是否为某 realm 的内建 `Object.prototype`（无原型 +
 *   原生 Object 构造函数支撑），即"null-prototype 纯记录"的原型形态之一。
 */
function isIntrinsicObjectPrototype(value: object): boolean {
  return Object.getPrototypeOf(value) === null && hasIntrinsicConstructor(value, 'Object')
}

/**
 * Test for a realm-agnostic plain JSON record without accepting arrays or
 * exotic objects.
 * @param value - candidate record from any JavaScript realm.
 * @returns Whether the value has a plain-object prototype chain.
 */
/**
 * 【中文】跨 realm 的"普通 JSON 记录"判定：是对象、非数组，且原型链要么为 null
 *   要么是内建 Object.prototype。拒绝 Map/Date/class 实例等奇异对象——它们无法
 *   无损地投影为 JSON。
 * @param value - 任意来源的候选值。
 * @returns 是否为普通对象记录（类型守卫）。
 */
export function isPlainJsonRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  try {
    const prototype: unknown = Object.getPrototypeOf(value)
    return prototype === null
      || typeof prototype === 'object' && isIntrinsicObjectPrototype(prototype)
  } catch {
    return false
  }
}

/** Whether an array uses one realm's intrinsic `Array.prototype`. */
/**
 * 【中文】判断数组是否挂在内建 Array.prototype 上（且该原型的原型又是内建
 *   Object.prototype）——跨 realm 的"普通数组"原型判定。
 */
function hasPlainArrayPrototype(value: unknown[]): boolean {
  const prototype: unknown = Object.getPrototypeOf(value)
  if (!Array.isArray(prototype) || !hasIntrinsicConstructor(prototype, 'Array')) return false
  const objectPrototype: unknown = Object.getPrototypeOf(prototype)
  return typeof objectPrototype === 'object'
    && objectPrototype !== null
    && isIntrinsicObjectPrototype(objectPrototype)
}
/* jscpd:ignore-end */

/** Return whether a record contains only own enumerable string keys. */
/**
 * 【中文】记录是否只含自有、可枚举的字符串键：symbol 键、不可枚举属性都会导致
 *   JSON 投影丢失信息，因此都不算"普通 schema 记录"。
 */
function hasOnlyEnumerableStringKeys(value: object): boolean {
  try {
    return Reflect.ownKeys(value)
      .every(key => typeof key === 'string' && Object.prototype.propertyIsEnumerable.call(value, key))
  } catch {
    return false
  }
}

/**
 * Test for an ordinary schema record whose keys survive JSON projection.
 * @param value - candidate record from any JavaScript realm.
 * @returns Whether the record has an intrinsic prototype and only own enumerable string keys.
 */
export function isJsonSchemaRecord(value: unknown): value is Record<string, unknown> {
  return isPlainJsonRecord(value) && hasOnlyEnumerableStringKeys(value)
}

/**
 * Test for a dense ordinary array with no JSON-invisible decorations.
 * @param value - candidate array from any JavaScript realm.
 * @returns Whether the array is intrinsic, dense, and undecorated.
 */
/**
 * 【中文】"稠密、无装饰的普通数组"判定：内建原型、自有键数恰好 = 长度 + 1
 *   （length 本身）、每个下标都是自有属性。多余附加键（JSON 会丢）或稀疏空洞
 *   （undefined 洞）都会被拒。
 * @param value - 任意来源的候选值。
 * @returns 是否为普通稠密数组（类型守卫）。
 */
export function isPlainJsonArray(value: unknown): value is unknown[] {
  if (!Array.isArray(value)) return false
  try {
    if (!hasPlainArrayPrototype(value) || Reflect.ownKeys(value).length !== value.length + 1) return false
    for (let index = 0; index < value.length; index++) {
      if (!Object.hasOwn(value, index)) return false
    }
    return true
  } catch {
    return false
  }
}

/** Lossless finite JSON number, excluding negative zero. */
/**
 * 【中文】"无损 JSON 数字"判定：有限（排除 NaN/±Infinity）且非负零——JSON 序列化
 *   无法区分 -0 与 0，也无法表示非有限值。
 */
function isJsonNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)
}

/** Whether a scalar is valid for one declared schema type. */
/**
 * 【中文】判断一个标量值是否符合声明的标量类型（string/number/integer/boolean/null）。
 *   integer 额外要求整数值；配合 enum/const 检查由 checkScalarValue 负责。
 */
function scalarMatches(type: JsonSchemaScalarType, value: unknown): value is JsonSchemaScalar {
  switch (type) {
    case 'string': return typeof value === 'string'
    case 'number': return isJsonNumber(value)
    case 'integer': return isJsonNumber(value) && Number.isInteger(value)
    case 'boolean': return typeof value === 'boolean'
    case 'null': return value === null
    /* v8 ignore next -- JsonSchemaScalarType is closed; this retains compile-time exhaustiveness. */
    default: return assertNever(type, 'JsonSchemaType')
  }
}

/** Deferred work for the stack-safe raw-schema walk. */
/**
 * 【中文】schema 树校验的显式栈任务：enter 进入节点、leave 退出并解除环检测标记；
 *   one-of-tail/object-tail 把"等所有子节点看完才能做的检查"推迟到子节点之后执行。
 */
type SchemaWalkTask =
  | { kind: 'enter'; node: unknown; path: string }
  | { kind: 'leave'; node: object }
  | { kind: 'one-of-tail'; node: Record<string, unknown>; path: string }
  | { kind: 'object-tail'; node: Record<string, unknown>; path: string; properties: unknown }

/** Keywords that are invalid beside `oneOf`. */
/**
 * 【中文】与 oneOf 同节点出现即违规的关键字集合——子集要求 oneOf 分支自包含，
 *   不允许旁边再挂 properties/enum 等约束。
 */
const ONE_OF_SIBLING_KEYWORDS = ['properties', 'required', 'additionalProperties', 'items', 'enum', 'const'] as const

/** Validate object-only fields after its property schemas have been visited. */
/**
 * 【中文】对象节点的"收尾检查"（在全部属性 schema 访问完之后执行）：
 *   required 必须是字符串数组且每个名字都已在 properties 中声明；
 *   additionalProperties 必须是布尔值。
 */
function checkObjectSchemaTail(
  node: Record<string, unknown>,
  path: string,
  properties: unknown,
  violations: string[],
): void {
  const hasRequired = Object.hasOwn(node, 'required')
  const required = hasRequired ? node.required : undefined
  if (hasRequired) {
    if (!isPlainJsonArray(required) || required.some(entry => typeof entry !== 'string')) {
      violations.push(`${path}.required must be an array of strings`)
    } else {
      const declared = isJsonSchemaRecord(properties) ? properties : {}
      for (const key of required as string[]) {
        if (!Object.hasOwn(declared, key)) violations.push(`${path}.required names "${key}" which is not in properties`)
      }
    }
  }
  if (Object.hasOwn(node, 'additionalProperties') && typeof node.additionalProperties !== 'boolean') {
    violations.push(`${path}.additionalProperties must be a boolean`)
  }
}

/** Collect every violation for one raw schema tree without using the JavaScript call stack. */
/**
 * 【中文】用显式任务栈（而非递归）遍历整棵原始 schema 树，把每条违规追加进
 *   violations：未知关键字、环引用、type/oneOf 冲突、关键字放错类型、enum/const
 *   类型不匹配、oneOf 旁挂约束、required 悬空等全部在此收集。
 * @param root - 待检查的任意值（schema 根节点）。
 * @param rootPath - 诊断路径前缀（如 'schema'）。
 * @param violations - 违规收集器（就地追加）。
 * @param seen - 当前栈上的对象集合，用于检测循环引用。
 */
function checkSchemaNode(root: unknown, rootPath: string, violations: string[], seen: Set<object>): void {
  // 【中文】待处理任务栈；子节点逆序压入使弹出顺序保持文档顺序。
  const tasks: SchemaWalkTask[] = [{ kind: 'enter', node: root, path: rootPath }]
  for (let task = tasks.pop(); task !== undefined; task = tasks.pop()) {
    if (task.kind === 'leave') {
      seen.delete(task.node)
      continue
    }
    if (task.kind === 'one-of-tail') {
      for (const key of ONE_OF_SIBLING_KEYWORDS) {
        if (Object.hasOwn(task.node, key)) violations.push(`${task.path}.${key} is not supported beside oneOf`)
      }
      continue
    }
    if (task.kind === 'object-tail') {
      checkObjectSchemaTail(task.node, task.path, task.properties, violations)
      continue
    }

    const { node, path } = task
    if (!isJsonSchemaRecord(node)) {
      violations.push(`${path} must be a schema object`)
      continue
    }
    if (seen.has(node)) {
      violations.push(`${path} is circular`)
      continue
    }
    seen.add(node)
    tasks.push({ kind: 'leave', node })

    for (const key of Object.keys(node)) {
      if (CONSTRAINT_KEYWORDS.has(key)) continue
      if (ANNOTATION_KEYWORDS.has(key)) {
        try {
          if (!isJsonValue(node[key])) violations.push(`${path}.${key} annotation must be lossless JSON data`)
        } catch {
          violations.push(`${path}.${key} annotation must be lossless JSON data`)
        }
        continue
      }
      violations.push(`${path}.${key} is not a supported keyword (subset: type/oneOf/properties/required/additionalProperties/items/enum/const + annotations)`)
    }
    if (Object.hasOwn(node, 'description') && typeof node.description !== 'string') {
      violations.push(`${path}.description must be a string`)
    }
    if (Object.hasOwn(node, 'title') && typeof node.title !== 'string') {
      violations.push(`${path}.title must be a string`)
    }

    const hasType = Object.hasOwn(node, 'type')
    const hasOneOf = Object.hasOwn(node, 'oneOf')
    if (hasType && hasOneOf) {
      violations.push(`${path} cannot declare both type and oneOf`)
      continue
    }
    if (!hasType && !hasOneOf) {
      for (const key of ONE_OF_SIBLING_KEYWORDS) {
        if (Object.hasOwn(node, key)) violations.push(`${path}.${key} requires type or oneOf`)
      }
      continue
    }

    if (hasOneOf) {
      const oneOf = node.oneOf
      tasks.push({ kind: 'one-of-tail', node, path })
      if (!isPlainJsonArray(oneOf) || oneOf.length < 2) {
        violations.push(`${path}.oneOf must be an array of at least two schemas`)
      } else {
        for (let index = oneOf.length - 1; index >= 0; index--) {
          tasks.push({ kind: 'enter', node: oneOf[index], path: `${path}.oneOf[${index}]` })
        }
      }
      continue
    }

    const type = node.type
    if (typeof type !== 'string' || !(SCHEMA_TYPES as readonly unknown[]).includes(type)) {
      violations.push(Array.isArray(type)
        ? `${path}.type must be a single type string (type arrays are not supported)`
        : `${path}.type must be one of ${SCHEMA_TYPES.join('/')}`)
      continue
    }
    const schemaType = type as JsonSchemaType
    const allowedFor: Record<string, JsonSchemaType[]> = {
      properties: ['object'],
      required: ['object'],
      additionalProperties: ['object'],
      items: ['array'],
      enum: ['string', 'number', 'integer', 'boolean', 'null'],
      const: ['string', 'number', 'integer', 'boolean', 'null'],
    }
    for (const [key, types] of Object.entries(allowedFor)) {
      if (Object.hasOwn(node, key) && !types.includes(schemaType)) {
        violations.push(`${path}.${key} is not supported on type "${schemaType}"`)
      }
    }

    switch (schemaType) {
      case 'object': {
        const properties = Object.hasOwn(node, 'properties') ? node.properties : undefined
        tasks.push({ kind: 'object-tail', node, path, properties })
        if (Object.hasOwn(node, 'properties')) {
          if (!isJsonSchemaRecord(properties)) {
            violations.push(`${path}.properties must be an object of schemas`)
          } else {
            const entries = Object.entries(properties)
            for (let index = entries.length - 1; index >= 0; index--) {
              const entry = entries[index]
              /* v8 ignore next -- the loop is bounded by the captured entry count. */
              if (entry === undefined) continue
              tasks.push({ kind: 'enter', node: entry[1], path: `${path}.properties.${entry[0]}` })
            }
          }
        }
        break
      }
      case 'array': {
        if (Object.hasOwn(node, 'items')) tasks.push({ kind: 'enter', node: node.items, path: `${path}.items` })
        break
      }
      case 'string':
      case 'number':
      case 'integer':
      case 'boolean':
      case 'null': {
        const hasEnum = Object.hasOwn(node, 'enum')
        const allowed = hasEnum ? node.enum : undefined
        const enumValid = isPlainJsonArray(allowed)
          && allowed.length > 0
          && allowed.every(entry => scalarMatches(schemaType, entry))
        if (hasEnum && !enumValid) {
          violations.push(`${path}.enum must be a non-empty array of ${schemaType} values`)
        }
        const hasConst = Object.hasOwn(node, 'const')
        const declaredConst = hasConst ? node.const : undefined
        const constValid = scalarMatches(schemaType, declaredConst)
        if (hasConst) {
          if (!constValid) {
            violations.push(`${path}.const must be a ${schemaType} value`)
          } else if (enumValid && !allowed.includes(declaredConst)) {
            violations.push(`${path}.const must be one of ${path}.enum when both are declared`)
          }
        }
        break
      }
      /* v8 ignore next -- schemaType was narrowed from the closed SCHEMA_TYPES table above. */
      default: assertNever(schemaType, 'JsonSchemaType')
    }
  }
}

/**
 * Assert that an arbitrary raw schema uses only the enforced subset.
 * Annotation-only schemas are accepted as the standard unconstrained-JSON
 * form; callers that require an object root use {@link assertObjectJsonSchema}.
 * @param schema - untrusted raw JSON Schema.
 * @returns Assertion that the schema belongs to the supported subset.
 */
/**
 * 【中文】断言入口一：校验任意原始 schema 属于受支持子集，通过后类型收窄为
 *   JsonSchemaNode（此后代码可信任地直接读字段）。只有注解、无任何约束的节点
 *   被接受为"任意 JSON"的标准写法。违规抛 JsonSchemaError（列出全部路径）。
 * @param schema - 不受信任的原始 JSON Schema。
 */
export function assertSupportedJsonSchema(schema: unknown): asserts schema is JsonSchemaNode {
  const violations: string[] = []
  checkSchemaNode(schema, 'schema', violations, new Set())
  if (violations.length > 0) throw new JsonSchemaError(violations)
}

/**
 * Assert the enforced subset plus the object-root constraint retained by
 * subagent and workflow structured outputs.
 * @param schema - untrusted caller-supplied schema.
 * @returns Assertion that the schema belongs to the supported subset and has an object root.
 */
/**
 * 【中文】断言入口二：在子集校验之上追加"根节点必须是 type: 'object'"的约束，
 *   供子代理与工作流的结构化输出使用（它们的顶层值约定为对象）。
 * @param schema - 不受信任的调用方 schema。
 */
export function assertObjectJsonSchema(schema: unknown): asserts schema is ObjectJsonSchema {
  const violations: string[] = []
  checkSchemaNode(schema, 'schema', violations, new Set())
  if (violations.length === 0
    && (!isJsonSchemaRecord(schema) || !Object.hasOwn(schema, 'type') || schema.type !== 'object')) {
    violations.push('schema.type must be "object" (structured output is object-rooted)')
  }
  if (violations.length > 0) throw new JsonSchemaError(violations)
}

/** Safely test the lossless JSON boundary when a getter may throw. */
/**
 * 【中文】带兜底的 isJsonValue：值上若挂了会抛异常的 getter，按"不是无损 JSON"
 *   处理而不是让异常冒泡中断整个校验。
 */
function safelyIsJsonValue(value: unknown): boolean {
  try {
    return isJsonValue(value)
  } catch {
    return false
  }
}

/** Root-aware diagnostic path for the parameter validator's empty sentinel. */
/**
 * 【中文】诊断路径的根处理：空路径显示为 'arguments'（参数校验的根哨兵），
 *   其余原样返回。
 */
function diagnosticPath(path: string): string {
  return path === '' ? 'arguments' : path
}

/** Append one object property without a leading dot at an implicit root. */
/**
 * 【中文】拼接属性诊断路径；隐式根（空路径）下不加前导点，如 `missing "foo"`，
 *   嵌套时为 `a.b`。
 */
function propertyPath(path: string, key: string): string {
  return path === '' ? key : `${path}.${key}`
}

/** One child evaluation deferred by a container or exact-one union frame. */
/**
 * 【中文】值校验中一个待求值的子项：容器（对象属性/数组元素）或 oneOf 分支的
 *   节点 + 值 + 诊断路径三元组。
 */
interface ValueChild {
  readonly node: JsonSchemaNode
  readonly value: unknown
  readonly path: string
}

/** Explicit call frame for stack-safe schema-value validation. */
/**
 * 【中文】值校验的显式调用帧：替代递归调用栈。phase 在 start（本节点分类并派发
 *   子帧）与 children（聚合子帧结果）间切换；oneOf 用 matches 计数实现"恰好一个
 *   分支通过"；catches 标记该帧是否吞掉子帧抛出的异常（转为无损 JSON 违规）。
 */
interface ValueFrame {
  readonly node: JsonSchemaNode
  readonly value: unknown
  readonly path: string
  catches: boolean
  phase: 'start' | 'children'
  kind?: 'oneOf' | 'object' | 'array'
  children: ValueChild[]
  childIndex: number
  violations: string[]
  tailViolations: string[]
  matches: number
}

/** The generic exception-containment diagnostic owned by one valid schema node. */
/**
 * 【中文】"值不是无损 JSON"的通用违规文案：当某个子节点求值抛出异常、且其最近
 *   的可捕获帧决定吞掉时，用这条诊断替代具体错误。
 */
function losslessValueViolation(path: string): string[] {
  return [`"${diagnosticPath(path)}" must be a lossless JSON value`]
}

/** Append diagnostics without spreading a potentially wide child result as call arguments. */
/**
 * 【中文】逐条追加诊断：刻意不用展开运算符（`target.push(...source)`），避免超长
 *   子结果被当作用户参数展开导致栈溢出。
 */
function appendViolations(target: string[], source: readonly string[]): void {
  for (const violation of source) target.push(violation)
}

/** Initialize one validation frame with empty aggregation state. */
/**
 * 【中文】构造一个空白校验帧：聚合状态（子帧、计数、违规列表）全部归零。
 */
function valueFrame(node: JsonSchemaNode, value: unknown, path: string): ValueFrame {
  return {
    node,
    value,
    path,
    catches: false,
    phase: 'start',
    children: [],
    childIndex: 0,
    violations: [],
    tailViolations: [],
    matches: 0,
  }
}

/** Validate one scalar node after its primitive type check. */
/**
 * 【中文】标量节点的字面量约束检查（在基本类型检查通过之后）：enum 要求值在
 *   列表内、const 要求全等；两者都未声明则通过。
 * @returns 违规列表；空数组表示通过。
 */
function checkScalarValue(node: JsonSchemaNode, value: unknown, path: string): string[] {
  const allowed = Object.hasOwn(node, 'enum') ? node.enum : undefined
  if (allowed !== undefined && !allowed.includes(value as JsonSchemaScalar)) {
    return [`"${diagnosticPath(path)}" must be one of ${JSON.stringify(allowed)}`]
  }
  if (Object.hasOwn(node, 'const') && value !== node.const) {
    return [`"${diagnosticPath(path)}" must be ${JSON.stringify(node.const)}`]
  }
  return []
}

/** Validate one trusted schema/value pair with explicit frames rather than recursive calls. */
/**
 * 【中文】值校验的帧式内核：schema 已受信（assertSupportedJsonSchema 通过），此处
 *   只校验"值"并返回路径化违规。对象检查必填/未声明键、数组逐项下推、标量做类型
 *   与字面量约束、oneOf 统计命中数要求恰好为 1；子节点抛出的异常被最近的可捕获
 *   帧转为"必须是无损 JSON 值"的诊断，绝不外泄中断整个校验。
 */
function checkValue(schema: JsonSchemaNode, value: unknown, path: string): string[] {
  // 【中文】显式帧栈；rootResult 接住根帧的最终违规列表。
  const frames: ValueFrame[] = [valueFrame(schema, value, path)]
  let rootResult: string[] | undefined

  const receive = (result: string[]): void => {
    const parent = frames.at(-1)
    if (parent === undefined) {
      rootResult = result
      return
    }
    if (parent.kind === 'oneOf') {
      if (result.length === 0) parent.matches++
    } else {
      appendViolations(parent.violations, result)
    }
  }
  const finish = (result: string[]): void => {
    frames.pop()
    receive(result)
  }

  while (frames.length > 0) {
    const frame = frames.at(-1)
    /* v8 ignore next -- the loop condition guarantees a current frame. */
    if (frame === undefined) break
    try {
      if (frame.phase === 'children') {
        if (frame.childIndex < frame.children.length) {
          const child = frame.children[frame.childIndex]
          /* v8 ignore next -- childIndex is bounded by children.length. */
          if (child === undefined) throw new Error('missing schema-value child frame')
          frame.childIndex++
          frames.push(valueFrame(child.node, child.value, child.path))
          continue
        }
        if (frame.kind === 'oneOf') {
          finish(frame.matches === 1 ? [] : [`"${diagnosticPath(frame.path)}" must match exactly one oneOf branch (matched ${frame.matches})`])
          continue
        }
        appendViolations(frame.violations, frame.tailViolations)
        if (frame.violations.length > 0) {
          finish(frame.violations)
        } else if (frame.kind === 'object') {
          finish(safelyIsJsonValue(frame.value) ? [] : [`"${diagnosticPath(frame.path)}" must be a lossless JSON object`])
        } else {
          finish(safelyIsJsonValue(frame.value) ? [] : [`"${diagnosticPath(frame.path)}" must be a dense lossless JSON array`])
        }
        continue
      }

      const nodeType = Object.hasOwn(frame.node, 'type') ? frame.node.type : undefined
      frame.catches = !(nodeType !== undefined && !(SCHEMA_TYPES as readonly unknown[]).includes(nodeType))
      const oneOf = Object.hasOwn(frame.node, 'oneOf') ? frame.node.oneOf : undefined
      if (oneOf !== undefined) {
        frame.kind = 'oneOf'
        frame.children = Array.from(oneOf, branch => ({ node: branch, value: frame.value, path: frame.path }))
        frame.childIndex = 0
        frame.matches = 0
        frame.phase = 'children'
        continue
      }
      if (nodeType === undefined) {
        finish(safelyIsJsonValue(frame.value) ? [] : losslessValueViolation(frame.path))
        continue
      }

      switch (nodeType) {
        case 'object': {
          if (!isPlainJsonRecord(frame.value)) {
            finish([`"${diagnosticPath(frame.path)}" must be an object`])
            break
          }
          const properties = Object.hasOwn(frame.node, 'properties') ? frame.node.properties ?? {} : {}
          const violations: string[] = []
          const required = Object.hasOwn(frame.node, 'required') ? frame.node.required ?? [] : []
          for (const key of required) {
            if (!Object.hasOwn(frame.value, key) || frame.value[key] === undefined) {
              violations.push(`missing required property "${propertyPath(frame.path, key)}"`)
            }
          }
          const children: ValueChild[] = []
          for (const [key, child] of Object.entries(properties)) {
            if (!Object.hasOwn(frame.value, key) || frame.value[key] === undefined) continue
            children.push({ node: child, value: frame.value[key], path: propertyPath(frame.path, key) })
          }
          const tailViolations: string[] = []
          if (Object.hasOwn(frame.node, 'additionalProperties') && frame.node.additionalProperties === false) {
            for (const key of Object.keys(frame.value)) {
              if (!Object.hasOwn(properties, key)) {
                tailViolations.push(`"${propertyPath(frame.path, key)}" is not a declared property (additionalProperties: false)`)
              }
            }
          }
          frame.kind = 'object'
          frame.children = children
          frame.childIndex = 0
          frame.violations = violations
          frame.tailViolations = tailViolations
          frame.phase = 'children'
          break
        }
        case 'array': {
          if (!Array.isArray(frame.value)) {
            finish([`"${diagnosticPath(frame.path)}" must be an array`])
            break
          }
          const items = Object.hasOwn(frame.node, 'items') ? frame.node.items : undefined
          const children = items === undefined
            ? []
            : frame.value.flatMap((entry, index): ValueChild[] => [{ node: items, value: entry, path: `${frame.path}[${index}]` }])
          frame.kind = 'array'
          frame.children = children
          frame.childIndex = 0
          frame.violations = []
          frame.phase = 'children'
          break
        }
        case 'string':
          finish(typeof frame.value === 'string'
            ? checkScalarValue(frame.node, frame.value, frame.path)
            : [`"${diagnosticPath(frame.path)}" must be a string`])
          break
        case 'number':
          finish(typeof frame.value !== 'number'
            ? [`"${diagnosticPath(frame.path)}" must be a number`]
            : !isJsonNumber(frame.value)
              ? [`"${diagnosticPath(frame.path)}" must be a finite JSON number`]
              : checkScalarValue(frame.node, frame.value, frame.path))
          break
        case 'integer':
          finish(!isJsonNumber(frame.value) || !Number.isInteger(frame.value)
            ? [`"${diagnosticPath(frame.path)}" must be an integer`]
            : checkScalarValue(frame.node, frame.value, frame.path))
          break
        case 'boolean':
          finish(typeof frame.value === 'boolean'
            ? checkScalarValue(frame.node, frame.value, frame.path)
            : [`"${diagnosticPath(frame.path)}" must be a boolean`])
          break
        case 'null':
          finish(frame.value === null
            ? checkScalarValue(frame.node, frame.value, frame.path)
            : [`"${diagnosticPath(frame.path)}" must be null`])
          break
        default:
          finish(assertNever(nodeType, 'JsonSchemaType'))
      }
    } catch (error) {
      let failed = frames.pop()
      while (failed !== undefined && !failed.catches) failed = frames.pop()
      if (failed === undefined) throw error
      receive(losslessValueViolation(failed.path))
    }
  }

  /* v8 ignore next -- every root frame finishes or throws. */
  return rootResult ?? losslessValueViolation(path)
}

/**
 * Validate a candidate value against an asserted raw schema. The function is
 * total for arbitrary values and returns path-qualified violations.
 * @param schema - a schema accepted by {@link assertSupportedJsonSchema}.
 * @param value - the candidate JSON value.
 * @param path - root label used in diagnostics.
 * @returns All violations in walk order; empty means valid.
 */
/**
 * 【中文】对外导出的值校验入口：对任意候选值做全量校验（函数是全量的——任何输入
 *   都不抛异常），返回按遍历顺序排列的违规描述。
 * @param schema - 已通过 assertSupportedJsonSchema 的受信 schema。
 * @param value - 待校验的候选值（可以是任意形状）。
 * @param path - 诊断用的根路径标签，默认 'value'；参数校验传 ''（显示为 arguments）。
 * @returns 全部违规；空数组表示合法。
 */
export function validateJsonSchemaValue(schema: JsonSchemaNode, value: unknown, path = 'value'): string[] {
  return checkValue(schema, value, path)
}
