#!/usr/bin/env python3
"""Reject runtime executables that require newer macOS than their wheel tag."""
# 文件职责：实现 check-macos-deployment-target.py 覆盖的Python 发布或平台校验脚本职责。
# 技术维度：使用 Python、异步 I/O、JSON-RPC、构建后端或标准库文件与进程接口。
# 产品维度：保障 Agent 的Python 发布或平台校验脚本能力可安装、可调用且可诊断。
# 逻辑维度：解析参数或数据，执行核心调用或校验，再返回结果并处理资源清理。
# 关键边界：外部进程与文件不可信；版本和平台条件必须显式；敏感环境变量不得泄露。
# 新手阅读建议：先看导入和公开类型，再读主流程，最后关注异常、平台差异和清理。

from __future__ import annotations

import argparse
import re
import runpy
import subprocess
from pathlib import Path


# 中文说明：常量 ROOT 保存本模块共享的固定值；取值由紧邻初始化或后续赋值决定。
ROOT = Path(__file__).resolve().parents[1]
# 中文说明：常量 RELEASE 保存本模块共享的固定值；取值由紧邻初始化或后续赋值决定。
RELEASE = runpy.run_path(str(ROOT / "scripts" / "build-python-release.py"))
MACOS_PLATFORMS = {
    name: details[0]
    for name, details in RELEASE["PLATFORMS"].items()
    if name.startswith("macos-")
}


# 中文说明：函数 parse_version 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def parse_version(value: str) -> tuple[int, ...]:
    """Parse a dot-separated numeric deployment version."""
    if re.fullmatch(r"\d+(?:\.\d+)*", value) is None:
        raise ValueError(f"invalid macOS deployment version: {value!r}")
    return tuple(int(part) for part in value.split("."))


# 中文说明：函数 claimed_version 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def claimed_version(platform_tag: str) -> tuple[int, ...]:
    """Return the minimum macOS version encoded by a wheel platform tag."""
    match = re.fullmatch(r"macosx_(\d+)_(\d+)_(?:arm64|x86_64)", platform_tag)
    if match is None:
        raise ValueError(f"unsupported macOS wheel platform tag: {platform_tag!r}")
    return int(match.group(1)), int(match.group(2))


# 中文说明：函数 parse_otool_deployment_target 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def parse_otool_deployment_target(output: str) -> tuple[int, ...]:
    """Return the newest deployment target from one or more Mach-O slices."""
    versions: list[tuple[int, ...]] = []
    command: str | None = None
    for line in output.splitlines():
        stripped = line.strip()
        if re.fullmatch(r"Load command \d+", stripped):
            command = None
        elif stripped == "cmd LC_BUILD_VERSION":
            command = "build"
        elif stripped == "cmd LC_VERSION_MIN_MACOSX":
            command = "minimum"
        elif command == "build" and (match := re.fullmatch(r"minos\s+(\d+(?:\.\d+)*)", stripped)):
            versions.append(parse_version(match.group(1)))
        elif command == "minimum" and (match := re.fullmatch(r"version\s+(\d+(?:\.\d+)*)", stripped)):
            versions.append(parse_version(match.group(1)))
    if not versions:
        raise ValueError("otool output contains no macOS deployment target load command")
    return max(versions)


# 中文说明：函数 deployment_target 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def deployment_target(executable: Path) -> tuple[int, ...]:
    """Read one Mach-O executable's deployment target with ``otool``."""
    if not executable.is_file():
        raise FileNotFoundError(f"runtime executable does not exist: {executable}")
    # 中文说明：变量 result 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    result = subprocess.run(
        ["otool", "-l", str(executable)],
        # 中文说明：变量 check 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        check=True,
        # 中文说明：变量 capture_output 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        capture_output=True,
        # 中文说明：变量 text 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        text=True,
    )
    try:
        return parse_otool_deployment_target(result.stdout)
    except ValueError as error:
        raise ValueError(f"{executable}: {error}") from error


# 中文说明：函数 ensure_compatible 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def ensure_compatible(
    executable: Path, actual: tuple[int, ...], platform_tag: str
) -> None:
    """Reject an executable whose deployment target exceeds its wheel claim."""
    # 中文说明：变量 claimed 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    claimed = claimed_version(platform_tag)
    # 中文说明：变量 width 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    width = max(len(actual), len(claimed))
    # 中文说明：变量 padded_actual 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    padded_actual = actual + (0,) * (width - len(actual))
    # 中文说明：变量 padded_claimed 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    padded_claimed = claimed + (0,) * (width - len(claimed))
    if padded_actual > padded_claimed:
        # 中文说明：变量 rendered 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        rendered = ".".join(str(part) for part in actual)
        raise RuntimeError(
            f"{executable} requires macOS {rendered} but the wheel claims {platform_tag}"
        )


# 中文说明：函数 validate_deployment_targets 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def validate_deployment_targets(
    executables: list[Path], platform_tag: str
) -> list[tuple[Path, tuple[int, ...]]]:
    """Validate every executable and return its measured deployment target."""
    # 中文说明：变量 measured 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    measured = [(executable, deployment_target(executable)) for executable in executables]
    # 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。
    for executable, actual in measured:
        ensure_compatible(executable, actual, platform_tag)
    return measured


# 中文说明：函数 main 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def main() -> None:
    # 中文说明：变量 parser 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--platform", choices=tuple(MACOS_PLATFORMS), required=True)
    parser.add_argument("executables", type=Path, nargs="+")
    # 中文说明：变量 args 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    args = parser.parse_args()
    platform_tag = MACOS_PLATFORMS[args.platform]
    for executable, version in validate_deployment_targets(args.executables, platform_tag):
        rendered = ".".join(str(part) for part in version)
        print(f"{executable}: macOS {rendered} <= {platform_tag}")


if __name__ == "__main__":
    main()
