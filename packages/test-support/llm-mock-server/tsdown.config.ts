/**
 * 文件职责：声明 LLM 模拟服务器两个公开 Node 入口的独立构建方式。
 * 技术维度：使用 tsdown 输出无代码分割的 ESM index 和 invariant 文件。
 * 产品维度：恢复测试可安装并启动脚本化 HTTP/SSE 故障服务器及其诊断 companion。
 * 逻辑维度：以对称配置分别打包主入口和 invariant 入口。
 * 关键边界：公开文件白名单不接纳额外共享分块，因此必须关闭 codeSplitting。
 * 新手阅读建议：先看两个 entry，再结合 package.json 的 files 清单理解自包含要求。
 */
import { defineConfig } from 'tsdown'

/** Builds each public entry as a self-contained file admitted by the package whitelist. */
/*
 * 生成模拟服务器公开入口配置；输入为两项配置数组，返回 tsdown 默认配置。
 * 使用示例：运行 `pnpm --filter @deepseek-ai/dsh-llm-mock-server bundle` 时自动加载。
 */
export default defineConfig([
  {
    entry: ['lib/types/index.js'], outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
    fixedExtension: false, outputOptions: { codeSplitting: false }, dts: false, clean: false,
  },
])
