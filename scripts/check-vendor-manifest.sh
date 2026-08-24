#!/usr/bin/env bash
# Vendoring discipline, mechanized: any staged change under vendor/*/src or a
# vendored bin.js must come with a vendor/README.md change in the same commit
# (the manifest's local-modification log is the contract — see vendor/README.md).
# 文件职责：阻止未同步更新 vendor/README.md 本地修改记录的 vendored 源码提交。
# 技术维度：使用 Bash 严格模式、Git 暂存区查询和 grep 正则筛选路径。
# 产品维度：保证发布使用的 vendored 代码与可审计修改清单始终一致。
# 逻辑维度：收集暂存路径，分别检测源码与清单变化，不匹配时输出诊断并失败。
# 关键边界：只检查暂存区；vendor 之外的文件和未暂存变化不属于本次判断。
# 新手阅读建议：先看两个筛选变量，再理解最终 if 如何要求它们同时出现。
set -euo pipefail

# 全部暂存文件路径，一行一个；空提交时为空字符串。
staged=$(git diff --cached --name-only)

# vendored src 或 bin.js 的暂存路径；无匹配时用 true 避免严格模式提前退出。
vendor_src_changed=$(echo "$staged" | grep -E '^vendor/[^/]+/(src/|bin\.js)' || true)
# vendor 清单自身的精确暂存匹配；非空表示本提交同步更新了修改记录。
manifest_changed=$(echo "$staged" | grep -x 'vendor/README.md' || true)

# 只有源码已变且清单未变时拒绝提交；两者均为空或同时变化都允许继续。
if [[ -n "$vendor_src_changed" && -z "$manifest_changed" ]]; then
  echo 'vendor manifest guard: vendored SOURCE changed without updating vendor/README.md:'
  echo "$vendor_src_changed" | sed 's/^/  /'
  echo 'Log the modification in vendor/README.md ("Local modifications") and stage it.'
  exit 1
fi
