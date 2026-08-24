#!/usr/bin/env bash
# 文件职责：拒绝第一方跟踪文件名中的 golden 术语，并提示改用准确的 expected 命名。
# 技术维度：使用 Bash 严格模式、Git pathspec、NUL 分隔读取、临时文件和退出码执行仓库门禁。
# 产品维度：统一测试期望文件命名，避免把可更新期望误称为不可变的“黄金”结果。
# 逻辑维度：定位仓库根，收集非 vendor 候选路径，读入违规数组；无违规成功，否则逐条报告并失败。
# 关键边界：vendor 路径遵循上游命名而排除；临时文件必须在脚本退出时删除。
# 新手阅读建议：先看 git ls-files 的包含与排除 pathspec，再看 violations 数组如何决定退出码。
set -euo pipefail

# Vendored upstream paths follow vendor/README.md instead of repository naming policy.
# vendored 上游路径遵循 vendor/README.md，不适用仓库第一方命名规则。
# root：Git 返回的仓库绝对根目录，供后续 ls-files 固定工作目录。
root=$(git rev-parse --show-toplevel)
# candidate_file：保存 NUL 分隔候选路径的临时文件，退出时由 trap 删除。
candidate_file=$(mktemp)
# 清理回调：无论正常结束还是失败退出，都删除本次临时候选文件。
trap 'unlink "$candidate_file"' EXIT
git -C "$root" ls-files -z -- \
  ':(icase,glob)*golden*' \
  ':(icase,glob)**/*golden*' \
  ':(exclude,glob)vendor/**' > "$candidate_file"

# violations：包含 golden 的非 vendor 跟踪路径数组，初始为空。
violations=()
# path：从 NUL 分隔临时文件读取的当前候选路径，可安全包含空格。
while IFS= read -r -d '' path; do
  violations+=("$path")
done < "$candidate_file"

# 成功分支：违规数组为空时报告结果并以状态 0 结束。
if (( ${#violations[@]} == 0 )); then
  echo 'check-expected-filenames: no tracked non-vendor filename contains "golden".'
  exit 0
fi

echo 'check-expected-filenames: tracked non-vendor filenames must not contain "golden":' >&2
printf '  %s\n' "${violations[@]}" >&2
echo 'Rename each file with an accurate term such as "expected".' >&2
exit 1
