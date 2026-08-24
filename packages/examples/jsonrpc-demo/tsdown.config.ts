import { defineConfig } from 'tsdown'

/** Builds each published entry as a self-contained file admitted by the package whitelist. */
/**
 * 文件职责：把 JSON-RPC 示例的四个发布入口分别构建为包白名单允许的自包含文件。
 * 技术维度：使用 tsdown 多配置 ESM 构建，并关闭 code splitting 防止额外共享 chunk。
 * 产品维度：同时提供插件、诊断、源码 CLI 和打包 CLI 演示入口，确保安装后都能直接运行。
 * 逻辑维度：配置数组依次构建 index、invariant、bin、packaged-bin，其他输出参数完全一致。
 * 关键边界：package files 白名单只接纳已声明入口；不能开启代码拆分或合并为产生额外文件的构建。
 * 新手阅读建议：先按四个 entry 对照 package.json exports，再看 codeSplitting:false 的发布原因。
 */
export default defineConfig([
  // 插件入口：JSON-RPC 示例的主要 Cordis 组合。
  {
    entry: ['lib/types/index.js'], outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
    fixedExtension: false, outputOptions: { codeSplitting: false }, dts: false, clean: false,
  },
  // 不变量入口：示例包的诊断伴生模块。
  {
    entry: ['lib/types/invariant.js'], outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
    fixedExtension: false, outputOptions: { codeSplitting: false }, dts: false, clean: false,
  },
  // 源码 CLI 入口：开发环境直接启动示例。
  {
    entry: ['lib/types/bin.js'], outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
    fixedExtension: false, outputOptions: { codeSplitting: false }, dts: false, clean: false,
  },
  // 打包 CLI 入口：单文件可执行程序使用的启动路径。
  {
    entry: ['lib/types/packaged-bin.js'], outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
    fixedExtension: false, outputOptions: { codeSplitting: false }, dts: false, clean: false,
  },
])
