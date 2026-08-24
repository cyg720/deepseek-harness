/**
 * 文件职责：用真实模型验证 headless-agent 能修改临时工作区文件并由测试进程独立核验。
 * 技术维度：使用 Vitest 条件跳过、Loader 冒烟工具和异步文件系统操作。
 * 产品维度：证明无界面代理可完成真实文件任务，而不只是在回复中声称成功。
 * 逻辑维度：解析脚本和配置路径，按密钥决定运行，准备 task.txt，启动代理，检查文件和 stdout。
 * 关键边界：没有 DEEPSEEK_API_KEY 时自跳过；真实调用上限 135 秒，文件验证在代理进程外完成。
 * 新手阅读建议：先看四个常量，再沿 prepare、binArgs、inspect 和最终断言理解验证闭环。
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

// headless 测试驱动脚本的绝对路径。
const binScript = fileURLToPath(new URL('./fixtures/headless-driver.ts', import.meta.url))
// 示例 Cordis 配置绝对路径。
const configPath = fileURLToPath(new URL('../cordis.yml', import.meta.url))
// 源码启动所需仓库 TypeScript 配置绝对路径。
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
// 是否存在真实模型密钥；false 时套件自跳过。
const hasKey = Boolean(process.env.DEEPSEEK_API_KEY)

// 真实模型 headless 套件。
describe.skipIf(!hasKey)('headless-agent with real model', () => {
  // 验证代理修改文件且外部进程读到精确内容。
  it('modifies a temporary workspace and verifies the file outside the agent', async () => {
    // inspect 回调读取到的最终文件内容；初始为空字符串。
    let verified = ''
    // Loader 冒烟运行的标准输出；应包含代理最终回复。
    const { stdout } = await runLoaderSmoke({
      label: 'headless-agent real model',
      tempDirPrefix: 'headless-agent-real-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [
        configPath,
        'Read task.txt, replace its complete contents with exactly "value=after" followed by a newline, read it again, and report briefly.',
      ],
      tsconfigPath,
      processTimeoutMs: 120_000,
      // 临时工作区准备回调；cwd 是冒烟工具创建的目录。
      prepare: cwd => writeFile(join(cwd, 'task.txt'), 'value=before\n'),
      // 进程退出后的外部检查回调；把 cwd 下最终内容保存到 verified。
      inspect: async (cwd) => { verified = await readFile(join(cwd, 'task.txt'), 'utf8') },
    })
    expect(verified).toBe('value=after\n')
    expect(stdout.trim().length).toBeGreaterThan(0)
  }, 135_000)
})
