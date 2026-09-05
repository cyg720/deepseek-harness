import { defineConfig } from 'tsdown'

/** Build the package root and invariant companion as independent bundles. */
/*
 * 文件职责：配置默认模型选择包及其不变量伴生模块的独立构建。
 * 技术维度：使用 tsdown 从 tsc 产物生成 Node.js ESM 包入口。
 * 产品维度：让代理在未显式指定时获得默认模型，并允许部署按需装配一致性检查。
 * 逻辑维度：第一项构建 index，第二项构建 invariant，其余目标和输出参数保持一致。
 * 关键边界：构建不生成声明也不清空 lib；这两项工作由仓库级 TypeScript 流程管理。
 * 新手阅读建议：先认清 lib/types 是输入、lib 是输出，再比较两个入口的用途。
 */
export default defineConfig([
  // 包根入口：默认模型选择插件的运行时实现。
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
