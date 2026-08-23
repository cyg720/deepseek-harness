/**
 * ================================ 文件注释 ================================
 * 【文件职责】JSON 后端的"原子整文件替换"工具：把目标文件以崩溃安全的方式整体替换
 * 为新内容。
 * 【技术维度】发布协议：同目录写临时文件 → fsync 临时文件 → rename 覆盖目标 →
 * （POSIX 上）fsync 父目录。rename 在 POSIX 与 Windows（libuv 映射为 MoveFileExW
 * 带 REPLACE_EXISTING）上都是原子替换；替换语义正是这里想要的（last-write-wins）。
 * 【产品维度】保证"读取者永远看到完整文件"：进程崩溃不会留下半截文件；配合单元层
 * 的内存权威 + 发布协议，让 JSON 介质达到崩溃持久性。
 * 【逻辑维度】按出现顺序：writeAtomic（主流程：临时文件 → rename → fsync 目录，
 * 任何一步失败清理临时文件）→ fsyncDirectory（POSIX 目录 fsync；Windows 直接返回）。
 * 【关键边界】这是"替换"语义，与 session-log 后端的"link()+unlink() 不覆盖"协议不同：
 * 单元文件每进程只有一个写者，后写覆盖先写是正确的；临时文件用 'wx' 独占创建 +
 * 随机名，避免与他人冲突；fsyncDirectory 在 Windows 上跳过（O_RDONLY 打开目录会被拒）。
 * 【新手阅读建议】先看 writeAtomic 的流程理解"临时文件 + rename"的经典原子写模式，
 * 再看 fsyncDirectory 理解为什么目录也要 fsync。
 * ==========================================================================
 */
/**
 * Atomic whole-file replacement for the JSON backend.
 *
 * Publish protocol: write a same-directory temp file, fsync it, then
 * `rename()` over the target. Rename is an atomic replace on POSIX and on
 * Windows (libuv maps it to `MoveFileExW(..., MOVEFILE_REPLACE_EXISTING)`),
 * and replacement is the intended semantic here — unlike the session-log
 * backend's link()+unlink() no-clobber protocol, a unit file has exactly one
 * writer per process and last-write-wins is correct. After the rename the
 * parent directory is fsynced on POSIX so the new entry is crash-durable.
 * @module @deepseek-ai/dsh-storage-json/src/atomic
 */
/**
 * 模块总览：这里实现"崩溃安全写入"的核心原语。与 session-log 后端"不覆盖"的
 * link()+unlink() 协议相反，单元文件是"每进程唯一写者、后写覆盖先写"（last-write-wins）。
 */

import { open, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

/**
 * Durably replace `path` with `data`.
 * @param path - Absolute target file path.
 * @param data - Full new file content.
 * @returns resolution after the replacement is crash-durable.
 */
/**
 * 持久地以 data 替换 path 处的文件。
 * 流程：同目录建独占临时文件（wx + 随机名，权限 0600）→ 写内容 → fsync →
 * rename 覆盖目标 → POSIX 上 fsync 父目录。任一步失败都清理临时文件并重抛。
 * @param path 目标文件绝对路径。
 * @param data 完整的新文件内容。
 * @returns 替换达到"崩溃持久"后解析。
 */
export async function writeAtomic(path: string, data: string): Promise<void> {
  // 临时文件与目标同目录：rename 在同一文件系统内才是原子的。
  const tmp = join(dirname(path), `.${randomUUID()}.tmp`)
  try {
    const handle = await open(tmp, 'wx', 0o600)
    try {
      await handle.writeFile(data, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(tmp, path)
    await fsyncDirectory(dirname(path))
  } catch (error) {
    // 失败清理：临时文件存在则删除（force 忽略不存在），避免残留。
    await rm(tmp, { force: true })
    throw error
  }
}

/** fsync a POSIX directory so a just-renamed entry is crash-durable. */
/**
 * fsync 一个 POSIX 目录，使刚 rename 进来的新条目达到崩溃持久。
 * Windows 上直接返回（以 O_RDONLY 打开目录会被拒绝，见下方 v8 ignore 说明）；
 * 其余平台用只读方式打开目录句柄并 sync，确保目录项本身落盘。
 */
/* v8 ignore start -- Windows rejects O_RDONLY directory opens; POSIX coverage exercises this. */
async function fsyncDirectory(path: string): Promise<void> {
  if (process.platform === 'win32') return
  const handle = await open(path, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}
/* v8 ignore stop */
