/**
 * 文件职责：声明压缩能力包两个公开 Node 入口的独立构建方式。
 * 技术维度：使用 tsdown 为 index 与 invariant 分别生成无代码分割的 ESM 文件。
 * 产品维度：安装后的压缩服务和诊断 companion 都能从白名单路径直接加载。
 * 逻辑维度：定义两个结构对称的配置项，仅入口文件不同。
 * 关键边界：每个公开入口必须自包含，不能产生 package.json 未列出的共享分块。
 * 新手阅读建议：先比较两项唯一的 entry 差异，再理解 codeSplitting 为何关闭。
 */
import { defineConfig } from 'tsdown'

/** Builds each published entry as a self-contained file admitted by the package whitelist. */
/**
 * 为两个发布入口生成自包含构建配置；参数是配置数组，返回 tsdown 可消费的默认配置。
 * 使用示例：运行 `pnpm --filter @deepseek-ai/dsh-compaction bundle` 时自动加载。
 */
export default defineConfig([
  {
    entry: ['lib/types/index.js'], outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
    fixedExtension: false, outputOptions: { codeSplitting: false }, dts: false, clean: false,
  },
  {
    entry: ['lib/types/invariant.js'], outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
    fixedExtension: false, outputOptions: { codeSplitting: false }, dts: false, clean: false,
  },
])
