"""Locate and execute the bundled dsh CLI shipped with the Python SDK runtime.

Two runtime carriers coexist under ``runtime/``, both injected by the repo's
``scripts/build-exe-for-python-sdk.ts`` build (neither is checked into git):

- **exe (production)**: single-file Node executables named
  ``deepseek-harness-sdk-runtime-<platform>-<arch>`` for Linux/macOS and an
  ``.exe`` counterpart for Windows. Each has a sibling ripgrep executable;
  macOS also uses a sibling ``-spawn-helper``. The target machine needs no
  Node installation.
- **node (dev-only)**: the full deploy closure under ``runtime/node/``
  (``package.json`` + ``node_modules/``), executed as ``node
  runtime/node/node_modules/@deepseek-ai/dsh/lib/bin.js`` on a
  system Node >= 22.19. It is the current checkout's source build, never
  selected automatically, and excluded from wheel/sdist distributions.

Both carriers execute the same dsh command grammar. The Python SDK selects the
``sdk`` profile and requires an explicit Harness home; the installed ``dsh``
console command requires ``DSH_HOME`` for the same reason.
"""

# 【文件职责】定位并执行 Python SDK 随包提供的 dsh 运行时；按平台检查可执行文件及必要侧车，开发模式才使用 Node 部署目录。
# 文件职责：实现 __init__.py 覆盖的Python SDK 与捆绑运行时职责。
# 技术维度：使用 Python、异步 I/O、JSON-RPC、构建后端或标准库文件与进程接口。
# 产品维度：保障 Agent 的Python SDK 与捆绑运行时能力可安装、可调用且可诊断。
# 逻辑维度：解析参数或数据，执行核心调用或校验，再返回结果并处理资源清理。
# 关键边界：外部进程与文件不可信；版本和平台条件必须显式；敏感环境变量不得泄露。
# 新手阅读建议：先看导入和公开类型，再读主流程，最后关注异常、平台差异和清理。

from __future__ import annotations

import os
import platform
import shutil
import sys
from pathlib import Path

# 中文说明：常量 PACKAGE_METADATA_FILENAME 保存本模块共享的固定值；取值由紧邻初始化或后续赋值决定。
PACKAGE_METADATA_FILENAME = "deepseek-harness-runtime.json"

# 中文说明：常量 RUNTIME_MODE_ENV_VAR 保存本模块共享的固定值；取值由紧邻初始化或后续赋值决定。
RUNTIME_MODE_ENV_VAR = "DSH_RUNTIME_MODE"

_PLATFORM_TAGS = {"linux": "linux", "darwin": "macos", "win32": "win"}
_ARCH_TAGS = {"x86_64": "x64", "amd64": "x64", "arm64": "arm64", "aarch64": "arm64"}

# 中文说明：变量 _EXE_ACQUISITION_HINT 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
_EXE_ACQUISITION_HINT = (
    "Two ways to get the executable: run `scripts/build-exe-for-python-sdk.ts` (via tsx) in a "
    "deepseek-harness checkout, or install the matching `deepseek-harness-runtime-bin` platform "
    "wheel retained by the `build-exe-for-python-sdk` CI workflow. For local development "
    "against a repo source build, explicitly select the dev-only node carrier with "
    f"{RUNTIME_MODE_ENV_VAR}=node (or resolve_bundled_launch_args('node'))."
)


# 中文说明：函数 bundled_package_dir 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def bundled_package_dir() -> Path:
    """Root directory of the installed runtime package data (the directory of this module)."""
    # 中文说明：变量 root 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    root = Path(__file__).resolve().parent
    # 中文说明：变量 metadata 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    metadata = root / PACKAGE_METADATA_FILENAME
    if not metadata.is_file():
        raise FileNotFoundError(f"deepseek-harness-runtime-bin is missing {metadata}")
    return root


def bundled_runtime_path() -> Path:
    """Absolute path of the bundled single-file runtime executable for the current platform.

    Raises FileNotFoundError when the platform is unsupported, the executable
    has not been placed into this package, the required ripgrep sidecar is
    missing, or the required macOS spawn helper is missing; the message names
    the acquisition routes (acquisition strategy is deliberately separate from
    this lookup interface, so an on-demand download can replace it without
    touching callers).
    """
    # 中文说明：变量 tag 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    tag = _current_platform_tag()
    extension = ".exe" if tag.startswith("win-") else ""
    path = bundled_package_dir() / "runtime" / f"deepseek-harness-sdk-runtime-{tag}{extension}"
    if not path.is_file():
        raise FileNotFoundError(
            f"deepseek-harness-runtime-bin is missing the runtime executable at {path}. "
            + _EXE_ACQUISITION_HINT
        )
    ripgrep = (
        path.with_name(f"{path.stem}-rg.exe")
        if tag.startswith("win-")
        else Path(f"{path}-rg")
    )
    if not ripgrep.is_file():
        raise FileNotFoundError(
            f"deepseek-harness-runtime-bin is missing the ripgrep sidecar at {ripgrep}. "
            + _EXE_ACQUISITION_HINT
        )
    if tag.startswith("macos-"):
        # 中文说明：变量 helper 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        helper = Path(f"{path}-spawn-helper")
        if not helper.is_file():
            raise FileNotFoundError(
                f"deepseek-harness-runtime-bin is missing the node-pty spawn helper at {helper}. "
                + _EXE_ACQUISITION_HINT
            )
    return path


# 中文说明：函数 resolve_bundled_launch_args 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def resolve_bundled_launch_args(mode: str | None = None) -> tuple[str, ...]:
    """The argv tuple that launches the bundled runtime.

    Mode selection: the explicit ``mode`` argument wins, then the
    ``DSH_RUNTIME_MODE`` environment variable (``exe`` | ``node``), then
    automatic resolution. Automatic resolution finds the production exe ONLY —
    the dev-only node carrier must be selected explicitly so a production
    deployment can never silently ride on a source build. Returns
    ``(exe_path,)`` in exe mode and ``(node_path, bin_js_path)`` in node mode;
    raises FileNotFoundError when the selected carrier is unavailable and
    ValueError for an unknown mode value.
    """
    # 中文说明：变量 selected 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    selected = mode if mode is not None else os.environ.get(RUNTIME_MODE_ENV_VAR)
    if selected is None or selected == "exe":
        return (str(bundled_runtime_path()),)
    if selected == "node":
        return _node_launch_args()
    raise ValueError(
        f"unsupported DeepSeek Harness runtime mode {selected!r}: expected 'exe' or 'node' "
        f"(explicit argument or ${RUNTIME_MODE_ENV_VAR})"
    )


# 中文说明：函数 _current_platform_tag 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def _current_platform_tag() -> str:
    # 中文说明：变量 plat 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    plat = _PLATFORM_TAGS.get(sys.platform)
    # 中文说明：变量 arch 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    arch = _ARCH_TAGS.get(platform.machine().lower())
    if (
        plat is None
        or arch is None
        or (plat == "win" and arch != "x64")
    ):
        raise FileNotFoundError(
            "no bundled DeepSeek Harness SDK runtime exists for this platform "
            f"(sys.platform={sys.platform!r}, machine={platform.machine()!r}); supported: "
            "Linux x64/arm64, macOS x64/arm64, and Windows x64. " + _EXE_ACQUISITION_HINT
        )
    return f"{plat}-{arch}"


# 中文说明：函数 _node_launch_args 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def _node_launch_args() -> tuple[str, str]:
    # 中文说明：变量 node_root 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    node_root = bundled_package_dir() / "runtime" / "node"
    # 中文说明：变量 bin_js 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    bin_js = (
        node_root
        / "node_modules"
        / "@deepseek-ai"
        / "dsh"
        / "lib"
        / "bin.js"
    )
    if not bin_js.is_file():
        raise FileNotFoundError(
            f"the dev-only node runtime closure is missing at {node_root} "
            f"(no {bin_js}); run `scripts/build-exe-for-python-sdk.ts` in a deepseek-harness "
            "checkout, which builds and copies the deploy closure here. The node carrier "
            "is for repo-local development only — production uses the single-file exe."
        )
    # 中文说明：变量 node 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    node = shutil.which("node")
    if node is None:
        raise FileNotFoundError(
            "the node runtime mode needs a system `node` (>=22.19) on PATH; "
            "install Node.js or use the exe mode"
        )
    return (node, str(bin_js))


def main() -> None:
    """Execute the bundled dsh CLI with an explicitly selected Harness home."""
    if not os.environ.get("DSH_HOME", "").strip():
        print(
            "dsh: the Python runtime command requires an explicit DSH_HOME; "
            "it never uses ~/.dsh implicitly",
            file=sys.stderr,
        )
        raise SystemExit(2)
    argv = (*resolve_bundled_launch_args(), *sys.argv[1:])
    os.execvpe(argv[0], argv, os.environ)


__all__ = [
    "PACKAGE_METADATA_FILENAME",
    "RUNTIME_MODE_ENV_VAR",
    "bundled_package_dir",
    "bundled_runtime_path",
    "main",
    "resolve_bundled_launch_args",
]
