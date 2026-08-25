import { defineConfig } from 'tsdown'

/** Build the package root and invariant companion as independent bundles. */
/*
 * 文件职责：配置计划任务能力主入口和不变量伴生入口的独立构建。
 * 技术维度：使用 tsdown 将 tsc 产物打包为 Node.js ES2024 模块。
 * 产品维度：让提醒与后续任务调度能力可被应用装配，并提供状态关系检查入口。
 * 逻辑维度：配置数组依次构建 index 和 invariant，输出规则保持对称。
 * 关键边界：计划状态以会话日志为准；本文件只打包，不能承载计时或持久化逻辑。
 * 新手阅读建议：结合 schedule 目录规则理解主入口，再把 invariant 看作独立的诊断伴生模块。
 */
export default defineConfig([
  // 包根入口：计划任务服务和运行时插件。
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
  // 不变量入口：计划任务拥有关系的运行时检查。
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
