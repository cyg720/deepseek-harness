/**
 * 文件职责：验证 Web 构建产物包含正确的 PWA 清单、入口引用和自适应主题 favicon。
 * 技术维度：使用 Vitest、Node 异步文件读取和正则表达式检查真实 dist 静态文件。
 * 产品维度：保证浏览器可安装 Web 应用，并在浅色/深色系统主题中显示清晰图标。
 * 逻辑维度：读取 index 与 manifest 比较安装元数据，再读取 SVG 检查默认黑色和深色白色覆盖。
 * 关键边界：测试依赖已构建的 apps/web/dist；清单字段和 favicon 媒体查询属于发布约定。
 * 新手阅读建议：先看 DIST_ROOT，再按两个 it 分别理解安装能力和图标主题切换。
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { expect, it } from 'vitest'

// 相对当前测试模块解析的 Web 构建输出绝对目录。
const DIST_ROOT = fileURLToPath(new URL('../dist', import.meta.url))

// 验证清单链接及全部安装元数据；异步返回 Promise<void>。
it('ships install metadata with the built web application', async () => {
  // 构建后的入口 HTML 文本。
  const index = await readFile(join(DIST_ROOT, 'index.html'), 'utf8')
  expect(index).toContain('<link rel="manifest" href="./manifest.webmanifest" />')

  // JSON 解析后的清单未知值；用完整结构断言收窄其内容。
  const manifest: unknown = JSON.parse(await readFile(join(DIST_ROOT, 'manifest.webmanifest'), 'utf8'))
  expect(manifest).toEqual({
    id: '/',
    name: 'DeepSeek Harness',
    short_name: 'DSH',
    start_url: '/',
    scope: '/',
    display: 'fullscreen',
    icons: [{
      src: '/favicon.svg',
      sizes: 'any',
      type: 'image/svg+xml',
      purpose: 'any',
    }],
  })
})

// 验证 favicon 的浅色默认标记和深色媒体查询覆盖。
it('ships a favicon that switches to a light mark under dark color scheme', async () => {
  // 构建后的 SVG favicon 文本。
  const favicon = await readFile(join(DIST_ROOT, 'favicon.svg'), 'utf8')
  // The light fill must live inside the dark-scheme media query, so the icon
  // stays black in light mode and only turns white under a dark scheme.
  // 白色填充必须位于深色媒体查询内，默认路径仍为黑色。
  expect(favicon).toMatch(/@media \(prefers-color-scheme: dark\)\s*{\s*path\s*{[^}]*fill:\s*#fff/i)
  expect(favicon).toContain('fill="#000"')
})
