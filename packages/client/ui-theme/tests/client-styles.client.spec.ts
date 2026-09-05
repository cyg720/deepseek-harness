// @vitest-environment jsdom
/** Dynamic ui-theme entry owns the global styles in dependency order. */
/*
 * 文件职责：验证客户端主题插件按依赖顺序挂载全局样式，并在释放时全部移除。
 * 技术维度：使用 jsdom、Vitest、Cordis fiber 和带 data-plugin 属性的动态 style 元素。
 * 产品维度：保证主题基础、设计平台、滚动条、渐变文字和代码高亮按正确层叠顺序生效。
 * 逻辑维度：清理残留样式，装配主题，读取并断言样式标识顺序，释放后断言数量为零。
 * 关键边界：测试依赖 DOM 环境；PLUGIN_ID 必须与动态样式安装器写入的属性完全一致。
 * 新手阅读建议：先看 afterEach 的隔离方式，再比较期望数组与 installThemeStyles 的装载顺序。
 */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { installThemeStyles } from '../src/client/styles.ts'

// 动态 style 标签使用的插件标识；必须与主题包正式名称一致。
const PLUGIN_ID = '@deepseek-ai/dsh-client-ui-theme'

// 每个测试后的清理函数；node 是匹配到的 style 元素，逐个从 document.head 移除。
afterEach(() => {
  document.head.querySelectorAll(`style[data-plugin="${PLUGIN_ID}"]`).forEach((node) => { node.remove() })
})

// 客户端主题全局样式测试套件。
describe('ui-theme client styles', () => {
  // 验证装载顺序和 fiber 释放；异步返回 Promise<void>。
  it('mounts every global sheet in dependency order and removes them on dispose', async () => {
    // 本用例独立 Cordis 上下文。
    const ctx = new Context()
    // 安装主题样式的插件 fiber；scope 是当前插件作用域，释放 fiber 会撤销其 effects。
    const fiber = ctx.plugin({
      apply(scope) { installThemeStyles(scope) },
    })
    await fiber.await()

    // 当前插件写入 head 的全部样式元素；展开为数组以检查稳定顺序。
    const styles = [...document.head.querySelectorAll<HTMLStyleElement>(`style[data-plugin="${PLUGIN_ID}"]`)]
    // style 是单个动态样式标签；提取 data-plugin-css 作为来源标识。
    expect(styles.map(style => style.dataset.pluginCss)).toEqual([
      `${PLUGIN_ID}/base.css`,
      `${PLUGIN_ID}/corner-shape.css`,
      `${PLUGIN_ID}/design-platform.css`,
      `${PLUGIN_ID}/scrollbar.css`,
      `${PLUGIN_ID}/gradient-shadow-text.css`,
      `${PLUGIN_ID}/shiki.css`,
    ])
    await fiber.dispose()
    expect(document.head.querySelectorAll(`style[data-plugin="${PLUGIN_ID}"]`)).toHaveLength(0)
  })
})
