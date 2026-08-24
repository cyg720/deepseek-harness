import { defineConfig } from 'tsdown'

/** Build the package root and invariant companion as independent bundles. */
/**
 * 文件职责：配置沙箱策略包和不变量伴生模块的独立构建。
 * 技术维度：使用 tsdown 将两个 tsc 中间入口输出为 Node.js ESM。
 * 产品维度：为代码执行提供可组合的权限策略，并允许部署检查策略装配是否完整。
 * 逻辑维度：第一项处理主入口 index，第二项处理检查入口 invariant。
 * 关键边界：安全策略内容不由此文件定义；错误修改入口可能导致策略插件未进入发布产物。
 * 新手阅读建议：先阅读对应 src/index.ts 和 src/invariant.ts，再回来理解两个 bundle 的分工。
 */
export default defineConfig([
  // 包根入口：沙箱策略的服务定义和运行时插件。
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
  // 不变量入口：策略装配关系的运行时检查模块。
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
