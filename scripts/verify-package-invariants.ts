/** Verify package-owned invariant source and publication rules. */
/*
 * 文件职责：执行包自有不变量伴生模块的源码与发布规则校验。
 * 技术维度：使用 Node.js ESM 脚本调用共享收集器，并以进程退出码向仓库门禁报告结果。
 * 产品维度：确保每个发布包的诊断伴生入口可发现、命名一致且不会遗漏发布文件。
 * 逻辑维度：解析仓库根目录，收集违规项；有违规时逐条输出并失败，否则报告合规包数量。
 * 关键边界：该脚本只校验和报告，不修复文件；任何违规都会以退出码 1 阻止门禁通过。
 * 新手阅读建议：先看 violations 分支，再阅读 package-invariants.ts 中每类违规的判定依据。
 */

import { resolve } from 'node:path'
import {
  collectPackageInvariantViolations,
  formatPackageInvariantViolation,
  packageInvariantOwners,
} from './package-invariants.ts'

// root：仓库绝对根目录，用于扫描包并把错误路径格式化为仓库相对路径。
const root = resolve(import.meta.dirname, '..')
// violations：所有违反包自有不变量源码或发布规则的结构化记录。
const violations = collectPackageInvariantViolations(root)

// 失败分支：只要存在一项违规，就完整输出后以非零状态结束。
if (violations.length > 0) {
  console.error('verify-package-invariants: violations found:')
  // violation：当前待格式化的单项违规记录。
  for (const violation of violations) {
    console.error(`  ${formatPackageInvariantViolation(root, violation)}`)
  }
  process.exit(1)
}

console.log(`verify-package-invariants: ${packageInvariantOwners(root).length} hand-owned package companion(s) conform.`)
