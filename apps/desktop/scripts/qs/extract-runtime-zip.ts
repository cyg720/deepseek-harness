/** 桌面 Node ZIP 的受限解压入口；运行时分发包不接受符号链接。 */
import extractZip from 'extract-zip'

/**
 * 解压已校验摘要的 Node ZIP，在库创建符号链接之前拒绝该条目。
 * @param archive - 调用方已完成 SHA-256 校验的 ZIP 路径。
 * @param directory - 调用方刚创建的独占空目录；不得复用不可信目录。
 * @returns 所有普通文件与目录解压完成的 Promise。
 */
export async function extractRuntimeZip(archive: string, directory: string): Promise<void> {
  await extractZip(archive, {
    dir: directory,
    onEntry(entry) {
      // ZIP Unix mode 的文件类型位；先拒绝链接，阻断链接越界及同名普通文件跟随覆盖。
      if (((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000) {
        throw new Error(`desktop runtime: ZIP symbolic links are forbidden: ${entry.fileName}`)
      }
    },
  })
}
