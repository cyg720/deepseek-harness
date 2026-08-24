import { defineConfig } from 'tsdown'

/** Build the package root and optional invariant companion as independent bundles. */
/**
 * 文件职责：配置用户设置能力主入口和可选不变量伴生入口的构建。
 * 技术维度：使用 tsdown 将两个 tsc 中间入口独立输出为 Node.js ESM。
 * 产品维度：让应用读取和更新用户设置，并可按需检查设置服务装配关系。
 * 逻辑维度：配置数组依次构建 index 与 invariant，共用目标、输出和声明策略。
 * 关键边界：设置校验与持久化不在此文件中；clean 关闭以配合仓库统一构建顺序。
 * 新手阅读建议：先识别两个 entry 的职责，再理解 dts:false 表示声明由 tsc 提前生成。
 */
export default defineConfig([
  // 包根入口：用户设置服务定义和插件运行时。
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
  // 可选不变量入口：设置服务关系检查。
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
