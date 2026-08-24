import { defineConfig } from 'tsdown'

/** Build the package root and companions as independent bundles. */
/**
 * 文件职责：配置核心 Agent 包根入口与不变量伴生入口的独立构建。
 * 技术维度：使用 tsdown 将 tsc 产物分别打包为面向 Node.js 2024 的 ESM。
 * 产品维度：为代理生命周期能力提供可发布运行时，同时让不变量检查按需加载。
 * 逻辑维度：配置数组的第一项构建 index，第二项构建 invariant，二者共享输出约定。
 * 关键边界：入口来自 lib/types；声明生成和目录清理由仓库其他构建步骤负责。
 * 新手阅读建议：并排比较两个配置对象，注意它们只有 entry 不同。
 */
export default defineConfig([
  // 包根入口：输出 Agent 的主要服务定义和运行时 API。
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
  // 不变量入口：输出可选的运行时关系检查伴生模块。
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
