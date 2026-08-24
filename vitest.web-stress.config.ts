/**
 * 文件职责：定义 Web 浏览器压力测试的独立 Vitest 运行通道。
 * 技术维度：使用 Vitest、tsconfig 路径解析插件和共享 Node 执行参数。
 * 产品维度：开发者可手动验证大量推理块等高负载场景的稳定性。
 * 逻辑维度：限定 stress 文件、延长超时并关闭文件级并行。
 * 关键边界：该通道默认不进入普通测试或 CI，最长单测允许 10 分钟。
 * 新手阅读建议：先看 include，再理解三个时序配置为何适合压力场景。
 */
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'
import { vitestExecArgv } from './vitest.shared.ts'

/** Opt-in browser performance lane; no default Vitest config includes *.stress.ts. */
/**
 * 导出压力测试配置；无参数，返回 Vitest 配置对象。
 * 使用示例：`pnpm exec vitest run --config vitest.web-stress.config.ts`。
 */
export default defineConfig({
  plugins: [tsconfigPaths({ projects: ['./tsconfig.base.json'] })],
  test: {
    execArgv: vitestExecArgv,
    include: ['apps/web/stress-tests/**/*.stress.ts'],
    testTimeout: 600_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
})
