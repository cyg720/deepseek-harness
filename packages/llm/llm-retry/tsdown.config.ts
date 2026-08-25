import { defineConfig } from 'tsdown'

/** Build the package root and invariant companion as independent bundles. */
/*
 * 文件职责：配置大模型重试包和不变量伴生模块的独立构建。
 * 技术维度：使用 tsdown 把 tsc 产物打包为 Node.js ESM，目标语法为 ES2024。
 * 产品维度：让模型调用具备可配置的重试能力，并能在装配时检查相关关系。
 * 逻辑维度：配置数组分别构建 index 与 invariant 两个公共入口。
 * 关键边界：重试次数等产品参数不在此配置中；这里仅控制发布产物的入口和格式。
 * 新手阅读建议：不要把构建配置与重试策略混淆，先确认 entry 对应的源码模块。
 */
export default defineConfig([
  // 包根入口：大模型重试能力的主要运行时插件。
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
  // 不变量入口：重试能力装配关系的可选检查。
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
