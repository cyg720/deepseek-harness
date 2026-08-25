import { defineConfig } from 'tsdown'

/** Build the package root and optional invariant companion as independent bundles. */
/*
 * 文件职责：配置代理循环核心入口和可选不变量伴生入口的独立构建。
 * 技术维度：使用 tsdown 输出 Node.js ESM，并从 tsc 的 lib/types 目录读取入口。
 * 产品维度：提供驱动模型、工具和会话事件的核心循环，同时允许诊断装配关系。
 * 逻辑维度：配置数组分别构建 index 与 invariant，不互相依赖发布入口。
 * 关键边界：代理循环是架构核心；此文件只能调整打包，不能借构建配置改变循环行为。
 * 新手阅读建议：先把 index 视为必需运行时、invariant 视为可选检查，再阅读具体源码。
 */
export default defineConfig([
  // 包根入口：代理循环的主要运行时代码。
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
  // 可选不变量入口：检查循环依赖和拥有关系。
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
