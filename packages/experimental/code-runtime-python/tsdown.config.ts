/**
 * 文件职责：声明 Python 代码运行时包的 TypeScript Node 构建入口。
 * 技术维度：使用 tsdown 输出单个 ESM 构件，Python 源码由发布清单原样携带。
 * 产品维度：Harness 可通过 CPython 子进程执行模型生成代码。
 * 逻辑维度：打包 index 与 invariant 编译入口，输出到 lib 且不清理其他资产。
 * 关键边界：`py/` 不参与 TypeScript 构建；clean 必须关闭以保留并行产物。
 * 新手阅读建议：先区分 TS 控制面和 py 执行面，再查看 package.json files。
 */
import { defineConfig } from 'tsdown'

/**
 * Single ESM bundle. The Python-side code is not TypeScript and ships verbatim
 * under `py/` (whitelisted in package.json `files`) — no build step needed.
 */
/*
 * 生成 Node ESM 构建配置；输入是单个配置对象，返回 tsdown 默认配置。
 * 使用示例：运行 `pnpm --filter @deepseek-ai/dsh-code-runtime-python bundle`。
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
})
