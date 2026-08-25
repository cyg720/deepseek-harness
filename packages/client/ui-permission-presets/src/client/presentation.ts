/*
 * ================================ 文件注释 ================================
 * 【文件职责】权限预设的展示转换：机器值 → 用户可见名称；Full access 预设带
 *             产品标签与 GUI 风险门。
 * 【技术维度】纯函数：kebab-case 转标题大小写；风险预设用固定产品名。
 * 【产品维度】权限预设下拉/弹窗中的显示名（含 Full access 特殊标签）。
 * 【逻辑维度】displayPresetName 做 kebab 转换（非 kebab 原样返回）→
 *             displayPermissionPreset 对风险预设返回产品标签。
 * 【关键边界】FULL_ACCESS_PRESET 是要求显式风险门的机器值。
 * 【新手阅读建议】纯函数文件，可直接理解。
 * ==========================================================================
 */
/** Machine value of the preset that requires an explicit GUI risk gate. */
// 需要显式 GUI 风险确认门的预设机器值。
export const FULL_ACCESS_PRESET = 'danger-full-access'

/**
 * Convert conventional kebab-case preset names into user-facing title case.
 * @param name - host-supplied preset label or key.
 * @returns the title-cased conventional key, or a non-kebab label unchanged.
 */
export function displayPresetName(name: string): string {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) return name
  return name.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

/**
 * Render a permission preset under its product label.
 * @param value - preset machine value.
 * @param name - host-supplied preset name.
 * @returns the Full access product label or the conventional display name.
 */
export function displayPermissionPreset(value: string, name: string): string {
  return value === FULL_ACCESS_PRESET ? 'Full access' : displayPresetName(name)
}
