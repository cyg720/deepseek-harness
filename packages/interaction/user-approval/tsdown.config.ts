import { defineConfig } from 'tsdown'

/**
 * Build index and the invariant companion as separate single-entry bundles.
 * Both entries import src/types.ts (the browser-safe subpath), so a
 * multi-entry build emits a shared chunk the package's exact `files`
 * whitelist omits; separate builds inline it.
 */
/*
 * 文件职责：分别构建用户审批主入口和不变量伴生入口，确保共享类型被各自内联。
 * 技术维度：使用 tsdown 两次单入口 ESM 构建，避免多入口产生发布白名单未包含的共享 chunk。
 * 产品维度：让危险操作的用户批准流程和诊断模块都能从完整发布包中可靠加载。
 * 逻辑维度：第一项构建 index，第二项构建 invariant，二者各自包含浏览器安全的 types 子路径。
 * 关键边界：不能合并为一次多入口构建；package.json 的精确 files 清单不会包含额外共享 chunk。
 * 新手阅读建议：先理解 src/types.ts 被两个入口复用，再看为何重复少量代码比缺失发布文件更安全。
 */
export default defineConfig([
  // 主入口：用户审批服务定义和运行时实现。
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
  // 不变量入口：用户审批装配关系检查。
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
