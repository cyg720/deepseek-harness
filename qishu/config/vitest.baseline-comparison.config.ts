/** 跨版本性能对照独立入口；调用方明确提供同一归档目录和 Chromium 路径。 */
import { defineConfig } from 'vitest/config'
import base from '../../vitest.web.perf.config.ts'

export default defineConfig({
  ...base,
  test: { ...base.test, include: ['benchmarks/qs/baseline-comparison.perf.ts'], testTimeout: 1_800_000 },
})
