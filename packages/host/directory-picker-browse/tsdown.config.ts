/**
 * 文件职责：声明应用内目录浏览主机后端的 Node 构建入口。
 * 技术维度：使用 tsdown 把 index 与 invariant 编译产物打包为 ESM。
 * 产品维度：Web 目录选择器可通过主机后端列出目录并创建文件夹。
 * 逻辑维度：配置入口数组、lib 输出目录、Node 平台与 ES2024 目标。
 * 关键边界：后端只运行在主机侧，文件系统权限与路径校验由实现负责。
 * 新手阅读建议：先看入口与 platform，再到 src/index.ts 阅读列表和创建操作。
 */
import { defineConfig } from 'tsdown'

/** Node-only backend: listing and creation primitives over the host filesystem. */
/*
 * 生成仅 Node 使用的目录浏览后端配置；返回单项 tsdown 配置数组。
 * 使用示例：运行 `pnpm --filter @deepseek-ai/dsh-host-directory-picker-browse bundle`。
 */
export default defineConfig([
  {
    entry: ['lib/types/index.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
])
