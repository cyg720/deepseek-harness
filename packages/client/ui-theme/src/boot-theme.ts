/**
 * ================================ 文件注释 ================================
 * 【文件职责】浏览器"插件激活前"时段的主题引导行：每次 index 渲染嵌入当前
 *             耐久的内置偏好，浏览器只解析 system，然后写 ui-layout 的
 *             ThemePresenter 在客户端插件树激活后拥有的同一组 DOM 字段。
 * 【技术维度】宿主 web 服务器 IndexInjection：body 开标签后紧跟内联脚本（壳挂载
 *             与模块脚本之前），避免首帧闪烁（FOUC）。
 * 【产品维度】应用首屏加载即呈现正确明暗主题。
 * 【逻辑维度】bootThemeScript 生成内联脚本（解析 system → 设置 color-scheme 与
 *             data-ds-dark-theme）→ bootThemeInjection 包装成 body 脚本行。
 * 【关键边界】只处理经模式校验的内置偏好；无 matchMedia 时 system 视为浅色。
 * 【新手阅读建议】与 ui-layout/theme-presenter.ts 的 DOM 字段对照。
 * ==========================================================================
 */
/**
 * Theme bootstrap row for the browser's pre-plugin interval. Each index
 * render embeds the current durable built-in preference; the browser resolves
 * only `system`, then writes the same DOM fields ui-layout's ThemePresenter
 * owns after the client plugin tree activates.
 */

import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'
import { DEFAULT_PREFERENCE, type ThemePreference } from './theme-settings.ts'

/** Build the inline script body for one schema-validated built-in preference. */
function bootThemeScript(preference: ThemePreference): string {
  return `(() => {
  const preference = ${JSON.stringify(preference)}
  const systemDark = preference === 'system'
    && typeof matchMedia !== 'undefined'
    && matchMedia('(prefers-color-scheme: dark)').matches
  const dark = preference === 'dark' || systemDark
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  document.body.toggleAttribute('data-ds-dark-theme', dark)
})()`
}

/**
 * The theme bootstrap as an injection row: an inline script immediately after
 * the opening body tag, before the shell mount and module script.
 * @param preference - Current Host-backed built-in preference.
 * @returns the body script row.
 */
export function bootThemeInjection(
  preference: ThemePreference = DEFAULT_PREFERENCE,
): IndexInjection {
  return { kind: 'script', placement: 'body', text: bootThemeScript(preference) }
}
