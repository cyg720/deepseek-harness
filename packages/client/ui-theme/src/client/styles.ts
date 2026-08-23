/**
 * ================================ 文件注释 ================================
 * 【文件职责】挂载全局主题样式表：把五张 CSS（基础/设计平台/滚动条/渐变阴影文本/
 *             shiki 代码高亮）注入 document，生命周期精确等于拥有插件的存活期。
 * 【技术维度】Cordis effect + style 标签注入（?inline 导入）；标签带
 *             data-plugin/data-plugin-css 标记便于诊断与清理。
 * 【产品维度】应用全局视觉基础（token 调色板、滚动条、代码高亮等）。
 * 【逻辑维度】installThemeStyles 遍历 STYLES，每张样式一个 effect：创建标签 →
 *             追加 head → 清理时移除。
 * 【关键边界】非浏览器环境直接返回；样式随插件纤维一同卸载。
 * 【新手阅读建议】对照 ui-layout 的 ThemePresenter（样式静态注入 vs 快照动态写）。
 * ==========================================================================
 */
import type { Context } from '@deepseek-ai/cordis'
import base from '../styles/base.css?inline'
import designPlatform from '../styles/design-platform.css?inline'
import scrollbar from '../styles/scrollbar.css?inline'
import gradientShadowText from '../styles/gradient-shadow-text.css?inline'
import shiki from '../styles/shiki.css?inline'

const PLUGIN_ID = '@deepseek-ai/dsh-client-ui-theme'

const STYLES = [
  ['base.css', base],
  ['design-platform.css', designPlatform],
  ['scrollbar.css', scrollbar],
  ['gradient-shadow-text.css', gradientShadowText],
  ['shiki.css', shiki],
] as const

/**
 * Mount the global theme sheets for exactly the owning plugin lifetime.
 * @param ctx - Owning plugin context.
 */
export function installThemeStyles(ctx: Context): void {
  if (typeof document === 'undefined') return
  for (const [name, css] of STYLES) {
    ctx.effect(() => {
      const tag = document.createElement('style')
      tag.dataset.plugin = PLUGIN_ID
      tag.dataset.pluginCss = `${PLUGIN_ID}/${name}`
      tag.textContent = css
      document.head.appendChild(tag)
      return () => { tag.remove() }
    }, `ui-theme: ${name} stylesheet`)
  }
}
