/** 大工具载荷的手动浏览器诊断；不将未校准时间加入 CI 门禁。 */
import { defineConfig } from 'vitest/config'
import base from '../../vitest.web.perf.config.ts'

export default defineConfig({
  ...base,
  test: { ...base.test, include: ['benchmarks/qs/tool-payload.perf.ts'], testTimeout: 600_000 },
})
