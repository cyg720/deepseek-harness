/** 审查隔离配置：只执行本次证据探针，不修改生产测试的通过条件。 */
import { createRequire } from 'node:module'
import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'
import { standardDecoratorPlugin } from '../../../vitest.shared.ts'
const require = createRequire(new URL('../../../packages/qs/qs-ui-tool/package.json', import.meta.url))
export default defineConfig({ resolve: { alias: { 'react/jsx-dev-runtime': require.resolve('react/jsx-dev-runtime'), 'react/jsx-runtime': require.resolve('react/jsx-runtime'), 'react': require.resolve('react') } }, plugins: [tsconfigPaths({ projects: ['./tsconfig.base.json'] }), standardDecoratorPlugin()], test: { include: ['qishu/tests/review-v1/review.spec.tsx'], environment: 'jsdom' } })
