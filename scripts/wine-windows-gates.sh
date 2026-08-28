#!/usr/bin/env bash
# Run the blocking Windows gates (workspace build, production site) with real
# win-x64 Node.js under Wine — the same script the pull-request `windows` job
# in ci.yml executes and the optional local gate `pnpm run check:windows-wine`
# wraps. Owning rationale and fidelity limits:
# .agents/notes/implemented/process/2026-08-08-native-windows-pull-request-ci.md
#
# The working tree is never mutated: tracked plus untracked-unignored files
# are snapshotted into a scratch directory, the Wine-specific pnpm overrides
# (hoisted layout, win32-x64 platform packages) are appended to the SNAPSHOT's
# pnpm-workspace.yaml, and the install and gates run there against the shared
# pnpm store. The Wine prefix and the checksum-verified Windows Node zip
# persist in .cache/wine-windows/ so reruns skip provisioning.
#
# Environment: DSH_WINE_NODE_MAJOR (default $PRIMARY_NODE_VERSION, then 24)
# picks the Windows Node line; DSH_WINE_GATE_CACHE_DIR relocates the cache;
# DSH_WINE_GATE_KEEP=1 preserves the scratch tree for inspection.

# 文件职责：执行 Wine 环境下的 Windows 构建、站点和发布门禁。
# 技术维度：使用 Bash、Wine、Windows Node.js、pnpm、校验和与临时工作树。
# 产品维度：在非 Windows 主机上提前发现 Windows 发布路径和构建兼容性问题。
# 逻辑维度：检查依赖，准备缓存与临时快照，并行安装和配置，再运行门禁并汇总日志。
# 关键边界：仅用于诊断已知 Windows 问题；下载必须校验；临时树和 Wine 进程必须可靠清理。
# 新手阅读建议：先看预检与缓存变量，再读 Node 准备和仓库快照，最后关注门禁执行与 cleanup。
set -euo pipefail

# 中文说明：变量 repo_root 保存当前步骤的路径、工具或配置值；取值由紧邻赋值和环境变量决定。
repo_root="$(git rev-parse --show-toplevel)"
# 中文说明：变量 node_major 保存当前步骤的路径、工具或配置值；取值由紧邻赋值和环境变量决定。
node_major="${DSH_WINE_NODE_MAJOR:-${PRIMARY_NODE_VERSION:-24}}"
# 中文说明：变量 cache_dir 保存当前步骤的路径、工具或配置值；取值由紧邻赋值和环境变量决定。
cache_dir="${DSH_WINE_GATE_CACHE_DIR:-$repo_root/.cache/wine-windows}"

export WINEDEBUG='-all'
export WINEARCH=win64
# Skip Wine Mono / Gecko installers: Node needs neither.
export WINEDLLOVERRIDES='mscoree,mshtml='
export WINEPREFIX="$cache_dir/prefix"

# ---- preflight: fail loud before any expensive work --------------------
# 中文说明：变量 wine_bin 保存当前步骤的路径、工具或配置值；取值由紧邻赋值和环境变量决定。
wine_bin=''
# 中文说明：该循环依次检查候选工具或文件；循环变量仅在当前循环中有效。
for candidate in "$(command -v wine || true)" "$(command -v wine64 || true)" /usr/lib/wine/wine64; do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then wine_bin="$candidate"; break; fi
done
# GNU coreutils sha256sum on Linux; perl shasum ships with macOS. Both
# accept the same "<hash>  <file>" --check input.
# 中文说明：变量 checksum_tool 保存当前步骤的路径、工具或配置值；取值由紧邻赋值和环境变量决定。
checksum_tool=''
if command -v sha256sum > /dev/null; then
  # 中文说明：变量 checksum_tool 保存当前步骤的路径、工具或配置值；取值由紧邻赋值和环境变量决定。
  checksum_tool='sha256sum'
elif command -v shasum > /dev/null; then
  # 中文说明：变量 checksum_tool 保存当前步骤的路径、工具或配置值；取值由紧邻赋值和环境变量决定。
  checksum_tool='shasum'
fi
# 中文说明：变量 missing 保存当前步骤的路径、工具或配置值；取值由紧邻赋值和环境变量决定。
missing=()
[ -n "$wine_bin" ] || missing+=('wine (apt: wine | brew: wine-stable)')
command -v curl > /dev/null || missing+=('curl')
command -v unzip > /dev/null || missing+=('unzip')
[ -n "$checksum_tool" ] || missing+=('sha256sum or shasum (apt: coreutils | macOS ships shasum)')
if ! command -v pnpm > /dev/null; then corepack enable > /dev/null 2>&1 || true; fi
command -v pnpm > /dev/null || missing+=('pnpm (corepack enable)')
if (( ${#missing[@]} > 0 )); then
  printf 'wine-windows-gates: missing required tool: %s\n' "${missing[@]}" >&2
  exit 1
fi

# Verify file $2 against SHA-256 hex $1 with whichever tool preflight found.
# 中文说明：函数 verify_sha256 执行一个独立门禁步骤；参数通过位置参数或环境读取，退出状态表示成功或失败；示例见本脚本调用。
verify_sha256() {
  case "$checksum_tool" in
    sha256sum) printf '%s  %s\n' "$1" "$2" | sha256sum --check - > /dev/null ;;
    shasum) printf '%s  %s\n' "$1" "$2" | shasum -a 256 --check - > /dev/null ;;
  esac
}

# 中文说明：变量 scratch 保存当前步骤的路径、工具或配置值；取值由紧邻赋值和环境变量决定。
scratch="$(mktemp -d "${TMPDIR:-/tmp}/dsh-wine-gates.XXXXXX")"
# 中文说明：函数 cleanup 执行一个独立门禁步骤；参数通过位置参数或环境读取，退出状态表示成功或失败；示例见本脚本调用。
cleanup() {
  wineserver -k > /dev/null 2>&1 || true
  if [ "${DSH_WINE_GATE_KEEP:-0}" = '1' ]; then
    echo "wine-windows-gates: scratch tree kept at $scratch"
  else
    rm -rf "$scratch"
  fi
}
trap cleanup EXIT
mkdir -p "$cache_dir" "$scratch/logs"

# ---- provision Windows Node, boot Wine, snapshot + install concurrently ----
# 中文说明：变量 curl_metadata_args 保存当前步骤的路径、工具或配置值；取值由紧邻赋值和环境变量决定。
curl_metadata_args=(
  --fail --silent --show-error --location
  --retry 3 --retry-all-errors --retry-delay 2
  --http1.1 --connect-timeout 10 --max-time 30 --retry-max-time 120
)

# 中文说明：函数 download_node_archive 执行一个独立门禁步骤；参数通过位置参数或环境读取，退出状态表示成功或失败；示例见本脚本调用。
download_node_archive() {
  local version="$1" output="$2" attempt status=0
  local archive="node-$version-win-x64.zip"
  local primary_url="https://nodejs.org/dist/$version/$archive"
  local mirror_url="https://npmmirror.com/mirrors/node/$version/$archive"

  if curl --fail --silent --show-error --location --http1.1 \
    --connect-timeout 10 --max-time 300 --speed-limit 1024 --speed-time 30 \
    -o "$output" "$primary_url"; then
    return 0
  fi
  echo 'wine-windows-gates: nodejs.org archive transfer stalled; resuming from the checksum-untrusted transport mirror' >&2
  # 中文说明：该循环依次检查候选工具或文件；循环变量仅在当前循环中有效。
  for attempt in 1 2 3; do
    if curl --fail --silent --show-error --location --http1.1 \
      --continue-at - --connect-timeout 10 --max-time 300 \
      --speed-limit 1024 --speed-time 30 \
      -o "$output" "$mirror_url"; then
      return 0
    else
      # 中文说明：变量 status 保存当前步骤的路径、工具或配置值；取值由紧邻赋值和环境变量决定。
      status=$?
    fi
    (( attempt < 3 )) || break
    echo "wine-windows-gates: mirror transfer failed (exit $status) on attempt $attempt; resuming partial download" >&2
  done
  return "$status"
}

# 中文说明：函数 provision_node 执行一个独立门禁步骤；参数通过位置参数或环境读取，退出状态表示成功或失败；示例见本脚本调用。
provision_node() {
  # Latest release of the primary line, checksum-verified against the same
  # dist directory. Bound and retry every transfer so a stalled nodejs.org
  # response cannot consume the entire CI job. Offline runs fall back to the
  # newest cached zip, loudly.
  local version zip
  # 中文说明：变量 version 保存当前步骤的路径、工具或配置值；取值由紧邻赋值和环境变量决定。
  version="$(curl "${curl_metadata_args[@]}" https://nodejs.org/dist/index.json 2> /dev/null \
    | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const v=JSON.parse(d).find(r=>r.version.startsWith('v$node_major.'));if(v)console.log(v.version)})" \
    || true)"
  if [ -n "$version" ]; then
    # 中文说明：变量 zip 保存当前步骤的路径、工具或配置值；取值由紧邻赋值和环境变量决定。
    zip="$cache_dir/node-$version-win-x64.zip"
    if [ ! -f "$zip" ]; then
      download_node_archive "$version" "$zip.tmp"
      local expected
      # 中文说明：变量 expected 保存当前步骤的路径、工具或配置值；取值由紧邻赋值和环境变量决定。
      expected="$(curl "${curl_metadata_args[@]}" "https://nodejs.org/dist/$version/SHASUMS256.txt" \
        | awk -v a="node-$version-win-x64.zip" '$2 == a { print $1; exit }')"
      [ -n "$expected" ] || { echo "wine-windows-gates: no SHASUMS256 entry for node-$version-win-x64.zip" >&2; exit 1; }
      verify_sha256 "$expected" "$zip.tmp"
      mv "$zip.tmp" "$zip"
    fi
  else
    # 中文说明：变量 zip 保存当前步骤的路径、工具或配置值；取值由紧邻赋值和环境变量决定。
    zip="$(ls -t "$cache_dir"/node-v"$node_major".*-win-x64.zip 2> /dev/null | head -1 || true)"
    [ -n "$zip" ] || { echo "wine-windows-gates: nodejs.org unreachable and no cached Windows Node v$node_major zip in $cache_dir" >&2; exit 1; }
    echo "wine-windows-gates: nodejs.org unreachable; using cached $(basename "$zip")" >&2
  fi
  unzip -q -o "$zip" -d "$scratch/node-win"
  echo "$scratch/node-win/$(basename "$zip" .zip)/node.exe" > "$scratch/node-win-path"
}

# 中文说明：函数 boot_wine 执行一个独立门禁步骤；参数通过位置参数或环境读取，退出状态表示成功或失败；示例见本脚本调用。
boot_wine() {
  "$wine_bin" wineboot --init > /dev/null 2>&1 || true
  wineserver -w || true
}

# 中文说明：函数 snapshot_and_install 执行一个独立门禁步骤；参数通过位置参数或环境读取，退出状态表示成功或失败；示例见本脚本调用。
snapshot_and_install() {
  # Tracked + untracked-unignored files, minus agent-session litter; the
  # existence filter drops paths staged as deleted. Then the Wine-specific
  # install-time overrides go on the SNAPSHOT only: hoisted because Windows
  # Node under Wine does not realpath pnpm's isolated-layout symlinks, and
  # win32-x64 so the Windows esbuild/rolldown/rollup binaries materialize.
  # Neither is recorded in the lockfile, so --frozen-lockfile stays valid;
  # --ignore-scripts skips host lifecycle scripts no gate loads.
  git -C "$repo_root" ls-files -z --cached --others --exclude-standard -- . ':!:.claude' ':!:.codex' \
    | while IFS= read -r -d '' file; do [ -e "$repo_root/$file" ] && printf '%s\0' "$file"; done \
    | tar -C "$repo_root" --null --files-from=- -cf - \
    | tar -C "$scratch/tree" -xf -
  cat >> "$scratch/tree/pnpm-workspace.yaml" << 'EOF'

nodeLinker: hoisted
supportedArchitectures:
  os: [current, win32]
  cpu: [current, x64]
EOF
  # The hoisted linker — used only by this lane — has an upstream rename
  # race (pnpm/pnpm#12880): parallel linkers staging a nested package copy
  # (observed on the tree's nested esbuild versions) rename their _tmp_*
  # directory onto a path another racer already claimed, and the loser
  # exits ERR_PNPM_ENOENT although an identical re-install succeeds.
  # Exactly that signature earns up to two retries on a clean tree — the
  # snapshot contains no node_modules, so wiping them restores the
  # pre-install state; any other failure, or the race still standing after
  # the final attempt, fails loud with the log tail.
  local attempt
  # 中文说明：该循环依次检查候选工具或文件；循环变量仅在当前循环中有效。
  for attempt in 1 2 3; do
    (cd "$scratch/tree" && pnpm install --frozen-lockfile --ignore-scripts > "$scratch/logs/install.log" 2>&1) \
      && return 0
    grep -q 'ERR_PNPM_ENOENT.*rename.*_tmp_' "$scratch/logs/install.log" || break
    (( attempt < 3 )) || break
    echo "wine-windows-gates: pnpm hoisted-linker rename race (pnpm/pnpm#12880) on install attempt $attempt; retrying on a clean tree" >&2
    find "$scratch/tree" -name node_modules -type d -prune -exec rm -rf {} +
  done
  tail -40 "$scratch/logs/install.log" >&2
  return 1
}

mkdir "$scratch/tree"
# 中文说明：变量 start 保存当前步骤的路径、工具或配置值；取值由紧邻赋值和环境变量决定。
start=$SECONDS
provision_node & node_pid=$!
boot_wine & wine_pid=$!
snapshot_and_install & install_pid=$!
# Wait for EVERY child before judging any: a bare `wait` under set -e would
# exit on the first failure and let the EXIT trap delete $scratch while the
# other children still run inside it. Named statuses also make the report
# point at the root cause instead of a downstream symptom.
# 中文说明：变量 node_status 保存当前步骤的路径、工具或配置值；取值由紧邻赋值和环境变量决定。
node_status=0; wait "$node_pid" || node_status=$?
# 中文说明：变量 wine_status 保存当前步骤的路径、工具或配置值；取值由紧邻赋值和环境变量决定。
wine_status=0; wait "$wine_pid" || wine_status=$?
# 中文说明：变量 install_status 保存当前步骤的路径、工具或配置值；取值由紧邻赋值和环境变量决定。
install_status=0; wait "$install_pid" || install_status=$?
# 中文说明：变量 provision_failed 保存当前步骤的路径、工具或配置值；取值由紧邻赋值和环境变量决定。
provision_failed=0
# 中文说明：函数 report_provision 执行一个独立门禁步骤；参数通过位置参数或环境读取，退出状态表示成功或失败；示例见本脚本调用。
report_provision() {
  if (( $2 != 0 )); then
    echo "wine-windows-gates: FAILED $1 (exit $2)" >&2
    # 中文说明：变量 provision_failed 保存当前步骤的路径、工具或配置值；取值由紧邻赋值和环境变量决定。
    provision_failed=$2
  fi
}
report_provision 'Windows Node provisioning' "$node_status"
report_provision 'wineboot' "$wine_status"
report_provision 'workspace snapshot + pnpm install' "$install_status"
if (( provision_failed != 0 )); then exit "$provision_failed"; fi
# 中文说明：变量 node_win 保存当前步骤的路径、工具或配置值；取值由紧邻赋值和环境变量决定。
node_win="$(cat "$scratch/node-win-path")"
echo "wine-windows-gates: provisioned in $((SECONDS - start))s (wine $("$wine_bin" --version 2> /dev/null), node $(basename "$(dirname "$node_win")"))"

# ---- resolve entrypoints, lay the vue link, smoke ------------------------
# Node under Wine cannot attach stdio to pipes the caller owns (Socket open
# EBADF at bootstrap), so every invocation routes stdio through a file.
# 中文说明：函数 wine_node 执行一个独立门禁步骤；参数通过位置参数或环境读取，退出状态表示成功或失败；示例见本脚本调用。
wine_node() {
  local log="$1"
  shift
  local status=0
  "$wine_bin" "$node_win" "$@" < /dev/null > "$log" 2>&1 || status=$?
  return "$status"
}

cd "$scratch/tree"
# 中文说明：变量 tsc_js 保存当前步骤的路径、工具或配置值；取值由紧邻赋值和环境变量决定。
tsc_js='node_modules/typescript/bin/tsc'
# 中文说明：变量 tsdown_js 保存当前步骤的路径、工具或配置值；取值由紧邻赋值和环境变量决定。
tsdown_js='node_modules/tsdown/dist/run.mjs'
# 中文说明：变量 vitepress_js 保存当前步骤的路径、工具或配置值；取值由紧邻赋值和环境变量决定。
vitepress_js='node_modules/vitepress/bin/vitepress.js'
[ -f "$vitepress_js" ] || vitepress_js='website/node_modules/vitepress/bin/vitepress.js'
# 中文说明：该循环依次检查候选工具或文件；循环变量仅在当前循环中有效。
for entry in "$tsc_js" "$tsdown_js" "$vitepress_js"; do
  [ -f "$entry" ] || { echo "wine-windows-gates: expected entrypoint missing after hoisted install: $entry" >&2; exit 1; }
done
# VitePress links vue into the site's node_modules at build time; Wine cannot
# CREATE Windows symlinks (ENOTSUP) but follows pre-existing Unix ones.
if [ -d node_modules/vue ] && [ ! -e website/node_modules/vue ]; then
  mkdir -p website/node_modules
  ln -s ../../node_modules/vue website/node_modules/vue
fi

wine_node "$scratch/logs/smoke.log" -p "'smoke: ' + process.platform + ' ' + process.arch + ' ' + process.version"
cat "$scratch/logs/smoke.log"
grep -q '^smoke: win32 x64' "$scratch/logs/smoke.log" || { echo 'wine-windows-gates: Windows Node smoke did not report win32 x64' >&2; exit 1; }

# ---- the two blocking surfaces, concurrently ------------------------------
# The build preserves the face order from package.json: compile and bundle the
# Host face before compiling and bundling the Client face.
# Both statuses are captured so one failure cannot hide the other's result.
# 中文说明：函数 build_gate 执行一个独立门禁步骤；参数通过位置参数或环境读取，退出状态表示成功或失败；示例见本脚本调用。
build_gate() {
  wine_node "$scratch/logs/host-tsc.log" --max-old-space-size=4096 "$tsc_js" -b tsconfig.host.json --pretty false || return $?
  wine_node "$scratch/logs/host-tsdown.log" "$tsdown_js" --env.DSH_BUILD_FACE host || return $?
  wine_node "$scratch/logs/client-tsc.log" "$tsc_js" -b tsconfig.client.json --pretty false || return $?
  wine_node "$scratch/logs/client-tsdown.log" "$tsdown_js" --env.DSH_BUILD_FACE client
}
# 中文说明：函数 site_gate 执行一个独立门禁步骤；参数通过位置参数或环境读取，退出状态表示成功或失败；示例见本脚本调用。
site_gate() {
  cd website
  wine_node "$scratch/logs/site.log" "../$vitepress_js" build .
}

# 中文说明：变量 start 保存当前步骤的路径、工具或配置值；取值由紧邻赋值和环境变量决定。
start=$SECONDS
build_gate & build_pid=$!
site_gate & site_pid=$!
# 中文说明：变量 build_status 保存当前步骤的路径、工具或配置值；取值由紧邻赋值和环境变量决定。
build_status=0
wait "$build_pid" || build_status=$?
# 中文说明：变量 site_status 保存当前步骤的路径、工具或配置值；取值由紧邻赋值和环境变量决定。
site_status=0
wait "$site_pid" || site_status=$?
# 中文说明：变量 elapsed 保存当前步骤的路径、工具或配置值；取值由紧邻赋值和环境变量决定。
elapsed=$((SECONDS - start))

# 中文说明：函数 report 执行一个独立门禁步骤；参数通过位置参数或环境读取，退出状态表示成功或失败；示例见本脚本调用。
report() {
  local label="$1" status="$2"
  shift 2
  if (( status == 0 )); then
    echo "wine-windows-gates: PASS $label (${elapsed}s window)"
  else
    echo "== FAILED $label (exit $status) ==" >&2
    # 中文说明：该循环依次检查候选工具或文件；循环变量仅在当前循环中有效。
    for log in "$@"; do tail -n 200 "$log" >&2 || true; done
  fi
}
report 'build (Host tsc/tsdown, Client tsc/tsdown)' "$build_status" \
  "$scratch/logs/host-tsc.log" \
  "$scratch/logs/host-tsdown.log" \
  "$scratch/logs/client-tsc.log" \
  "$scratch/logs/client-tsdown.log"
report 'production site (vitepress build)' "$site_status" "$scratch/logs/site.log"
if (( build_status != 0 )); then exit "$build_status"; fi
exit "$site_status"
