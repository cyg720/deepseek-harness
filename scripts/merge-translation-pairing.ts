/** Git merge-driver and explicit conflict-resolver entrypoint for pairing records. */
/**
 * 中文说明：
 * - 文件职责：作为翻译配对记录的 Git 合并驱动入口，并支持显式解析未合并索引冲突。
 * - 技术维度：使用 Node 子进程/文件 API、Git 索引、三方合并和进程退出码。
 * - 产品维度：在分支合并时保留中英文文档配对关系，并自动解决可安全判定的冲突。
 * - 逻辑维度：解析 --probe、--resolve 或四参数驱动模式，读取 Git 根与三方文件，写回 current。
 * - 关键边界：--resolve 不接路径；驱动模式必须恰有四参；任何异常都设置退出码 1 并给出恢复指引。
 * - 新手阅读建议：先看 args 的三个模式分支，再跟踪 merge-driver 中 ancestor/current/other 的输入输出。
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import {
  mergeTranslationPairingRecords,
  repositoryTranslationPairSource,
  resolveTranslationPairingConflicts,
} from './translation-pairing-merge.ts'

/** 除 node 和脚本路径外的命令行参数。 */
const args = process.argv.slice(2)

try {
  if (args[0] === '--probe') {
    if (args.length !== 1) throw new Error('--probe takes no other arguments')
  } else {
    /** 当前 Git 仓库根目录。 */
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
    if (args[0] === '--resolve') {
      if (args.length !== 1) throw new Error('--resolve takes no paths; it inspects the unmerged index')
      /** 成功自动解决并重新暂存的配对记录路径。 */
      const resolved = resolveTranslationPairingConflicts(root, repositoryTranslationPairSource(root))
      if (resolved.length === 0) {
        console.log('merge-translation-pairing: no unresolved pairing records')
      } else {
        /** 当前已解决、用于打印进度的仓库相对路径。 */
        for (const path of resolved) console.log(`merge-translation-pairing: resolved ${path}`)
      }
    } else {
      if (args.length !== 4) {
        throw new Error('merge-driver mode requires <ancestor> <current> <other> <repository-path>')
      }
      /** Git 合并驱动传入的祖先、当前、另一侧临时文件和仓库路径。 */
      const [ancestorPath, currentPath, otherPath, metaPath] = args
      if (ancestorPath === undefined || currentPath === undefined || otherPath === undefined || metaPath === undefined) {
        throw new Error('merge-driver arguments are incomplete')
      }
      /** 三方配对记录合并结果；record 将写回 current 临时文件。 */
      const result = mergeTranslationPairingRecords(
        root,
        metaPath,
        readFileSync(ancestorPath, 'utf8'),
        readFileSync(currentPath, 'utf8'),
        readFileSync(otherPath, 'utf8'),
        repositoryTranslationPairSource(root),
      )
      writeFileSync(currentPath, result.record)
    }
  }
} catch (error) {
  console.error(`merge-translation-pairing: ${error instanceof Error ? error.message : String(error)}`)
  console.error(
    'merge-translation-pairing: resolve owner conflicts, then confirm the pair with '
    + '`pnpm run verify-translation-pairing --write <pair>`; rerun '
    + '`pnpm run resolve-translation-pairing-conflicts` for other safe records',
  )
  process.exitCode = 1
}
