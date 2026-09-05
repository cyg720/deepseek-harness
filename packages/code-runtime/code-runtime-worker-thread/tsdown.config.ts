import { defineConfig } from 'tsdown'

/**
 * Build the index and worker as separate single-entry bundles. The sibling `worker.cjs` is loaded
 * by file and must be CommonJS for pkg's VFS Worker hook. A multi-entry build emits an unlisted
 * shared chunk omitted by the package's exact `files` whitelist; separate builds inline it.
 */
/*
 * 文件职责：分别构建 JavaScript 代码运行时 ESM 入口和文件加载的 CommonJS Worker。
 * 技术维度：使用 tsdown 单入口构建，兼容 pkg 虚拟文件系统并避免未发布的共享 chunk。
 * 产品维度：让模型生成的 JavaScript 可在隔离 Worker 中运行，包括打包后的可执行程序场景。
 * 逻辑维度：第一项输出 index 与 invariant，第二项把 worker 单独输出为 CommonJS。
 * 关键边界：worker.cjs 的格式和路径是运行时加载约定；不可随意改为 ESM 或合并多入口。
 * 新手阅读建议：对照启动 Worker 的源码查看文件名，再比较两个配置对象的 format 与 entry。
 */
export default defineConfig([
  // 主运行时入口：代码运行服务与不变量伴生模块的 ESM 产物。
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
  // Worker 入口：供 pkg 文件钩子加载的 CommonJS 执行脚本。
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
