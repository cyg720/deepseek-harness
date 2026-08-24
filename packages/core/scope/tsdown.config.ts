import { defineConfig } from 'tsdown'

/** Build the package root and optional invariant companion as independent bundles. */
/**
 * 文件职责：配置作用域核心包和可选不变量伴生模块的独立构建。
 * 技术维度：使用 tsdown 输出两个 Node.js ESM bundle，并让 invariant 外部引用根包。
 * 产品维度：保证作用域载体身份在不同入口之间共享，避免同一对象被误判为不同作用域。
 * 逻辑维度：第一项构建 index，第二项构建 invariant，并通过 neverBundle 保留根入口实例。
 * 关键边界：不能把 @deepseek-ai/dsh-scope 内联进 invariant，否则 WeakMap 身份会跨 bundle 分裂。
 * 新手阅读建议：先比较两个 entry，再重点理解第二项 deps.neverBundle 对对象身份的影响。
 */
export default defineConfig([
  // 包根入口：拥有作用域载体和共享 WeakMap 身份。
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
  // 不变量入口：独立发布检查逻辑，但必须引用根入口的载体实例。
  {
    entry: ['lib/types/invariant.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    // Preserve the root entry's carrier WeakMap identity across bundles.
    // 保留根入口的载体 WeakMap 身份，禁止在当前 bundle 中复制一份实现。
    deps: { neverBundle: ['@deepseek-ai/dsh-scope'] },
  },
])
