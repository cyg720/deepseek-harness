import { defineConfig } from 'tsdown'

/** Build the package root and invariant companion as independent bundles. */
/*
 * 文件职责：配置目标轮次驱动包及其不变量伴生入口的构建。
 * 技术维度：使用 tsdown 将两个 tsc ESM 入口独立打包给 Node.js 运行时。
 * 产品维度：支持目标任务按轮次持续推进，并提供可选的运行时装配检查。
 * 逻辑维度：配置数组依次处理主入口 index 和伴生入口 invariant。
 * 关键边界：本文件只决定打包，不改变目标轮次行为；声明文件仍由 tsc 生成。
 * 新手阅读建议：先理解两个 entry 分别对应产品逻辑和检查逻辑，再看共享构建参数。
 */
export default defineConfig([
  // 包根入口：目标轮次驱动的主要运行时插件。
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
  // 不变量入口：目标轮次驱动的装配关系检查。
  {
    entry: ['lib/types/invariant.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
])
