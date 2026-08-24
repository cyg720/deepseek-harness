/** Restore the executable bit stripped from node-pty's prebuilt helper. */
/**
 * 文件职责：安装后恢复 node-pty 预编译 spawn-helper 的可执行权限位。
 * 技术维度：使用 ESM 模块解析定位依赖，并通过同步文件 API 检查与 chmod。
 * 产品维度：本地终端和子进程在 Unix 主机上可正常启动 node-pty 辅助程序。
 * 逻辑维度：定位包根、列出预构建和本地构建候选，存在时设为 0755。
 * 关键边界：只修改 node-pty 包内已存在的已知文件，不创建文件也不递归扫描。
 * 新手阅读建议：先看 entry 到 packageRoot 的两级回退，再看两个候选路径。
 */

import { chmodSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** node-pty 当前解析入口的绝对路径，用于反推出安装包根目录。 */
const entry = fileURLToPath(import.meta.resolve('node-pty'))
/** node-pty 包根；入口位于包内两级子目录，因此连续取两次 dirname。 */
const packageRoot = dirname(dirname(entry))
/** 可能的辅助程序路径；依次覆盖预编译产物和本机编译产物。 */
const candidates = [
  join(packageRoot, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper'),
  join(packageRoot, 'build', 'Release', 'spawn-helper'),
]

/** 遍历固定候选；helper 是当前绝对路径，存在时权限设为所有者可写、所有人可执行读取。 */
for (const helper of candidates) {
  if (existsSync(helper)) chmodSync(helper, 0o755)
}
