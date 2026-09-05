import { defineConfig } from 'tsdown'

/**
 * Embed Include while keeping Loader external so the built include tree and
 * app host bind to one Loader peer.
 */
/*
 * 文件职责：配置 app-boot 包的运行时入口和不变量伴生入口构建。
 * 技术维度：使用 tsdown 输出 Node.js ESM，并只内联 Cordis Include 插件、保留 Loader 对等依赖。
 * 产品维度：保证应用启动树与宿主共享同一个 Loader 实例，避免插件装配状态分裂。
 * 逻辑维度：从 tsc 生成的类型构建目录读取两个入口，输出到 lib，并通过 alwaysBundle 嵌入 Include。
 * 关键边界：不能把 Loader 一并内联；声明文件由 tsc 负责，因此 dts 和 clean 均保持关闭。
 * 新手阅读建议：先看 entry 和 outDir，再重点理解 deps.alwaysBundle 为何只列 Include。
 */
export default defineConfig({
  entry: ['lib/types/index.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  deps: {
    alwaysBundle: ['@deepseek-ai/cordis-plugin-include'],
  },
})
