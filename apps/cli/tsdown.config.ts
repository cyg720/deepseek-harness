import { defineConfig } from 'tsdown'

/**
 * The dsh CLI ships one entry: the `bin` referenced by package.json `bin`.
 * The root tsdown builds only `lib/types/index.js`, so this override points at
 * `lib/types/bin.js` instead; its reachable mode modules bundle with it.
 * Declarations come from `tsc -b` (dts: false), matching every package.
 */
/**
 * 文件职责：配置 dsh 命令行应用的可执行 bin 入口构建。
 * 技术维度：使用 tsdown 把 tsc 生成的 bin.js 及其可达模式模块打包为 Node.js ESM。
 * 产品维度：产出用户可直接运行的 dsh 命令，承载交互式、无头等命令行模式。
 * 逻辑维度：覆盖仓库默认 index 入口，改从 lib/types/bin.js 构建并输出到 lib。
 * 关键边界：package.json 的 bin 必须与此入口一致；声明和清理由仓库统一流程负责。
 * 新手阅读建议：先对照 package.json 的 bin 字段，再沿 bin.ts 查看各命令模式如何被引入。
 */
export default defineConfig({
  entry: ['lib/types/bin.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
