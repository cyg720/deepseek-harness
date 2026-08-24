import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'

/**
 * Keyless smoke for SOURCE `dsh` execution: run `apps/cli/src/bin.ts`
 * with the exact production runtime vector (`node --import tsx/esm`, the
 * vector the root `dsh` script invokes directly) and assert the
 * required-config diagnostic. The Node compatibility matrix runs this
 * WHOLE file, so a Node release changing module hooks or TypeScript handling
 * breaks this gate instead of every developer's `pnpm dsh`; the built-bin
 * suite covers the published `lib/` entry, not this source chain.
 */
/**
 * 文件职责：无构建运行 dsh 源码入口，守护生产使用的 node --import tsx/esm 启动链。
 * 技术维度：使用 Vitest、execa、真实 package.json 和 Node 模块导入钩子启动 CLI。
 * 产品维度：在 Node 版本改变模块钩子或 TypeScript 处理时尽早发现，而不是让开发者本地命令普遍失败。
 * 逻辑维度：第一例检查根脚本精确命令；第二例启动源码入口，处理超时并断言缺 profile 诊断与输出通道。
 * 关键边界：不需要 API 密钥或构建产物；进程 25 秒未退出会强杀并报告 stdout/stderr。
 * 新手阅读建议：先看 repoRoot/dshSourceBin，再比较静态脚本断言和真实 execa 运行断言。
 */

// 仓库根绝对路径，作为源码 CLI 子进程 cwd。
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
// 仓库根相对的 dsh TypeScript 入口。
const dshSourceBin = 'apps/cli/src/bin.ts'

// dsh 源码启动兼容性测试套件。
describe('dsh SOURCE launcher (node --import tsx/esm)', () => {
  // 验证 package.json 的 dsh 脚本保持精确生产向量。
  it('launches the source CLI without building', async () => {
    // 解析后的根 package.json，只读取可选 scripts。
    const rootPackage = JSON.parse(await readFile(new URL('../../../package.json', import.meta.url), 'utf8')) as {
      readonly scripts?: Record<string, string>
    }
    expect(rootPackage.scripts?.dsh).toBe('node --import tsx/esm apps/cli/src/bin.ts')
  })

  // 真实启动源码入口并验证必须提供 profile。
  it('boots the source entry and requires a profile', async () => {
    // 不拒绝非零退出的子进程结果；应快速返回缺 profile 诊断。
    const result = await execa(process.execPath, ['--import', 'tsx/esm', dshSourceBin], {
      cwd: repoRoot,
      input: '',
      timeout: 25_000,
      killSignal: 'SIGKILL',
      reject: false,
    })
    if (result.timedOut) {
      throw new Error(`dsh source launch did not exit within 25s. stdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
    }
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('--profile <name> is required')
    expect(result.stdout).toBe('')
  }, 30_000)
})
