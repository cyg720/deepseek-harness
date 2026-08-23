/**
 * ================================ 文件注释 ================================
 * 【文件职责】设置域拥有的同步模式（schema）服务：settingsSchema —— 提供
 *             模式重水合、校验、按路径解析，以及不可变地读写嵌套设置值。
 * 【技术维度】Cordis Service 包装 schemastery：动态客户端插件通过该实体协作，
 *             而非互相导入可执行辅助函数（客户端包纯度门禁）。
 * 【产品维度】设置编辑的校验与按路径修改的数据层基础。
 * 【逻辑维度】rehydrate 还原模式 → validate 校验草稿 → nodeAtPath/getPath 路径解析
 *             → setPath/deletePath 不可变修改（cloneSpine 沿路径复制）。
 * 【关键边界】路径支持对象键与数组下标；setPath/deletePath 要求非空路径。
 * 【新手阅读建议】先看 cloneSpine/cloneContainer 的复制策略，再看各方法的路径语义。
 * ==========================================================================
 */
/** Synchronous schema introspection and immutable settings-draft edits. */
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

/** Live schemastery node used for settings introspection and validation. */
export type SchemaNode = Schema

function cloneContainer(container: unknown, key: string): Record<string, unknown> | unknown[] {
  if (Array.isArray(container)) return [...container as unknown[]]
  if (typeof container === 'object' && container !== null) return { ...container as Record<string, unknown> }
  return /^\d+$/.test(key) ? [] : {}
}

function cloneSpine(root: Record<string, unknown>, path: readonly string[]): {
  result: Record<string, unknown>
  parent: Record<string, unknown> | unknown[]
  leaf: string
} {
  const result = { ...root }
  let target: Record<string, unknown> | unknown[] = result
  for (let index = 0; index < path.length - 1; index++) {
    const key = path[index] as string
    const child = cloneContainer(
      Array.isArray(target) ? target[Number(key)] : target[key],
      path[index + 1] as string,
    )
    if (Array.isArray(target)) target[Number(key)] = child
    else target[key] = child
    target = child
  }
  return { result, parent: target, leaf: path[path.length - 1] as string }
}

/**
 * Settings-owned synchronous schema service. Dynamic client plugins receive
 * this Cordis entity instead of importing executable helpers from one another.
 */
export class SettingsSchemaService extends Service {
  /** @param ctx - providing ui-settings context. */
  constructor(ctx: Context) {
    super(ctx, 'settingsSchema')
  }

  /**
   * Rehydrate one serialized `schema.toJSON()` envelope.
   * @param serialized - serialized Schemastery node.
   * @returns live schema node.
   */
  rehydrate(serialized: unknown): SchemaNode {
    return new Schema(serialized as Schema)
  }

  /**
   * Validate a settings draft.
   * @param schema - live schema node.
   * @param draft - candidate settings value.
   * @returns validation failure text, or `undefined` when valid.
   */
  validate(schema: SchemaNode, draft: unknown): string | undefined {
    try {
      ;(schema as unknown as (value: unknown) => unknown)(draft)
      return undefined
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  }

  /**
   * Resolve an object, dict, or array schema node at a settings path.
   * @param root - schema node to traverse.
   * @param path - object keys or array indexes.
   * @returns the resolved node, or `undefined` when the path is absent.
   */
  nodeAtPath(root: SchemaNode, path: readonly string[]): SchemaNode | undefined {
    let node: SchemaNode | undefined = root
    for (const key of path) {
      if (node === undefined) return undefined
      if (node.type === 'object') node = (node.dict as Record<string, SchemaNode> | undefined)?.[key]
      else if (node.type === 'dict' || node.type === 'array') node = node.inner as SchemaNode | undefined
      else return undefined
    }
    return node
  }

  /**
   * Read a nested value by a string-key or array-index path.
   * @param value - value to traverse.
   * @param path - object keys or array indexes.
   * @returns the resolved value, or `undefined` when the path is absent.
   */
  getPath(value: unknown, path: readonly string[]): unknown {
    let current: unknown = value
    for (const key of path) {
      if (Array.isArray(current)) {
        current = current[Number(key)]
        continue
      }
      if (typeof current !== 'object' || current === null) return undefined
      current = (current as Record<string, unknown>)[key]
    }
    return current
  }

  /**
   * Report whether the final path key exists independently of its value.
   * @param value - value to traverse.
   * @param path - object keys or array indexes.
   * @returns whether the path exists.
   */
  hasPath(value: unknown, path: readonly string[]): boolean {
    if (path.length === 0) return value !== undefined
    const parent = this.getPath(value, path.slice(0, -1))
    const key = path[path.length - 1] as string
    if (Array.isArray(parent)) return Number(key) < parent.length
    if (typeof parent !== 'object' || parent === null) return false
    return key in parent
  }

  /**
   * Immutably set a nested value, materializing missing containers.
   * @param root - settings object to copy.
   * @param path - non-empty object-key or array-index path.
   * @param value - replacement value.
   * @returns copied root containing the replacement.
   * @throws when `path` is empty.
   */
  setPath(root: Record<string, unknown>, path: readonly string[], value: unknown): Record<string, unknown> {
    if (path.length === 0) throw new Error('ui-settings: setPath needs a non-empty path')
    const { result, parent, leaf } = cloneSpine(root, path)
    if (Array.isArray(parent)) parent[Number(leaf)] = value
    else parent[leaf] = value
    return result
  }

  /**
   * Immutably remove a nested key, preserving an unchanged missing root.
   * @param root - settings object to copy.
   * @param path - non-empty object-key or array-index path.
   * @returns copied root without the key, or `root` when the path is absent.
   * @throws when `path` is empty.
   */
  deletePath(root: Record<string, unknown>, path: readonly string[]): Record<string, unknown> {
    if (path.length === 0) throw new Error('ui-settings: deletePath needs a non-empty path')
    if (!this.hasPath(root, path)) return root
    const { result, parent, leaf } = cloneSpine(root, path)
    if (Array.isArray(parent)) parent.splice(Number(leaf), 1)
    else Reflect.deleteProperty(parent, leaf)
    return result
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Settings-owned synchronous schema and immutable path operations. */
    settingsSchema: SettingsSchemaService
  }
}
