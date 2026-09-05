/**
 * Tests for the writable-root derivation: the mode's meaning as a canonical
 * allow-list. Pinned here so the fs fence and the Seatbelt profile — both
 * deriving from `writableRoots` — cannot drift.
 */
/*
 * 文件职责：验证沙箱规范路径解析和不同模式的可写根目录白名单推导。
 * 技术维度：使用 Vitest、真实文件系统临时目录和平台 realpath 比较规范路径。
 * 产品维度：确保只读模式不授予写权限，工作区写模式只开放工作区与平台临时区。
 * 逻辑维度：canonicalPath 用例覆盖存在/不存在路径；writableRoots 覆盖空列表和规范去重列表。
 * 关键边界：不存在路径保留原拼写以保守地不匹配；/tmp 与 os.tmpdir 规范化后可能相同。
 * 新手阅读建议：先看 canonicalPath 两种输入，再比较 read-only 和 workspace-write 的根目录集合。
 */

import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { canonicalPath, writableRoots } from '@deepseek-ai/dsh-sandbox'

/** Every temp root created by this file, removed after each test. */
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('canonicalPath', () => {
  // 验证存在路径通过 native realpath 解析。
  it('resolves symlinks (an existing path realpaths)', () => {
    // 系统临时区中新建的真实目录。
    const dir = mkdtempSync(join(tmpdir(), 'dsh-roots-'))
    roots.push(dir)
    expect(canonicalPath(dir)).toBe(realpathSync.native(dir))
  })

  // 验证无法解析路径时保留原拼写，直到路径存在前都不授权。
  it('returns the spelling as-is when the path cannot be resolved (conservative — matches nothing until it exists)', () => {
    expect(canonicalPath('/does/not/exist/anywhere-xyz')).toBe('/does/not/exist/anywhere-xyz')
  })
})

// 可写根目录推导测试套件。
describe('writableRoots', () => {
  // 验证只读模式返回空白名单。
  it('read-only grants nothing', () => {
    expect(writableRoots({ mode: 'read-only', workspaceRoot: process.cwd() })).toEqual([])
  })

  // 验证工作区写模式包含规范工作区和临时区并去重。
  it('workspace-write grants the workspace root plus the platform temp areas, canonical and deduplicated', () => {
    // 模拟工作区的临时真实目录。
    const ws = mkdtempSync(join(tmpdir(), 'dsh-ws-'))
    roots.push(ws)
    const writable = writableRoots({ mode: 'workspace-write', workspaceRoot: ws })
    expect(writable).toContain(realpathSync.native(ws))
    expect(writable).toContain(canonicalPath('/tmp'))
    expect(writable).toContain(realpathSync.native(tmpdir()))
    // Deduplicated after canonicalization (/tmp and os.tmpdir() may coincide).
    expect(new Set(writable).size).toBe(writable.length)
  })
})
