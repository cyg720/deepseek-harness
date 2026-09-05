import { defineConfig } from 'tsdown'

/**
 * Build the engine and worker separately so each inlines shared modules; a
 * multi-entry build creates an unlisted chunk. The path-loaded worker is
 * CommonJS because pkg's VFS Worker hook compiles it in that format.
 */
/*
 * 文件职责：分别构建工作流引擎 ESM 入口和通过文件加载的 CommonJS Worker。
 * 技术维度：使用 tsdown 单入口构建规避未列入发布清单的共享 chunk，并兼容 pkg 的虚拟文件系统 Worker 钩子。
 * 产品维度：让工作流既能在普通 Node 环境运行，也能在打包后的单文件可执行程序中启动工作线程。
 * 逻辑维度：第一项构建 index 与 invariant ESM，第二项单独构建 worker.cjs。
 * 关键边界：Worker 必须保持 CommonJS；把两个配置合并为多入口会生成 files 白名单之外的共享文件。
 * 新手阅读建议：先看两个 format 的差异，再沿运行时代码查找 worker.cjs 的文件路径加载位置。
 */
export default defineConfig([
  // 引擎入口：输出主插件和不变量伴生模块的 ESM 产物。
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
  // Worker 入口：输出供 pkg VFS Worker 钩子加载的 CommonJS 文件。
  {
    entry: ['lib/types/worker.js'],
    outDir: 'lib',
    format: ['cjs'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
])
