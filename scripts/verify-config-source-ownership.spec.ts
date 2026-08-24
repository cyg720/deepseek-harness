/**
 * 文件职责：验证配置来源所有权门禁会拒绝 bundle 补丁直接内联环境凭据或端点。
 * 技术维度：使用 Vitest 和 Node 文件系统 API 在临时仓库中构造 cordis.patch.yml。
 * 产品维度：确保适配器统一通过凭据服务和环境快照解析敏感配置。
 * 逻辑维度：创建临时包与违规补丁，运行收集器，比较带文件行号和修复说明的诊断。
 * 关键边界：临时目录只从 mkdtempSync 获取并在 afterEach 删除；测试不接触真实仓库配置。
 * 新手阅读建议：先看写入的违规 YAML，再对照期望诊断理解所有权规则。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectConfigSourceOwnershipViolations } from './verify-config-source-ownership.ts'

// 本进程创建的临时仓库根目录，只供测试后安全清理。
const roots: string[] = []

// 清理钩子；root 是 roots 中取出的受控临时路径。
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

// 配置来源所有权门禁测试套件。
describe('configuration source ownership gate', () => {
  // 验证发布 bundle 中直接读取环境端点会产生违规诊断。
  it('rejects inline endpoints in shipped bundle patches', () => {
    // 带随机后缀的临时仓库根目录。
    const root = mkdtempSync(join(tmpdir(), 'dsh-config-source-ownership-'))
    roots.push(root)
    // 模拟子代理适配器包目录；所有写入限制在 root 下。
    const directory = join(root, 'packages/subagent/subagent-claude-code')
    mkdirSync(directory, { recursive: true })
    writeFileSync(
      join(directory, 'cordis.patch.yml'),
      'config:\n  baseURL: !!js process.env.DEEPSEEK_SEARCH_BASE_URL\n',
    )

    expect(collectConfigSourceOwnershipViolations(root)).toEqual([
      'packages/subagent/subagent-claude-code/cordis.patch.yml:2: inlines a credential or endpoint from the environment.'
      + ' The adapter resolves apiKeyEnv through ctx.credentials and the endpoint through the'
      + ' environment snapshot; inlining here bypasses both ladders.',
    ])
  })
})
