/**
 * 文件职责：在 Web 测试基础配置上定义手动高基数性能诊断通道。
 * 技术维度：使用 Vitest 配置合并，复用 Web 插件与环境并替换测试清单和超时。
 * 产品维度：开发者可运行大数据量性能探针而不拖慢常规 CI。
 * 逻辑维度：展开基础配置和 test 字段，再启用 perf 文件、控制台直通与长超时。
 * 关键边界：该通道不属于默认 Web CI；单测允许 10 分钟且控制台不会被拦截。
 * 新手阅读建议：先读 vitest.web.config.ts，再看本文件只覆盖哪些字段。
 */
import { defineConfig } from 'vitest/config'
import webConfig from './vitest.web.config.ts'
import { vitestExecArgv } from './vitest.shared.ts'

// Manual high-cardinality diagnostics stay outside every default Vitest
// inventory and therefore outside CI's executed test lanes.
export default defineConfig({
  ...webConfig,
  test: {
    ...webConfig.test,
    // Memory diagnostics use forced-GC baselines only in this manual inventory.
    execArgv: [...vitestExecArgv, '--expose-gc'],
    include: [
      'apps/web/tests/**/*.perf.ts',
      'packages/client/ui-conversation/tests/**/*.perf.client.ts',
    ],
    disableConsoleIntercept: true,
    hookTimeout: 180_000,
    testTimeout: 600_000,
  },
})
