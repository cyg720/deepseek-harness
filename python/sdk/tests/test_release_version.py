"""Tests for repository-owned Python release versions."""
# 文件职责：验证 test_release_version.py 覆盖的Python SDK 与捆绑运行时职责。
# 技术维度：使用 Python、异步 I/O、JSON-RPC、构建后端或标准库文件与进程接口。
# 产品维度：保障 Agent 的Python SDK 与捆绑运行时能力可安装、可调用且可诊断。
# 逻辑维度：解析参数或数据，执行核心调用或校验，再返回结果并处理资源清理。
# 关键边界：外部进程与文件不可信；版本和平台条件必须显式；敏感环境变量不得泄露。
# 新手阅读建议：先看导入和公开类型，再读主流程，最后关注异常、平台差异和清理。

from __future__ import annotations

import json
import runpy
from pathlib import Path
from types import SimpleNamespace

import pytest


# 中文说明：常量 ROOT 保存本测试共享的固定值；取值由紧邻初始化或后续赋值决定。
ROOT = Path(__file__).resolve().parents[3]
# 中文说明：常量 SCRIPT 保存本测试共享的固定值；取值由紧邻初始化或后续赋值决定。
SCRIPT = ROOT / "scripts" / "build-python-release.py"
# 中文说明：变量 build_python_release 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
build_python_release = SimpleNamespace(**runpy.run_path(str(SCRIPT)))


# 中文说明：函数 test_repository_version_matches_root_package_json 承担本测试的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def test_repository_version_matches_root_package_json() -> None:
    # 中文说明：变量 expected 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    expected = json.loads((ROOT / "package.json").read_text())["version"]

    assert build_python_release.repository_version() == expected


# 中文说明：函数 test_release_tag_is_optional_for_non_release_builds 承担本测试的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def test_release_tag_is_optional_for_non_release_builds() -> None:
    build_python_release.validate_release_tag(None, "1.2.3")


# 中文说明：函数 test_release_tag_must_match_repository_version 承担本测试的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def test_release_tag_must_match_repository_version() -> None:
    build_python_release.validate_release_tag("python-v1.2.3", "1.2.3")

    with pytest.raises(ValueError, match="expected 'python-v1.2.3'"):
        build_python_release.validate_release_tag("python-v1.2.4", "1.2.3")


# 中文说明：函数 test_repository_version_accepts_a_prerelease 承担本测试的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def test_repository_version_accepts_a_prerelease(tmp_path: Path) -> None:
    (tmp_path / "package.json").write_text('{"version":"1.2.3-rc.1"}\n')

    assert build_python_release.repository_version(tmp_path) == "1.2.3-rc.1"


# 中文说明：函数 test_repository_version_rejects_malformed_versions 承担本测试的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def test_repository_version_rejects_malformed_versions(tmp_path: Path) -> None:
    (tmp_path / "package.json").write_text('{"version":"v1.2"}\n')

    with pytest.raises(ValueError, match="must be X.Y.Z"):
        build_python_release.repository_version(tmp_path)


# 中文说明：函数 test_pep440_version_spells_a_prerelease_the_python_way 承担本测试的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def test_pep440_version_spells_a_prerelease_the_python_way() -> None:
    # Build backends normalize to this spelling, so the wheel filename and
    # metadata checks compare against it rather than the repository version.
    assert build_python_release.pep440_version("1.2.3") == "1.2.3"
    assert build_python_release.pep440_version("1.2.3-rc.1") == "1.2.3rc1"
    assert build_python_release.pep440_version("1.2.3-alpha.2") == "1.2.3a2"
    assert build_python_release.pep440_version("1.2.3-beta.10") == "1.2.3b10"

    with pytest.raises(ValueError, match="no PEP 440 spelling"):
        build_python_release.pep440_version("1.2.3-nightly")


# 中文说明：函数 test_macos_wheel_tag_does_not_claim_unsupported_node_platforms 承担本测试的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def test_macos_wheel_tag_does_not_claim_unsupported_node_platforms() -> None:
    assert build_python_release.PLATFORMS["macos-arm64"][0] == "macosx_14_0_arm64"
    assert build_python_release.PLATFORMS["macos-arm64"][1] == "deepseek-harness-sdk-runtime-macos-arm64"
    assert build_python_release.PLATFORMS["macos-x64"][0] == "macosx_14_0_x86_64"
    assert build_python_release.PLATFORMS["macos-x64"][1] == "deepseek-harness-sdk-runtime-macos-x64"


def test_windows_wheel_tag_and_payload_are_x64_only() -> None:
    assert build_python_release.PLATFORMS["win-x64"] == (
        "win_amd64",
        "deepseek-harness-sdk-runtime-win-x64.exe",
    )
    assert not any(name.startswith("win-") and name != "win-x64" for name in build_python_release.PLATFORMS)


# 中文说明：函数 test_platform_manifest_rejects_incomplete_entries 承担本测试的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def test_platform_manifest_rejects_incomplete_entries(tmp_path: Path) -> None:
    # 中文说明：变量 manifest 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    manifest = tmp_path / "platforms.json"
    manifest.write_text('{"macos-arm64":{"tag":"macosx_14_0_arm64"}}\n')

    with pytest.raises(ValueError, match="tag and executable fields"):
        build_python_release.load_platforms(manifest)


# 中文说明：函数 test_stage_sdk_keeps_distribution_module_and_runtime_pin_distinct 承担本测试的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def test_stage_sdk_keeps_distribution_module_and_runtime_pin_distinct(tmp_path: Path) -> None:
    # 中文说明：变量 destination 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    destination = tmp_path / "staging"

    build_python_release.stage_sdk(destination, "1.2.3")

    # 中文说明：变量 pyproject 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    pyproject = (destination / "pyproject.toml").read_text()
    assert 'name = "deepseek-harness-sdk"' in pyproject
    assert 'version = "1.2.3"' in pyproject
    assert 'license = "MIT"' in pyproject
    assert '"deepseek-harness-runtime-bin==1.2.3"' in pyproject
    assert 'license-files = ["LICENSE"]' in pyproject
    assert (destination / "LICENSE").read_bytes() == (ROOT / "LICENSE").read_bytes()
    assert (destination / "src" / "deepseek_harness" / "__init__.py").is_file()


@pytest.mark.parametrize(
    ("target", "with_helper"),
    [("linux-x64", False), ("macos-arm64", True), ("macos-x64", True), ("win-x64.exe", False)],
)
def test_stage_runtime_copies_platform_payload(
    tmp_path: Path, target: str, with_helper: bool
) -> None:
    executable = tmp_path / f"deepseek-harness-sdk-runtime-{target}"
    executable.write_bytes(b"runtime")
    executable.chmod(0o755)
    # 中文说明：变量 expected 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    expected = {executable.name: b"runtime"}
    ripgrep = (
        executable.with_name(f"{executable.stem}-rg.exe")
        if executable.suffix == ".exe"
        else Path(f"{executable}-rg")
    )
    ripgrep.write_bytes(b"ripgrep")
    ripgrep.chmod(0o755)
    expected[ripgrep.name] = b"ripgrep"
    if with_helper:
        # 中文说明：变量 spawn_helper 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        spawn_helper = Path(f"{executable}-spawn-helper")
        spawn_helper.write_bytes(b"helper")
        spawn_helper.chmod(0o755)
        expected[spawn_helper.name] = b"helper"
    # 中文说明：变量 destination 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    destination = tmp_path / "staging"

    build_python_release.stage_runtime(destination, "1.2.3", executable, executable.name)

    # 中文说明：变量 runtime_dir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    runtime_dir = destination / "src" / "deepseek_harness_runtime" / "runtime"
    assert {
        path.name: path.read_bytes()
        for path in runtime_dir.glob("deepseek-harness-sdk-runtime-*")
    } == expected
    pyproject = (destination / "pyproject.toml").read_text()
    assert 'license = "MIT"' in pyproject
    assert 'license-files = ["LICENSE", "THIRD_PARTY_NOTICES.md"]' in pyproject
    assert 'dsh = "deepseek_harness_runtime:main"' in pyproject
    assert (destination / "platforms.json").read_bytes() == (
        ROOT / "python" / "sdk-runtime" / "platforms.json"
    ).read_bytes()
    assert (destination / "LICENSE").read_bytes() == (ROOT / "LICENSE").read_bytes()
    assert (destination / "THIRD_PARTY_NOTICES.md").read_bytes() == (
        ROOT / "THIRD_PARTY_NOTICES.md"
    ).read_bytes()


def test_stage_runtime_rejects_a_noncanonical_executable_name(tmp_path: Path) -> None:
    executable = tmp_path / "renamed.exe"
    executable.write_bytes(b"runtime")

    with pytest.raises(ValueError, match="must be named deepseek-harness-sdk-runtime-win-x64.exe"):
        build_python_release.stage_runtime(
            tmp_path / "staging",
            "1.2.3",
            executable,
            "deepseek-harness-sdk-runtime-win-x64.exe",
        )
