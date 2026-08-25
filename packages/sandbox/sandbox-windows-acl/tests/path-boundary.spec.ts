/** Canonical path-overlap checks that keep workspace and temp capabilities separate. */
/*
 * 中文说明：
 * - 文件职责：验证 Windows ACL 沙箱对工作区与私有临时目录包含关系的拒绝和接受规则。
 * - 技术维度：使用 Vitest、真实临时目录、Node 路径与同步文件系统 API。
 * - 产品维度：防止工作区长期写权限与临时可撤销权限因目录继承而混合。
 * - 逻辑维度：每例创建真实目录，分别测试临时根在工作区内、位于上级以及实际目录双向重叠。
 * - 关键边界：断言函数会解析真实路径，因此目录必须先创建；所有 scratch 目录用例后递归清理。
 * - 新手阅读建议：画出父子和兄弟目录树，再对照三个用例判断哪些能力会相互继承。
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { assertPrivateTempDisjoint, assertTempRootOutsideWorkspace } from '../src/path-boundary.ts'

/** 中文：Windows ACL 临时路径关系测试组。 */
describe('Windows ACL temp path boundary', () => {
  /** 当前测试创建且等待清理的临时目录。 */
  const scratchDirs: string[] = []

  /** 中文：每个用例后删除并清空所有 scratch 目录。 */
  afterEach(() => {
    /** 当前待删除的临时目录。 */
    for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  /** 中文：创建并登记唯一临时目录；无参数，返回绝对路径。 */
  function scratch(): string {
    /** 当前新建的临时目录。 */
    const dir = mkdtempSync(join(tmpdir(), 'dsh-acl-boundary-'))
    scratchDirs.push(dir)
    return dir
  }

  /** 中文：临时根等于或位于工作区下方都应拒绝；无参数和返回值。 */
  it('rejects a temp root equal to or below the workspace', () => {
    /** 当前用例的工作区目录。 */
    const workspace = scratch()
    /** 工作区内部的临时目录候选。 */
    const nested = join(workspace, 'temp')
    mkdirSync(nested)

    expect(() => {
      assertTempRootOutsideWorkspace(workspace, workspace)
    }).toThrow(/temp root must be outside the workspace/u)
    expect(() => {
      assertTempRootOutsideWorkspace(workspace, nested)
    }).toThrow(/temp root must be outside the workspace/u)
  })

  /** 中文：临时父目录位于工作区上方时，新建子目录将是兄弟节点，因此接受；无参数和返回值。 */
  it('accepts a temp parent above the workspace because a fresh child is a sibling', () => {
    /** 同时作为 workspace 父目录的临时根候选。 */
    const tempRoot = scratch()
    /** tempRoot 下的工作区目录。 */
    const workspace = join(tempRoot, 'workspace')
    mkdirSync(workspace)

    expect(() => {
      assertTempRootOutsideWorkspace(workspace, tempRoot)
    }).not.toThrow()
  })

  /** 中文：实际私有临时目录与可写目录任一方向包含都拒绝，兄弟目录接受；无参数和返回值。 */
  it('requires an actual private temp directory to be disjoint in either direction', () => {
    /** 三个目录的共同临时根。 */
    const root = scratch()
    /** 接受写权限的工作区目录。 */
    const workspace = join(root, 'workspace')
    /** 工作区内部、应被拒绝的临时目录。 */
    const nestedTemp = join(workspace, 'temp')
    /** 与工作区并列、应被接受的临时目录。 */
    const siblingTemp = join(root, 'sibling-temp')
    mkdirSync(workspace)
    mkdirSync(nestedTemp)
    mkdirSync(siblingTemp)

    expect(() => {
      assertPrivateTempDisjoint([workspace], nestedTemp)
    }).toThrow(/must be disjoint/u)
    expect(() => {
      assertPrivateTempDisjoint([nestedTemp], workspace)
    }).toThrow(/must be disjoint/u)
    expect(() => {
      assertPrivateTempDisjoint([workspace], siblingTemp)
    }).not.toThrow()
  })
})
