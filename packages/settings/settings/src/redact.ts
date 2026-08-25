/**
 * Structural secret redaction for settings values. `role('secret')` fields are
 * removed from a value before it crosses a wire boundary; a sidecar records
 * each schema-declared secret position and whether it currently holds a value,
 * so a configuration surface can render a write-only input without ever
 * receiving the secret itself.
 * @module @deepseek-ai/dsh-settings/redact
 */

/*
 * ================================ 文件注释 ================================
 * 【文件职责】对设置值做"结构性秘密脱敏"：把 schema 中声明为 role('secret') 的字段从值中移除，
 *   同时记录每个秘密槽位的位置与是否已赋值，供配置界面渲染"只写输入框"而不接触秘密本身。
 * 【技术维度】按 schemastery 节点结构（object/dict/array）递归遍历；对对象属性始终枚举秘密槽位，
 *   对 dict 条目与数组项只在值确实存在时记录；输入值永不被修改（返回的是脱离原值的副本）。
 * 【产品维度】跨线传输（如配置 UI → 后端）时避免泄露 API Key 等秘密；UI 能知道"这里有个秘密，
 *   当前是否已设置"从而只展示写入口。
 * 【逻辑维度】walk 递归：命中 secret 角色 → 记录并移除；object → 重组副本；dict/array → 逐项递归；
 *   其他类型（union/intersection/transform）→ 原样放行。
 * 【关键边界】藏在 union 分支或 transform 内部的秘密无法被本遍历发现，此类场景必须换建模方式；
 *   TODO 标注未来应改为"发现即报错"（fail closed）。
 * 【新手阅读建议】先理解 schemastery 的 object/dict/array 节点结构，再看 walk 的四种分支。
 * ==========================================================================
 */

import type z from '@deepseek-ai/schemastery'

/**
 * Minimal structural view of a live schemastery node. Only the relations the
 * redactor walks are named; everything else on the instance is ignored.
 */
// 对 schemastery 运行时节点的最小结构视图：只声明遍历用得到的字段，其余细节一概不关心。
interface SchemaNode {
  type?: string
  meta?: { role?: unknown }
  /** `object` properties, keyed by property name. */
  dict?: Record<string, SchemaNode>
  /** `dict`/`array` element schema. */
  inner?: SchemaNode
}

// 一个被脱敏的秘密位置：记录路径与"脱敏前是否有值"，供 UI 渲染只写输入框。
/** One schema-declared secret position inside a redacted value. */
export interface RedactedSecret {
  /** Path from the section root to the removed field (concrete dict keys and array indexes included). */
  path: string[]
  /** Whether the field held a value before redaction. */
  set: boolean
}

// 脱敏结果：去掉秘密字段的副本 + 所有秘密位置清单。
/** A value with every `role('secret')` field removed, plus the removal record. */
export interface RedactedValue {
  /** Detached copy of the input with secret fields absent. */
  value: unknown
  /**
   * Every reachable secret position: object properties always (even unset, so
   * a form knows the slot exists), dict entries and array items only where the
   * value has them.
   */
  secrets: RedactedSecret[]
}

// 判断值是否为可继续递归的"普通数据对象"（非数组、非 null）。
/** Whether a value is a plain data object the walker may recurse into. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 按 schema 递归遍历并脱敏一个值，同时收集秘密位置。
 * @param node - 当前值对应的 schema 节点；undefined 表示无约束，原样返回。
 * @param value - 当前待脱敏的值。
 * @param path - 从段落根到当前值的路径（dict 键、数组下标已具体化），用于定位秘密。
 * @param secrets - 收集秘密位置的结果数组。
 * @returns 脱敏后的值；命中 secret 角色的字段返回 undefined，表示"已移除"。
 */
function walk(node: SchemaNode | undefined, value: unknown, path: string[], secrets: RedactedSecret[]): unknown {
  if (node === undefined) return value
  if (node.meta?.role === 'secret') {
    secrets.push({ path, set: value !== undefined })
    return undefined
  }
  switch (node.type) {
    case 'object': {
      const properties = node.dict ?? {}
      const source = isRecord(value) ? value : undefined
      const rebuilt: Record<string, unknown> = {}
      if (source !== undefined) {
        for (const [key, entry] of Object.entries(source)) {
          if (key in properties) continue
          rebuilt[key] = entry
        }
      }
      for (const [key, child] of Object.entries(properties)) {
        const stripped = walk(child, source?.[key], [...path, key], secrets)
        if (stripped !== undefined) rebuilt[key] = stripped
      }
      return source === undefined && Object.keys(rebuilt).length === 0 ? value : rebuilt
    }
    case 'dict': {
      if (!isRecord(value)) return value
      const rebuilt: Record<string, unknown> = {}
      for (const [key, entry] of Object.entries(value)) {
        const stripped = walk(node.inner, entry, [...path, key], secrets)
        if (stripped !== undefined) rebuilt[key] = stripped
      }
      return rebuilt
    }
    case 'array': {
      if (!Array.isArray(value)) return value
      return value.map((entry, index) => walk(node.inner, entry, [...path, String(index)], secrets))
    }
    default:
      // TODO(settings-wire-redaction): Fail closed instead — a secret reachable
      // only through a union, intersection, or transform is returned verbatim
      // here, with nothing recording that it was missed.
      return value
  }
}

/**
 * Remove every `role('secret')` field a schema declares from a value. The
 * walker follows `object`, `dict`, and `array` containers; a secret must be
 * declared directly on a field reachable through those containers (a secret
 * buried inside a union branch or transform is not reachable and must not be
 * modeled that way). The input is never mutated.
 * @param schema - live schemastery schema describing the value.
 * @param value - the value to strip; `undefined` yields an empty record with
 *   object-property secret slots still enumerated.
 * @returns the stripped detached value and the ordered secret positions.
 */
// 入口函数：按 schema 走一遍 walk，返回"脱敏副本 + 秘密位置清单"；原输入值不被修改。
export function redactSecrets(schema: z<never>, value: unknown): RedactedValue {
  const secrets: RedactedSecret[] = []
  const stripped = walk(schema, value, [], secrets)
  return { value: stripped, secrets }
}
