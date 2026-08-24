/**
 * 文件职责：验证 Cordis 配置扫描只返回合法 Loader YAML，并排除翻译记录和忽略目录。
 * 技术维度：使用 Vitest 与 Node 文件系统 API 在系统临时目录构造真实目录树。
 * 产品维度：防止构建门禁把文档翻译、依赖或 vendored 配置误当成产品装配入口。
 * 逻辑维度：创建临时根目录和样本文件，调用扫描函数比较结果，并在每个测试后递归清理。
 * 关键边界：测试会创建和删除临时目录；删除目标只来自本文件记录的 mkdtempSync 返回值。
 * 新手阅读建议：先比较 file 样本列表和最终期望，再查看 cordisConfigFiles 的排除规则。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cordisConfigFiles } from './cordis-config-files.ts'

// 当前进程创建的临时根目录；仅包含 mkdtempSync 返回的安全路径，供 afterEach 清理。
const roots: string[] = []

// 测试清理函数；root 是从数组取出的单个临时目录，递归删除后不会保留在列表中。
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

// Cordis 配置文件扫描测试套件。
describe('cordisConfigFiles', () => {
  // 验证只发现 examples 下的正式配置；回调无参数且无业务返回值。
  it('finds Loader YAML without treating translation records as configs', () => {
    // 带随机后缀的独立临时根目录；所有后续写入均限制在该路径内。
    const root = mkdtempSync(join(tmpdir(), 'dsh-cordis-config-files-'))
    roots.push(root)
    // 需要创建的相对目录；directory 不得脱离刚创建的 root。
    for (const directory of ['.claude', 'docs', 'examples', 'node_modules/pkg', 'vendor/pkg']) {
      mkdirSync(join(root, directory), { recursive: true })
    }
    // 配置和非配置样本相对路径；file 内容统一为最小合法 YAML 数组。
    for (const file of [
      '.claude/hidden.cordis.yml',
      'docs/cordis-primer.i18n.yaml',
      'examples/agent.cordis.yaml',
      'examples/headless.cordis.yml',
      'node_modules/pkg/hidden.cordis.yml',
      'vendor/pkg/hidden.cordis.yml',
    ]) {
      writeFileSync(join(root, file), '[]\n')
    }

    expect(cordisConfigFiles(root)).toEqual([
      join('examples', 'agent.cordis.yaml'),
      join('examples', 'headless.cordis.yml'),
    ])
  })
})
