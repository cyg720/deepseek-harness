/** 模型草稿保留未知字段；容量文本在保存前转换，非法文本不会进入写入载荷。 */
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
type SettingValue = Extract<SettingsPathOpView, { op: 'set' }>['value']
/** 模型行包含未编辑原值和四个可见字段的输入文本。 */
export interface ModelDraft {
  readonly original: Record<string, SettingValue>
  readonly id: string
  readonly name: string
  readonly contextWindow: string
  readonly maxTokens: string
}
/**
 * 将已读取模型转换为可见输入草稿。
 * @param value - 已读取的模型数组。
 * @returns 保留原字段的输入草稿。
 */
export function modelDrafts(value: unknown): ModelDraft[] {
  if (!Array.isArray(value)) return []
  return value.map((entry: unknown) => {
    // 设置镜像来自 JSON；局部收窄仅识别记录容器，不重新构造并丢弃扩展字段。
    const original = typeof entry === 'object' && entry !== null && !Array.isArray(entry)
      ? entry as Record<string, SettingValue> : {}
    return { original, id: typeof original.id === 'string' ? original.id : '', name: typeof original.name === 'string' ? original.name : '',
      contextWindow: typeof original.contextWindow === 'number' ? String(original.contextWindow) : '',
      maxTokens: typeof original.maxTokens === 'number' ? String(original.maxTokens) : '' }
  })
}
/**
 * 将容量输入转换为 token 数。
 * @param text - 十进制 token 数或 K/M 简写。
 * @returns 空白为继承，非法值为 NaN。
 */
export function modelCapacity(text: string): number | undefined {
  const value = text.trim()
  if (value === '') return undefined
  const match = /^(\d+(?:\.\d+)?)([km])?$/i.exec(value)
  if (match === null) return Number.NaN
  const suffix = match[2]?.toLowerCase(), scale = suffix === 'k' ? 1000 : suffix === 'm' ? 1_000_000 : 1
  const count = Number(match[1]) * scale, rounded = Math.round(count)
  return Math.abs(count - rounded) < 1e-6 ? rounded : count
}
/**
 * 检查模型标识唯一性及容量范围。
 * @param rows - 可见模型草稿。
 * @returns 首个校验错误；通过时为 undefined。
 */
export function modelFailure(rows: readonly ModelDraft[]): 'modelIdInvalid' | 'modelDuplicate' | 'modelCapacityInvalid' | undefined {
  const ids = new Set<string>()
  for (const row of rows) {
    const id = row.id.trim()
    if (id === '') return 'modelIdInvalid'
    if (ids.has(id)) return 'modelDuplicate'
    ids.add(id)
    for (const raw of [row.contextWindow, row.maxTokens]) {
      const value = modelCapacity(raw)
      if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) return 'modelCapacityInvalid'
    }
  }
  return undefined
}
/**
 * 把已验证输入合并回原模型记录。
 * @param rows - 已通过 modelFailure 的草稿。
 * @returns 保留未编辑字段的可持久化模型数组。
 */
export function modelValues(rows: readonly ModelDraft[]): Record<string, SettingValue>[] {
  return rows.map((row) => {
    const value = { ...row.original, id: row.id.trim() }
    const fields = { name: row.name.trim() || undefined,
      contextWindow: modelCapacity(row.contextWindow), maxTokens: modelCapacity(row.maxTokens) }
    for (const [key, field] of Object.entries(fields)) {
      if (field === undefined) Reflect.deleteProperty(value, key)
      else Reflect.set(value, key, field)
    }
    return value
  })
}
