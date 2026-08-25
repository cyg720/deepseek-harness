import { defineConfig } from 'tsdown'

/** Build both public entries separately so each inlines shared internal helpers. */
/*
 * 文件职责：配置时间上下文包的主入口和不变量入口独立构建。
 * 技术维度：使用 tsdown 分别打包两个 ESM 入口，使共享内部辅助代码进入各自产物。
 * 产品维度：为模型请求提供当前时间信息，并让相关运行时关系可以独立检查。
 * 逻辑维度：第一项构建 index，第二项构建 invariant，两个 bundle 都直接面向 Node.js。
 * 关键边界：独立内联会产生少量重复代码，但避免发布未声明的共享内部入口。
 * 新手阅读建议：重点理解“两个公共入口各自包含辅助代码”，再看完全对称的配置对象。
 */
export default defineConfig([
  // 包根入口：向请求上下文贡献时间信息。
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
  // 不变量入口：时间上下文装配关系的检查模块。
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
