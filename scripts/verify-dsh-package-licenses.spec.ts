import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectDshPackageLicenses } from './verify-dsh-package-licenses.ts'

/** 当前测试创建且等待清理的临时工作区根目录。 */
const roots: string[] = []

/** 中文：每个用例后删除并清空所有临时工作区。 */
afterEach(() => {
  /** 当前待删除的临时根目录。 */
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** 中文：在 root/file 写入 manifest JSON；会创建父目录，无返回值。 */
function writeManifest(root: string, file: string, manifest: Record<string, unknown>): void {
  /** 当前包清单的完整路径。 */
  const path = join(root, file)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`)
}

/** 中文：创建带根 package.json 的临时工作区并登记清理；无参数，返回根路径。 */
function createWorkspace(): string {
  /** 新建的唯一临时工作区根目录。 */
  const root = mkdtempSync(join(tmpdir(), 'dsh-package-licenses-'))
  roots.push(root)
  writeManifest(root, 'package.json', {
    name: '@deepseek-ai/dsh-root',
    license: 'MIT',
    workspaces: ['apps/*', 'packages/*/*', 'vendor/*'],
  })
  return root
}

/** 中文：DSH 包许可证门禁测试组。 */
describe('DSH package license gate', () => {
  /** 中文：检查目标包族并忽略 Cordis，返回一条非 MIT 诊断；无参数和返回值。 */
  it('checks root, unhyphenated CLI, and dsh-prefixed package names while ignoring other families', () => {
    /** 当前用例的临时工作区。 */
    const root = createWorkspace()
    writeManifest(root, 'apps/cli/package.json', { name: '@deepseek-ai/dsh', license: 'MIT' })
    writeManifest(root, 'packages/core/agent/package.json', {
      name: '@deepseek-ai/dsh-agent',
      license: 'BSD-3-Clause',
    })
    writeManifest(root, 'vendor/cordis/package.json', {
      name: '@deepseek-ai/cordis',
      license: 'BSD-3-Clause',
    })

    expect(inspectDshPackageLicenses(root)).toEqual({
      packageCount: 3,
      failures: [
        'packages/core/agent/package.json: @deepseek-ai/dsh-agent must declare "license": "MIT"; found "BSD-3-Clause".',
      ],
    })
  })

  /** 中文：目标包缺少 license 字段时应报告 undefined；无参数和返回值。 */
  it('rejects a missing license declaration', () => {
    /** 当前用例的临时工作区。 */
    const root = createWorkspace()
    writeManifest(root, 'packages/core/agent/package.json', { name: '@deepseek-ai/dsh-agent' })

    expect(inspectDshPackageLicenses(root).failures).toEqual([
      'packages/core/agent/package.json: @deepseek-ai/dsh-agent must declare "license": "MIT"; found undefined.',
    ])
  })
})
/**
 * 中文说明：
 * - 文件职责：验证 dsh 自有 npm 包许可证门禁只检查目标包族并要求统一 MIT 声明。
 * - 技术维度：使用 Vitest、临时工作区、同步文件 API 和 JSON 清单生成。
 * - 产品维度：避免发布包遗漏或误用许可证，同时不把 vendored Cordis 当成自有包。
 * - 逻辑维度：创建根工作区，按需写入包清单，执行扫描并断言计数与诊断。
 * - 关键边界：只匹配根包、无连字符 CLI 和 dsh- 前缀包；临时目录每例清理。
 * - 新手阅读建议：先看 createWorkspace 的 workspaces，再比较两个用例的错误许可证与缺失字段。
 */
