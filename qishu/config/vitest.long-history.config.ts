/** 奇术手动浏览器性能配置独立于 Host 源程序，复用官方 Web 性能运行环境。 */
import { defineConfig } from 'vitest/config'
import base from '../../vitest.web.perf.config.ts'

export default defineConfig({
  ...base,
  // 跨版本对照需要专用归档与浏览器参数，独立配置启动，普通容量测量不隐含这些前置。
  test: { ...base.test, include: ['benchmarks/qs/long-history.perf.ts', 'benchmarks/qs/resource-release.perf.ts'], testTimeout: 1_800_000 },
})
