import { defineConfig } from 'tsdown'

/**
 * acp-agent ships TWO entries: the plugin (`index`) and the CLI `bin` (`bin`),
 * the latter referenced by package.json `bin`/`exports["./bin"]`. The root
 * tsdown builds only `lib/types/index.js`, so this override adds
 * `lib/types/bin.js`. Declarations come from `tsc -b` (dts: false),
 * matching every package.
 */
/**
 * 文件职责：配置 ACP 示例的插件入口、不变量入口和命令行入口构建。
 * 技术维度：使用 tsdown 将三个 tsc 产物合并到同一 Node.js ESM 输出目录。
 * 产品维度：产出既可作为 Cordis 插件装配、又可从命令行启动的 ACP 演示程序。
 * 逻辑维度：entry 同时列出 index、invariant 和 bin，其他选项遵循仓库统一发布约定。
 * 关键边界：package.json 的 bin 与 exports 必须同步指向产物；此示例仍需真实 API 密钥运行完整流程。
 * 新手阅读建议：先区分三个入口的使用者，再对照 package.json 查看它们如何暴露。
 */
export default defineConfig({
  entry: ['lib/types/index.js', 'lib/types/invariant.js', 'lib/types/bin.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
