/**
 * Canonical directory-boundary checks for the Windows ACL workspace and
 * private-temp capabilities.
 * @module @deepseek-ai/dsh-sandbox-windows-acl/path-boundary
 */
/*
 * 中文说明：
 * - 文件职责：校验 Windows ACL 沙箱的工作区、可写目录与私有临时目录没有危险的包含关系。
 * - 技术维度：使用原生 realpath 解析、path.relative 和 Windows 路径分隔符判断目录祖先关系。
 * - 产品维度：防止工作区永久写权限与可撤销临时权限相互继承，维持沙箱隔离。
 * - 逻辑维度：先把路径规范到真实目录并判断包含，再由两个公开断言覆盖临时根和实际临时目录。
 * - 关键边界：所有参数目录必须已存在；符号链接会按真实目标判断，重叠立即抛错。
 * - 新手阅读建议：先用相同、子级和相邻目录理解 containsDirectory，再看两个断言为何方向不同。
 */

import { realpathSync } from 'node:fs'
import { isAbsolute, relative, sep } from 'node:path'

/** Whether `root` is the same canonical directory as `candidate` or contains it. */
/* 中文：判断 root 是否等于或包含 candidate；两者必须存在，返回布尔值。示例：containsDirectory('C:\\a', 'C:\\a\\b')。 */
function containsDirectory(root: string, candidate: string): boolean {
  /** candidate 相对 root 真实路径的关系；空串表示同一路径，.. 前缀表示越出根目录。 */
  const relation = relative(realpathSync.native(root), realpathSync.native(candidate))
  return relation === '' || (!isAbsolute(relation) && relation !== '..' && !relation.startsWith(`..${sep}`))
}

/**
 * Reject a temp parent that is inside the workspace: every child created
 * below it would inherit the standing workspace capability.
 * @param workspaceRoot - the canonical workspace root that receives the standing ACE.
 * @param tempRoot - the existing parent beneath which a private temp child would be created.
 */
/*
 * 中文：断言 tempRoot 不在 workspaceRoot 内；参数均为现有目录，无返回值，违规时抛错。
 * @param workspaceRoot 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param tempRoot 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 */
export function assertTempRootOutsideWorkspace(workspaceRoot: string, tempRoot: string): void {
  if (containsDirectory(workspaceRoot, tempRoot)) {
    throw new Error(`Windows ACL temp root must be outside the workspace: workspace=${workspaceRoot}; temp=${tempRoot}`)
  }
}

/**
 * Reject overlap between an actual private temp directory and any writable
 * directory: either inheritance direction would merge the two capabilities.
 * @param writableDirs - directories carrying the standing workspace capability.
 * @param tempDir - the existing directory carrying the revocable temp capability.
 */
/*
 * 中文：断言 tempDir 与每个 writableDirs 元素互不包含；无返回值，任一重叠时抛错。
 * @param writableDirs 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param tempDir 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 */
export function assertPrivateTempDisjoint(writableDirs: readonly string[], tempDir: string): void {
  /** 当前接受双向包含关系检查的可写目录。 */
  for (const writableDir of writableDirs) {
    if (containsDirectory(writableDir, tempDir) || containsDirectory(tempDir, writableDir)) {
      throw new Error(`AclSandbox private temp directory must be disjoint from writable directories: writable=${writableDir}; temp=${tempDir}`)
    }
  }
}
