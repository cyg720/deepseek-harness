/**
 * Junction-safe fixture cleanup for Windows. Test fixtures junction the REAL
 * `scripts/`, `node_modules`, and tsx package directories so installer probes
 * resolve through them; Windows recursive deletion — both Node's `rmSync` and
 * Git's `worktree remove` — follows MOUNT_POINT junctions into their targets
 * and would delete the repository's own directories. POSIX `unlink`/`rm`
 * already remove symlinks without following them, so the walk is a no-op
 * there.
 */
/*
 * 中文说明：
 * - 文件职责：安全清理测试夹具，避免 Windows 递归删除跟随 junction 误删仓库真实目录。
 * - 技术维度：使用 lstat、递归目录遍历、符号链接 unlink 和带重试的 rmSync。
 * - 产品维度：保障安装器和工作树测试收尾时不会破坏开发环境，并减少 Windows 文件占用抖动。
 * - 逻辑维度：先递归解除所有链接，再对已去链接的夹具树执行有限次数重试删除。
 * - 关键边界：Windows 上必须先调用 unlinkFixtureLinks；ENOENT 可忽略，其他读取错误继续抛出。
 * - 新手阅读建议：先区分链接、普通文件和目录三类节点，再看 removeFixtureSafely 的两步顺序。
 */

import { lstatSync, readdirSync, rmSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Recursively unlink every symbolic link (junction) under `path`.
 * @param path - the fixture tree whose reparse points are unlinked.
 */
/* 中文：递归解除 path 下所有符号链接或 junction；普通文件保留，目录继续遍历，无返回值。 */
export function unlinkFixtureLinks(path: string): void {
  /** 中文：访问一个 entry；链接会被解除，目录会递归，普通文件跳过；无返回值。 */
  const visit = (entry: string): void => {
    /** 当前条目的 lstat 结果；读取前尚未赋值。 */
    let stat: ReturnType<typeof lstatSync>
    try {
      stat = lstatSync(entry)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      if (stat.isSymbolicLink()) unlinkSync(entry)
      return
    }
    /** 当前目录中的单个子项名称。 */
    for (const child of readdirSync(entry)) visit(join(entry, child))
  }
  visit(path)
}

/**
 * Remove one fixture tree after its junctions are unlinked (see
 * {@link unlinkFixtureLinks}). Retries the removal: Windows releases child
 * process and antivirus file handles asynchronously, and an unretried
 * `rmSync` fails immediately with EPERM under load. A 10-second retry window
 * (50 attempts × 200 ms) covers the failover pool's slow handle release;
 * release is one-shot (a terminated child's handles drain, not reacquired),
 * so a bounded window suffices and never pins afterEach cleanup.
 * @param path - the fixture tree to remove.
 */
/* 中文：先解除 path 内链接，再递归删除夹具树；无返回值，文件占用时最多重试 50 次。 */
export function removeFixtureSafely(path: string): void {
  unlinkFixtureLinks(path)
  rmSync(path, { recursive: true, force: true, maxRetries: 50, retryDelay: 200 })
}
