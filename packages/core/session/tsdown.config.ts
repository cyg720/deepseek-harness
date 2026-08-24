import { defineConfig } from 'tsdown'

/** Build the package root and optional invariant companion as independent bundles. */
/**
 * 文件职责：配置核心会话包和可选不变量伴生模块的独立构建。
 * 技术维度：使用 tsdown 从 TypeScript 构建产物生成两个 Node.js ESM bundle。
 * 产品维度：提供会话生命周期与事件接口，并允许应用按需装配关系检查。
 * 逻辑维度：第一项输出 index，第二项输出 invariant，其他构建参数保持一致。
 * 关键边界：会话格式和事件兼容性由源码协议管理；此配置不负责生成类型声明。
 * 新手阅读建议：先阅读会话公共 API，再理解为何检查模块需要独立入口。
 */
export default defineConfig([
  // 包根入口：会话服务、事件类型和生命周期 API。
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
  // 可选不变量入口：会话运行时关系检查。
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
