"""Keyless runtime-resolution tests; launch coverage lives in test_bundled_runtime.py."""
# 文件职责：验证 test_runtime_resolution.py 覆盖的Python SDK 与捆绑运行时职责。
# 技术维度：使用 Python、异步 I/O、JSON-RPC、构建后端或标准库文件与进程接口。
# 产品维度：保障 Agent 的Python SDK 与捆绑运行时能力可安装、可调用且可诊断。
# 逻辑维度：解析参数或数据，执行核心调用或校验，再返回结果并处理资源清理。
# 关键边界：外部进程与文件不可信；版本和平台条件必须显式；敏感环境变量不得泄露。
# 新手阅读建议：先看导入和公开类型，再读主流程，最后关注异常、平台差异和清理。

from __future__ import annotations

from pathlib import Path

import deepseek_harness_runtime as runtime
import pytest

from deepseek_harness_runtime import (
    RUNTIME_MODE_ENV_VAR,
    bundled_default_config_path,
    bundled_package_dir,
    resolve_bundled_launch_args,
)


# 中文说明：函数 test_default_config_is_shipped_with_the_package 承担本测试的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def test_default_config_is_shipped_with_the_package() -> None:
    # 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    path = bundled_default_config_path()
    assert path == bundled_package_dir() / "runtime" / "cordis.yml"
    # 中文说明：变量 config 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    config = path.read_text()
    assert "@deepseek-ai/dsh-agent-spine-demo" in config
    assert "@deepseek-ai/dsh-session-persistence-jsonl" in config
    assert "@deepseek-ai/dsh-session-checkpoint-policy" in config


# 中文说明：函数 test_unknown_explicit_mode_fails_loud 承担本测试的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def test_unknown_explicit_mode_fails_loud() -> None:
    with pytest.raises(ValueError, match="expected 'exe' or 'node'"):
        resolve_bundled_launch_args("bogus")


# 中文说明：函数 test_unknown_env_mode_fails_loud 承担本测试的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def test_unknown_env_mode_fails_loud(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(RUNTIME_MODE_ENV_VAR, "bogus")
    with pytest.raises(ValueError, match="expected 'exe' or 'node'"):
        resolve_bundled_launch_args()


# 中文说明：函数 test_explicit_mode_wins_over_env_mode 承担本测试的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def test_explicit_mode_wins_over_env_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(RUNTIME_MODE_ENV_VAR, "bogus")
    try:
        # 中文说明：变量 args 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        args = resolve_bundled_launch_args("exe")
    except FileNotFoundError:
        return  # explicit 'exe' was honored; only the artifact is missing
    assert args[0].endswith(("-x64", "-arm64"))


# 中文说明：函数 test_runtime_requires_spawn_helper_only_on_macos 承担本测试的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def test_runtime_requires_spawn_helper_only_on_macos(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # 中文说明：变量 runtime_dir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    runtime_dir = tmp_path / "runtime"
    runtime_dir.mkdir()
    # 中文说明：变量 linux 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    linux = runtime_dir / "dsh-jsonrpc-agent-pkg-linux-x64"
    linux.touch()
    Path(f"{linux}-rg").touch()
    # 中文说明：变量 macos 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    macos = runtime_dir / "dsh-jsonrpc-agent-pkg-macos-arm64"
    macos.touch()
    Path(f"{macos}-rg").touch()
    monkeypatch.setattr(runtime, "bundled_package_dir", lambda: tmp_path)

    monkeypatch.setattr(runtime, "_current_platform_tag", lambda: "macos-arm64")
    with pytest.raises(FileNotFoundError, match="node-pty spawn helper"):
        runtime.bundled_runtime_path()
    monkeypatch.setattr(runtime, "_current_platform_tag", lambda: "linux-x64")
    assert runtime.bundled_runtime_path() == linux


# 中文说明：函数 test_runtime_requires_ripgrep_sidecar 承担本测试的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def test_runtime_requires_ripgrep_sidecar(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # 中文说明：变量 runtime_dir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    runtime_dir = tmp_path / "runtime"
    runtime_dir.mkdir()
    (runtime_dir / "dsh-jsonrpc-agent-pkg-linux-x64").touch()
    monkeypatch.setattr(runtime, "bundled_package_dir", lambda: tmp_path)
    monkeypatch.setattr(runtime, "_current_platform_tag", lambda: "linux-x64")

    with pytest.raises(FileNotFoundError, match="ripgrep sidecar"):
        runtime.bundled_runtime_path()
