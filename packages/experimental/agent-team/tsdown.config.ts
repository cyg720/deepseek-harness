import { defineConfig } from 'tsdown'

/** Build the runtime and invariant as independent bundles so shared fold code stays package-local. */
/*
 * 文件职责：配置实验性代理团队运行时和不变量伴生模块的独立构建。
 * 技术维度：使用 tsdown 生成两个 Node.js ESM bundle，让共享折叠逻辑分别保持在包内。
 * 产品维度：支持内部试验多代理团队编排，同时保留独立的关系诊断入口。
 * 逻辑维度：第一项打包运行时 index，第二项打包 invariant，两者不发布共享内部入口。
 * 关键边界：该包是私有实验能力，不能被正式发布包或应用作为运行时依赖。
 * 新手阅读建议：先阅读 experimental 目录约束，再比较运行时与检查入口的构建对称性。
 */
export default defineConfig([
  // 实验运行时入口：代理团队状态折叠和编排插件。
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
  // 不变量入口：实验能力的装配关系检查。
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
