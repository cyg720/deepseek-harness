/**
 * Path canonicalization for workspace identity.
 * @module @deepseek-ai/dsh-workspace/src/paths
 */
/**
 * 文件职责：提供工作区身份唯一使用的目录路径规范化函数。
 * 技术维度：调用 Node.js fs.realpath 解析绝对路径、符号链接、尾斜杠和上级目录段。
 * 产品维度：避免同一物理目录通过不同文本路径被重复添加为多个工作区。
 * 逻辑维度：把调用方路径交给 realpath，并原样返回规范绝对路径或传播系统错误。
 * 关键边界：路径必须真实存在；ENOENT 保持原样，创建工作区不能指向尚未创建的目录。
 * 新手阅读建议：先理解“字符串相等”发生在 realpath 之后，再看创建和附加会话如何复用此函数。
 */

import { realpath } from 'node:fs/promises'

/**
 * Canonicalize a directory path via `fs.realpath`: trailing slashes, `..`
 * segments, and symlinks are all resolved. This is the ONE uniqueness canon of
 * the package — workspace paths are stored canonicalized, uniqueness is
 * string equality of canonicalized paths (a symlink to an existing
 * workspace's directory collides), and attach-time session `cwd` checks go
 * through the same canon. A path that does not exist rejects with the
 * original `ENOENT` — this is `create`'s reject path (a workspace must point
 * at an existing directory).
 * @param path - The path to canonicalize.
 * @returns the canonical absolute path.
 */
/**
 * 把现有目录路径规范化为工作区唯一身份使用的绝对真实路径。
 * @param path - 待规范化的目录路径，可含符号链接、尾斜杠或 .. 段。
 * @returns 解析所有别名后的规范绝对路径。
 * @example await realpathNormalize('./project/../project')。
 */
export async function realpathNormalize(path: string): Promise<string> {
  return await realpath(path)
}
