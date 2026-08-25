import { defineConfig } from 'tsdown'

/** Build the package root and invariant companion as independent bundles. */
/*
 * 文件职责：配置目标能力主包及其不变量伴生模块的独立构建。
 * 技术维度：使用 tsdown 输出面向 Node.js 2024 的 ESM，并复用 tsc 生成的中间入口。
 * 产品维度：提供目标创建、更新等核心能力的可装配运行时和一致性检查入口。
 * 逻辑维度：第一项构建包根 index，第二项构建 invariant，二者输出到同一 lib 目录。
 * 关键边界：clean 为 false，不能把此配置当作独立清理命令；类型声明不在这里生成。
 * 新手阅读建议：把配置数组看作两个并列产品，先看 entry，再看完全相同的输出参数。
 */
export default defineConfig([
  // 包根入口：目标能力的服务与插件运行时代码。
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
  // 不变量入口：目标能力拥有关系的运行时检查。
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
