/** 供应商创建和编辑共享字段规则，协议选项始终来自官方 schema。 */
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import type { ModelsSettingsFace } from '@deepseek-ai/dsh-client-ui-settings-models/client'
/**
 * 检查只写密钥输入，空字段表示保持现有认证方式。
 * @param key - 未修剪的输入文本。
 * @returns 是否需要阻止保存或查询。
 */
export function invalidCredentialInput(key: string): boolean {
  const value = key.trim(), first = value[0]
  return key.length > 0 && (value.length === 0 || !/^[\x21-\x7E]+$/.test(value)
    || /^[A-Z][A-Z0-9_]*=[^=]/.test(value)
    || ((first === '"' || first === "'" || first === '`') && value.length > 1 && value.endsWith(first)))
}
/**
 * 读取可创建路线的协议枚举，不假设固定协议列表。
 * @param namespace - 官方 pi-ai 设置描述。
 * @param schema - 官方 schema 访问服务。
 * @returns 当前适配器提供的字符串协议选项。
 */
export function providerProtocols(namespace: SettingsNamespaceView, schema: ModelsSettingsFace['schema']): string[] {
  const node = schema.nodeAtPath(schema.rehydrate(namespace.schema), ['providers', '\u0000probe', 'api'])
  const union = node as { type?: string; list?: readonly { value?: unknown }[] } | undefined
  if (union?.type !== 'union' || union.list === undefined) return []
  return union.list.map(item => item.value).filter((value): value is string => typeof value === 'string')
}
