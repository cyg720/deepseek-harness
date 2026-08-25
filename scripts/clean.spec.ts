/**
 * 文件职责：验证 clean.spec.ts 覆盖的仓库构建、校验或维护脚本职责。
 * 技术维度：使用 TypeScript、JavaScript、Vitest、Node.js 文件系统或构建工具。
 * 产品维度：通过仓库构建、校验或维护脚本保障项目开发、发布和 Agent 工作区行为一致。
 * 逻辑维度：解析参数和文件，执行检查或转换，再输出结果并处理错误。
 * 关键边界：脚本可能修改构建产物；路径和子进程输出不可信；失败必须以非零状态显式报告。
 * 新手阅读建议：先看命令入口和参数，再读文件遍历或转换，最后关注错误码和平台差异。
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { RepositoryCleaner } from './clean.ts'

/** 中文说明：变量 roots 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const roots: string[] = []

/** 中文说明：函数 fixture 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function fixture(): string {
  /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const root = mkdtempSync(join(tmpdir(), 'dsh-clean-'))
  roots.push(root)
  return root
}

/** 中文说明：函数 write 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function write(path: string, content = ''): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

/** 中文说明：函数 addProject 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function addProject(root: string, path: string, outDir = 'lib/types'): void {
  write(join(root, 'tsconfig.json'), JSON.stringify({ files: [], references: [{ path }] }))
  write(join(root, path, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { composite: true, outDir },
    include: ['src'],
  }))
  write(join(root, path, 'src/index.ts'), 'export {}\n')
}

afterEach(() => {
  /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('RepositoryCleaner', () => {
  it('derives live build outputs from project references and removes safe stale package residue', async () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = fixture()
    addProject(root, 'products/shell')
    write(join(root, 'products/shell/lib/types/index.js'))
    write(join(root, 'products/shell/lib/index.js'))
    write(join(root, '.typecheck/legacy.tsbuildinfo'))
    write(join(root, '.dsh-build/client-build-environment.json'))
    write(join(root, 'root.tsbuildinfo'))
    write(join(root, 'packages/removed/ghost/node_modules/.bin/tool'))

    await new RepositoryCleaner(root).clean()

    expect(existsSync(join(root, 'products/shell/lib'))).toBe(false)
    expect(existsSync(join(root, 'products/shell/src/index.ts'))).toBe(true)
    expect(existsSync(join(root, '.typecheck'))).toBe(false)
    expect(existsSync(join(root, '.dsh-build'))).toBe(false)
    expect(existsSync(join(root, 'root.tsbuildinfo'))).toBe(false)
    expect(existsSync(join(root, 'packages/removed/ghost'))).toBe(false)
  })

  it('does not delete any target when a manifest-less package contains an unknown file', async () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = fixture()
    addProject(root, 'products/shell')
    write(join(root, 'products/shell/lib/types/index.js'))
    write(join(root, 'packages/removed/ghost/notes.txt'))

    await expect(new RepositoryCleaner(root).clean()).rejects.toThrow('packages/removed/ghost/notes.txt')
    expect(existsSync(join(root, 'products/shell/lib'))).toBe(true)
  })

  it('removes the native Landlock entry output and solution build info', async () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = fixture()
    /** 中文说明：变量 entry 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const entry = 'native/landlock-run/packages/entry'
    addProject(root, entry, 'lib')
    write(join(root, entry, 'lib/index.js'))
    write(join(root, 'native/landlock-run/tsconfig.tsbuildinfo'))

    await new RepositoryCleaner(root).clean()

    expect(existsSync(join(root, entry, 'lib'))).toBe(false)
    expect(existsSync(join(root, entry, 'src/index.ts'))).toBe(true)
    expect(existsSync(join(root, 'native/landlock-run/tsconfig.tsbuildinfo'))).toBe(false)
  })

  it('refuses project outputs reached through a symlink outside the repository', async () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = fixture()
    /** 中文说明：变量 externalProject 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const externalProject = fixture()
    write(join(root, 'tsconfig.json'), JSON.stringify({ files: [], references: [{ path: './linked' }] }))
    write(join(externalProject, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { composite: true, outDir: 'lib/types' },
      include: ['src'],
    }))
    write(join(externalProject, 'src/index.ts'), 'export {}\n')
    write(join(externalProject, 'lib/types/index.js'))
    symlinkSync(externalProject, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')

    await expect(new RepositoryCleaner(root).clean()).rejects.toThrow('outside repository')

    expect(existsSync(join(externalProject, 'lib/types/index.js'))).toBe(true)
  })
})
