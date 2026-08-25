# 文件职责：实现 hatch_build.py 覆盖的Python SDK 与捆绑运行时职责。
# 技术维度：使用 Python、异步 I/O、JSON-RPC、构建后端或标准库文件与进程接口。
# 产品维度：保障 Agent 的Python SDK 与捆绑运行时能力可安装、可调用且可诊断。
# 逻辑维度：解析参数或数据，执行核心调用或校验，再返回结果并处理资源清理。
# 关键边界：外部进程与文件不可信；版本和平台条件必须显式；敏感环境变量不得泄露。
# 新手阅读建议：先看导入和公开类型，再读主流程，最后关注异常、平台差异和清理。
from __future__ import annotations

import json
import os
import platform
import stat
from pathlib import Path

from hatchling.builders.hooks.plugin.interface import BuildHookInterface


# 中文说明：函数 _load_platforms 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def _load_platforms() -> dict[str, tuple[str, str]]:
    """Load and validate the platform manifest inside an isolated wheel build."""
    # 中文说明：变量 path 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    path = Path(__file__).with_name("platforms.json")
    try:
        # 中文说明：变量 payload 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        payload = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError(f"could not read runtime platform manifest from {path}") from error
    if not isinstance(payload, dict) or not payload:
        raise RuntimeError(f"{path} must contain a non-empty platform object")
    # 中文说明：变量 platforms 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    platforms: dict[str, tuple[str, str]] = {}
    # 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。
    for name, raw in payload.items():
        if (
            not isinstance(name, str)
            or not isinstance(raw, dict)
            or set(raw) != {"tag", "executable"}
            or not isinstance(raw["tag"], str)
            or not isinstance(raw["executable"], str)
        ):
            raise RuntimeError(f"{path} platform entries must contain string tag and executable fields")
        platforms[name] = (raw["tag"], raw["executable"])
    return platforms


# 中文说明：变量 _PLATFORMS 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
_PLATFORMS = _load_platforms()


# 中文说明：函数 _host_platform_tag 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def _host_platform_tag() -> str:
    # 中文说明：变量 machine 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    machine = platform.machine().lower()
    # 中文说明：变量 arch 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    arch = "arm64" if machine in {"arm64", "aarch64"} else "x64" if machine in {"x86_64", "amd64"} else machine
    # 中文说明：变量 system 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    system = platform.system().lower()
    # 中文说明：变量 key 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    key = f"macos-{arch}" if system == "darwin" else f"linux-{arch}" if system == "linux" else system
    try:
        return _PLATFORMS[key][0]
    except KeyError as exc:
        raise RuntimeError(f"unsupported deepseek-harness-runtime-bin build platform: {key}") from exc


# 中文说明：类 RuntimeBuildHook 封装本模块所需的数据和行为，用于表达Python SDK 与捆绑运行时场景。
class RuntimeBuildHook(BuildHookInterface):
    """Assign the native wheel tag and reject incomplete or mixed-platform payloads."""

    # 中文说明：函数 initialize 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
    def initialize(self, version: str, build_data: dict[str, object]) -> None:
        if version == "editable":
            return
        if self.target_name == "sdist":
            raise RuntimeError(
                "deepseek-harness-runtime-bin is wheel-only; build and publish platform wheels only."
            )

        # 中文说明：变量 platform_tag 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        platform_tag = os.environ.get("DSH_RUNTIME_PLATFORM_TAG") or _host_platform_tag()
        # 中文说明：变量 matches 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        matches = [value for value in _PLATFORMS.values() if value[0] == platform_tag]
        if len(matches) != 1:
            # 中文说明：变量 supported 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            supported = ", ".join(value[0] for value in _PLATFORMS.values())
            raise RuntimeError(
                f"unsupported DSH_RUNTIME_PLATFORM_TAG {platform_tag!r}; expected one of {supported}"
            )
        # 中文说明：变量 expected_executable 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        expected_executable = matches[0][1]
        # 中文说明：变量 runtime_dir 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        runtime_dir = Path(self.root) / "src" / "deepseek_harness_runtime" / "runtime"
        # 中文说明：变量 runtime_files 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        runtime_files = sorted(runtime_dir.glob("dsh-jsonrpc-agent-pkg-*") if runtime_dir.is_dir() else [])
        # 中文说明：变量 expected_files 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        expected_files = [expected_executable, f"{expected_executable}-rg"]
        if "-macos-" in expected_executable:
            expected_files.append(f"{expected_executable}-spawn-helper")
        # 中文说明：变量 found_files 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        found_files = [path.name for path in runtime_files]
        if found_files != expected_files:
            raise RuntimeError(
                f"runtime wheel {platform_tag} payload must be {expected_files}; found {found_files}"
            )
        # 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。
        for executable in runtime_files:
            if executable.stat().st_mode & stat.S_IXUSR == 0:
                raise RuntimeError(f"runtime executable is not executable: {executable}")
        build_data["pure_python"] = False
        build_data["infer_tag"] = False
        build_data["tag"] = f"py3-none-{platform_tag}"
