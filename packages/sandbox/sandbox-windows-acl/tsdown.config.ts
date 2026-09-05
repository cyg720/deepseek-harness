/**
 * 文件职责：声明 Windows ACL 沙箱服务、invariant 与独立 runner 的 Node 构建入口。
 * 技术维度：使用 tsdown 多入口 ESM 构建，runner 内联沙箱逻辑但保留 koffi 原生依赖。
 * 产品维度：Windows 上生成的进程可在受限令牌和写入允许列表下运行。
 * 逻辑维度：用命名入口同时产出 index、invariant 和 runner 到 lib。
 * 关键边界：runner 由路径加载且必须独立存在；原生 koffi 不能被错误内联。
 * 新手阅读建议：先看三个入口，再追踪 sandbox-local 的 win32 调用链。
 */
import { defineConfig } from 'tsdown'

// The confinement runner builds as its own entry (path-loaded by
// dsh-sandbox-local's win32 chain), inlining the sandbox primitives while
// koffi stays an external native require — the same shape as
// directory-picker-native's worker entry.
// runner 单独输出供 win32 链按路径加载；沙箱原语内联，但 koffi 原生 require 保持外部。
/**
 * 生成 Windows ACL 沙箱多入口配置；返回 tsdown 可直接执行的 Node ESM 配置。
 * 使用示例：运行 `pnpm --filter @deepseek-ai/dsh-sandbox-windows-acl bundle`。
 */
export default defineConfig({
  entry: { index: 'lib/types/index.js', runner: 'lib/types/runner.js' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
