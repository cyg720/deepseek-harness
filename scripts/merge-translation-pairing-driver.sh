#!/bin/sh
# 文件职责：作为 Git 合并驱动入口，优先运行仓库感知的翻译配对合并器，缺少运行时时退回文本冲突。
# 技术维度：使用 POSIX Shell、Node.js tsx/esm、git merge-file 和明确退出码连接 Git merge driver。
# 产品维度：保护双语翻译元数据，避免普通文本合并生成未经校验但看似成功的配对记录。
# 逻辑维度：校验四个参数，定位 TypeScript 驱动，探测 Node 运行时；可用时 exec，否则执行三方文本合并并保持冲突未解决。
# 关键边界：必须由 Git 传入四个路径；即使后备文本合并干净也返回 1，只有严重工具错误透传大于 127 的状态。
# 新手阅读建议：先看四个路径变量，再比较 Node 正常路径和 git merge-file 后备路径，最后理解退出码为何故意非零。

# 合并驱动必须接收祖先、当前、另一侧和仓库元数据路径四个参数；数量不符返回 Git 用法错误码 129。
if [ "$#" -ne 4 ]; then
  echo 'merge-translation-pairing: expected <ancestor> <current> <other> <repository-path>' >&2
  exit 129
fi

# 共同祖先版本的临时文件路径；由 Git 作为第一个参数提供。
ancestor_path=$1
# 当前分支版本的临时文件路径；后备合并会原地更新它。
current_path=$2
# 另一分支版本的临时文件路径。
other_path=$3
# 配对元数据在仓库中的逻辑路径；用于诊断和冲突标签。
meta_path=$4
# 当前脚本所在的规范绝对目录；CDPATH 置空避免用户环境改变 cd 输出。
driver_directory=$(CDPATH= cd -P "$(dirname "$0")" && pwd) || exit 129
# 仓库感知 TypeScript 合并驱动的绝对路径。
driver_path=$driver_directory/merge-translation-pairing.ts

# 先确认 node 存在且驱动探针成功；两者成立时用 exec 替换 shell 并原样传递四个路径。
if command -v node >/dev/null 2>&1 \
  && node --import tsx/esm "$driver_path" --probe >/dev/null 2>&1; then
  exec node --import tsx/esm "$driver_path" \
    "$ancestor_path" "$current_path" "$other_path" "$meta_path"
fi

echo "merge-translation-pairing: runtime is unavailable; leaving an ordinary text conflict in $meta_path" >&2
# 后备三方文本合并；标签包含逻辑路径和版本角色，便于人工识别冲突块。
git merge-file \
  -L "$meta_path:current" \
  -L "$meta_path:ancestor" \
  -L "$meta_path:other" \
  -- "$current_path" "$ancestor_path" "$other_path"
# git merge-file 的退出状态；0 表示文本可合并，1 表示冲突，大于 127 表示工具错误。
fallback_status=$?
echo 'merge-translation-pairing: restore Node dependencies, then rerun the merge or `pnpm run resolve-translation-pairing-conflicts`; use `git merge --abort` to cancel' >&2

# A clean text merge is still unverified pairing metadata, so the driver must
# leave Git's index stages unresolved until the repository-aware resolver runs.
# 即使文本合并没有冲突，配对元数据仍未经仓库规则验证，因此必须让 Git 保持未解决状态。
if [ "$fallback_status" -gt 127 ]; then
  exit "$fallback_status"
fi
exit 1
