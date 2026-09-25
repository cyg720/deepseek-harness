/** 编码前机制探针使用源码路径，避免依赖已构建产物。 */
import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'
import { standardDecoratorPlugin } from '../../../vitest.shared.ts'

export default defineConfig({
  plugins: [tsconfigPaths({ projects: ['./tsconfig.base.json'] }), standardDecoratorPlugin()],
  test: { include: ['qishu/tests/m0/m0.spec.ts'], environment: 'node' },
})
