/**
 * Containment tests for lexical canonical paths and filesystem-identity aliases.
 */
/*
 * 中文说明：
 * - 文件职责：验证文件沙箱路径包含判断同时处理规范字符串关系和符号链接身份别名。
 * - 技术维度：使用 Vitest、真实临时目录、realpath、symlink 和可配置大小写比较。
 * - 产品维度：确保沙箱只允许目标位于授权根下，同时不误拒绝指向同一目录的合法别名。
 * - 逻辑维度：每例创建临时根，覆盖相等/后代/文件系统根、大小写、别名、无关根和文件阻断。
 * - 关键边界：符号链接用例依赖宿主支持创建 symlink；缺失允许根必须拒绝而非猜测。
 * - 新手阅读建议：先看纯路径三例，再看 realRoot/aliasRoot 如何证明文件系统身份等价。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, parse } from 'node:path'
import { isPathUnder } from '../src/containment.ts'

/** 每个用例独占的临时根目录。 */
let base: string

/** 中文：每例前创建唯一临时根目录。 */
beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'dsh-fssbx-containment-'))
})

/** 中文：每例后递归删除临时根目录。 */
afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

/** 中文：文件系统沙箱路径包含测试组。 */
describe('filesystem sandbox containment', () => {
  /** 中文：允许根本身、其后代以及文件系统根包含目标；无参数和返回值。 */
  it('accepts equal paths, descendants, and a filesystem-root boundary', async () => {
    expect(await isPathUnder(base, base)).toBe(true)
    expect(await isPathUnder(join(base, 'child'), base)).toBe(true)
    expect(await isPathUnder(base, parse(base).root)).toBe(true)
  })

  /** 中文：Windows 风格比较可忽略大小写，显式敏感模式仍接受真实后代；无参数和返回值。 */
  it('uses case-insensitive lexical comparison for Windows-style containment', async () => {
    expect(await isPathUnder(join(base.toUpperCase(), 'child'), base.toLowerCase(), false)).toBe(true)
    expect(await isPathUnder(join(base, 'case-sensitive-child'), base, true)).toBe(true)
  })

  /** 中文：允许根是真实目录别名时，也应接受该真实目录下尚不存在的目标；无参数和返回值。 */
  it('recognizes an alias-equivalent root by filesystem identity for a missing target', async () => {
    /** 实际存在的允许根。 */
    const realRoot = join(base, 'real')
    /** 指向 realRoot 的符号链接别名。 */
    const aliasRoot = join(base, 'alias')
    await mkdir(realRoot)
    await symlink(realRoot, aliasRoot)
    expect(await isPathUnder(join(await realpath(realRoot), 'missing', 'file.txt'), aliasRoot)).toBe(true)
  })

  /** 中文：无关目录和不存在的允许根都应拒绝；无参数和返回值。 */
  it('denies unrelated and missing roots', async () => {
    /** 已存在的允许目录。 */
    const allowed = join(base, 'allowed')
    /** 与允许目录并列的外部目录。 */
    const outside = join(base, 'outside')
    await mkdir(allowed)
    await mkdir(outside)
    expect(await isPathUnder(join(outside, 'file.txt'), allowed)).toBe(false)
    expect(await isPathUnder(join(outside, 'file.txt'), join(base, 'missing-root'))).toBe(false)
  })

  /** 中文：路径中间段是普通文件时视为目标不可达并拒绝；无参数和返回值。 */
  it('treats a regular-file path segment as a missing target, not containment', async () => {
    /** 已存在的允许目录。 */
    const allowed = join(base, 'allowed')
    /** 作为路径中间阻断项的普通文件。 */
    const blocker = join(base, 'blocker')
    await mkdir(allowed)
    await writeFile(blocker, 'not a directory')
    expect(await isPathUnder(join(blocker, 'child.txt'), allowed)).toBe(false)
  })
})
