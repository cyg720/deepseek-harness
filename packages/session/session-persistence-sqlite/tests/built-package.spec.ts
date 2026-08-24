/**
 * 文件职责：验证 SQLite 会话持久化包的构建产物能从发布入口加载 SQL 资源。
 * 技术维度：使用 Vitest、Node 子进程和动态 ESM 导入，在纯构建产物环境装配 Cordis。
 * 产品维度：防止发布包遗漏 SQL 文件，避免用户安装后首次访问会话数据库才失败。
 * 逻辑维度：准备仓库与 bundle 路径和探针脚本；产物存在时启动 Node，检查空会话列表和无 stderr。
 * 关键边界：未构建 lib/index.js 时自跳过；探针使用内存数据库并设置 15 秒超时。
 * 新手阅读建议：先看三个路径常量，再阅读 probe 内装配顺序，最后看 skipIf 和输出断言。
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

// 仓库根绝对路径；子进程以此为 cwd 解析构建包路径。
const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
// SQLite 包发布入口的绝对路径；不存在时整个套件跳过。
const builtBundle = fileURLToPath(new URL('../lib/index.js', import.meta.url))
// Promise 化的 execFile，便于测试等待子进程完成。
const execFileAsync = promisify(execFile)

// 在普通 Node ESM 中运行的构建产物探针源码；只导入 lib 文件并查询内存会话列表。
const probe = String.raw`
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const load = path => import(pathToFileURL(resolve(path)).href);
const [{ Context }, { default: SessionStore }, { default: Sqlite }] = await Promise.all([
  load('vendor/cordis/lib/index.js'),
  load('packages/core/session/lib/index.js'),
  load('packages/session/session-persistence-sqlite/lib/index.js'),
]);
const ctx = new Context();
await ctx.plugin(SessionStore);
await ctx.plugin(Sqlite, { path: ':memory:' });
console.log(JSON.stringify(await ctx.sessionPersistence.list()));
await ctx.fiber.dispose();
`

// 构建产物测试套件；builtBundle 缺失表示尚未执行构建而非产品失败。
describe.skipIf(!existsSync(builtBundle))('SQLite built package', () => {
  // 验证发布入口能定位 SQL 资源；异步返回 Promise<void>。
  it('loads packaged SQL resources from the published entry', async () => {
    // 探针子进程输出；stdout 应为 JSON 空数组，stderr 必须为空。
    const { stdout, stderr } = await execFileAsync(process.execPath, ['--input-type=module', '-e', probe], {
      cwd: repoRoot,
      timeout: 15_000,
    })
    expect(stderr).toBe('')
    expect(JSON.parse(stdout) as unknown).toEqual([])
  })
})
