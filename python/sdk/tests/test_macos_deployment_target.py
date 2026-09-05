"""Tests for macOS runtime wheel deployment-target validation."""
# 文件职责：验证 macOS 运行时 wheel 的部署目标解析与兼容性检查。
# 技术维度：使用 pytest、runpy 和模拟的 otool 输出，直接调用构建检查脚本中的函数。
# 产品维度：阻止发布只能在过新 macOS 版本运行的 Python 运行时包。
# 逻辑维度：先加载检查脚本，再分别覆盖多架构解析、缺失目标和可执行文件版本过新三类情况。
# 关键边界：测试输入模拟外部工具文本；这里只验证版本判断，不实际构建或检查 wheel。
# 新手阅读建议：先看 ROOT、SCRIPT、checker 如何找到被测代码，再按三个 test_ 函数理解成功与失败路径。

from __future__ import annotations

import runpy
from pathlib import Path
from types import SimpleNamespace

import pytest


# 仓库根目录；parents[3] 依赖本测试文件当前的目录层级。
ROOT = Path(__file__).resolve().parents[3]
# 被测构建检查脚本的绝对路径；脚本必须位于仓库 scripts 目录。
SCRIPT = ROOT / "scripts" / "check-macos-deployment-target.py"
# 由脚本全局名称构成的便捷对象；仅供测试调用其中的内部检查函数。
checker = SimpleNamespace(**runpy.run_path(str(SCRIPT)))


# 功能：确认多架构输出选择最高部署版本。参数：无。返回值：无，断言失败时由 pytest 报错。示例：pytest -k newest_macho_slice。
def test_otool_parser_uses_the_newest_macho_slice() -> None:
    # 模拟两个 Mach-O 切片的 otool 文本；第二个切片的 13.5 应成为最终结果。
    output = """
Load command 8
      cmd LC_VERSION_MIN_MACOSX
  cmdsize 16
  version 10.7
      sdk 11.1
Load command 9
      cmd LC_BUILD_VERSION
    minos 11.0
Load command 10
      cmd LC_BUILD_VERSION
    minos 13.5
    """

    assert checker.parse_otool_deployment_target(output) == (13, 5)


# 功能：确认缺少部署目标字段时拒绝输入。参数：无。返回值：无。示例：pytest -k requires_a_deployment_target。
def test_otool_parser_requires_a_deployment_target() -> None:
    with pytest.raises(ValueError, match="contains no macOS deployment target"):
        checker.parse_otool_deployment_target("Load command 0\n")


def test_otool_parser_ignores_unrelated_version_fields() -> None:
    output = """
Load command 1
          cmd LC_ID_DYLIB
      cmdsize 48
      current version 14.1.0
compatibility version 1.0.0
    """

    with pytest.raises(ValueError, match="contains no macOS deployment target"):
        checker.parse_otool_deployment_target(output)


def test_wheel_tag_rejects_a_newer_executable_target() -> None:
    checker.ensure_compatible(Path("runtime"), (13, 5), "macosx_14_0_arm64")
    checker.ensure_compatible(Path("runtime-x64"), (10, 7), "macosx_14_0_x86_64")

    with pytest.raises(RuntimeError, match="requires macOS 14.1"):
        checker.ensure_compatible(Path("spawn-helper"), (14, 1), "macosx_14_0_arm64")


def test_wheel_tag_accepts_only_supported_macos_architectures() -> None:
    assert checker.claimed_version("macosx_14_0_arm64") == (14, 0)
    assert checker.claimed_version("macosx_14_0_x86_64") == (14, 0)

    with pytest.raises(ValueError, match="unsupported macOS wheel platform tag"):
        checker.claimed_version("macosx_14_0_universal2")
