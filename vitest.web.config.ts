/**
 * 文件职责：配置 Web 浏览器测试通道，包括真实宿主入口、交互快照和无密钥重放场景。
 * 技术维度：使用 Vitest/Vite、tsconfig 路径插件、标准装饰器预转换和 Node 环境参数。
 * 产品维度：在 CI 与本地验证真实 Web 应用装配、HMR 和浏览器交互不会回归。
 * 逻辑维度：尽力加载 .env，配置源码路径与装饰器插件，限定 Web 测试 glob、超时和串行执行。
 * 关键边界：缺少 .env 可以接受；真实模型用例自行跳过，记录/刷新快照必须显式启用。
 * 新手阅读建议：先看 try/catch 环境加载，再阅读 plugins，最后看 test.include 与并行策略。
 */
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'
import { standardDecoratorPlugin, vitestExecArgv } from './vitest.shared.ts'

// Web browser lane: real host entry points, built-client interaction snapshots,
// and replayed keyless e2e scenarios outside the unit/e2e includes. Linux PR CI
// pins DSH_SNAPSHOT=replay and compares committed goldens; record/refresh remain
// explicit local workflows. Real-model cases self-skip without DEEPSEEK_API_KEY.
// Web 通道覆盖真实宿主、构建客户端和重放快照；CI 使用 replay，真实模型无密钥时自跳过。
try {
  // Node >= 21.7 native; throws when the file does not exist.
  // Node 21.7 及以上原生加载 .env；文件不存在时会抛错。
  process.loadEnvFile(new URL('.env', import.meta.url).pathname)
} catch {
  // No .env — fine, the environment may already carry the variables.
  // 没有 .env 不构成错误，变量可能已由 CI 或调用 shell 提供。
}

// Web 测试的完整 Vitest 配置常量。
export default defineConfig({
  // Same resolution note as vitest.config.ts: the tsconfig.base.json paths
  // facade has no include (match-all), so apps/web/tests resolves bare
  // workspace imports to source like every other lane.
  // tsconfig.base.json 路径门面让 Web 测试和其他通道一样解析到工作区源码。
  plugins: [
    tsconfigPaths({ projects: ['./tsconfig.base.json'] }),
    standardDecoratorPlugin(),
  ],
  test: {
    execArgv: vitestExecArgv,
    include: [
      'apps/web/tests/**/*.e2e.ts',
      'apps/web/tests/**/*.snapshot.ts',
    ],
    // Local and record runs stay serial. CI runs workspace-mutating HMR and
    // dynamic Cordis lifecycle coverage before parallelizing the remaining files.
    // 本地与记录模式保持串行；CI 也先执行会修改工作区或生命周期敏感的用例。
    testTimeout: 180_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
})
