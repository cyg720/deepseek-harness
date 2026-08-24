#!/usr/bin/env bash
# 文件职责：在 Ubuntu x86_64 CI 运行器中下载、校验、解包并功能探测固定版本的 bubblewrap。
# 技术维度：使用严格 Bash、HTTPS 下载、SHA-256 校验、dpkg-deb、sysctl 和最小 bwrap 沙箱探针。
# 产品维度：为 Linux 沙箱测试提供可信且可复现的 bubblewrap，而不执行耗时的系统包事务。
# 逻辑维度：校验环境与平台，下载固定 deb 并验签，解包加入 PATH，放宽可选 AppArmor 开关，执行版本和功能探针。
# 关键边界：仅支持 Linux x86_64 GitHub hosted runner；版本、URL、哈希必须同步更新，RUNNER_TEMP/GITHUB_PATH 必填。
# 新手阅读建议：先看三个只读常量和环境断言，再按下载、校验、解包、系统设置、功能探针顺序阅读。
set -euo pipefail

# Ubuntu's package transaction scans the hosted image's full dpkg database and
# runs post-install hooks. CI needs only the signed-archive payload, so pin and
# verify that payload before extracting it into the ephemeral runner directory.
# Ubuntu 包事务会扫描完整 dpkg 数据库并运行钩子；CI 只需经签名归档中的载荷，因此固定并校验后直接解包。
# 固定的 Ubuntu bubblewrap 包版本；升级时必须重新计算下方哈希并核对 URL。
readonly BUBBLEWRAP_VERSION='0.9.0-1ubuntu0.1'
# 固定 deb 文件的 SHA-256；下载内容不一致时脚本立即失败。
readonly BUBBLEWRAP_SHA256='1b506492bd9c7fd0cdb4f02ac822f1d3e336b0aead5113c1239baf8db5db562a'
# Ubuntu 官方归档下载地址，由固定版本组成且仅选择 amd64 包。
readonly BUBBLEWRAP_URL="https://archive.ubuntu.com/ubuntu/pool/main/b/bubblewrap/bubblewrap_${BUBBLEWRAP_VERSION}_amd64.deb"

# CI 临时目录必须存在，所有下载与解包限制在其中。
: "${RUNNER_TEMP:?prepare-ci-bubblewrap requires RUNNER_TEMP}"
# GitHub Actions PATH 追加文件必须存在，用于让后续步骤找到 bwrap。
: "${GITHUB_PATH:?prepare-ci-bubblewrap requires GITHUB_PATH}"

# 平台守卫；归档和 ELF 架构固定为 Linux x86_64，其他平台立即拒绝。
if [[ "$(uname -s)" != 'Linux' || "$(uname -m)" != 'x86_64' ]]; then
  echo 'prepare-ci-bubblewrap supports only Linux x86_64 hosted runners' >&2
  exit 1
fi

# 下载的 deb 归档路径，位于受控 CI 临时目录。
archive="${RUNNER_TEMP}/bubblewrap_${BUBBLEWRAP_VERSION}_amd64.deb"
# 解包根目录，后续从其中的 usr/bin 调用 bwrap。
root="${RUNNER_TEMP}/dsh-bubblewrap"

curl --fail --silent --show-error --location --retry 3 --retry-all-errors --output "$archive" "$BUBBLEWRAP_URL"
printf '%s  %s\n' "$BUBBLEWRAP_SHA256" "$archive" | sha256sum --check --status
mkdir -p "$root"
dpkg-deb --extract "$archive" "$root"
printf '%s\n' "$root/usr/bin" >> "$GITHUB_PATH"

# 尽力关闭 Ubuntu 对非特权用户命名空间的 AppArmor 限制；键不存在时由随后的功能探针作最终判断。
sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0 \
  || echo 'apparmor userns knob absent — the functional probe decides'
"$root/usr/bin/bwrap" --version
"$root/usr/bin/bwrap" --ro-bind / / --dev /dev --unshare-pid --proc /proc --die-with-parent -- true
echo 'bubblewrap functional probe passed'
