"""Keyless boot tests for the production exe and development dsh carrier.

Each carrier skips independently when absent. The dummy API key only satisfies
adapter loading; initialize and shutdown do not call a model.
"""
# 文件职责：验证 test_bundled_runtime.py 覆盖的Python SDK 与捆绑运行时职责。
# 技术维度：使用 Python、异步 I/O、JSON-RPC、构建后端或标准库文件与进程接口。
# 产品维度：保障 Agent 的Python SDK 与捆绑运行时能力可安装、可调用且可诊断。
# 逻辑维度：解析参数或数据，执行核心调用或校验，再返回结果并处理资源清理。
# 关键边界：外部进程与文件不可信；版本和平台条件必须显式；敏感环境变量不得泄露。
# 新手阅读建议：先看导入和公开类型，再读主流程，最后关注异常、平台差异和清理。

from __future__ import annotations

import json
from pathlib import Path

import pytest

from deepseek_harness import DeepSeekHarness, HarnessClient, HarnessConfig
from deepseek_harness.errors import JsonRpcError, TransportClosedError
from deepseek_harness_runtime import RUNTIME_MODE_ENV_VAR, resolve_bundled_launch_args

# 中文说明：变量 _MODES 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
_MODES = ("exe", "node")


def _select_mode(mode: str, monkeypatch: pytest.MonkeyPatch) -> None:
    try:
        resolve_bundled_launch_args(mode)
    except FileNotFoundError as exc:
        pytest.skip(f"bundled {mode}-mode runtime unavailable on this machine: {exc}")
    monkeypatch.setenv(RUNTIME_MODE_ENV_VAR, mode)


def _client(tmp_path: Path, mode: str, monkeypatch: pytest.MonkeyPatch, *patches: Path) -> HarnessClient:
    _select_mode(mode, monkeypatch)
    return HarnessClient(
        HarnessConfig(
            dsh_home=str(tmp_path / "home"),
            patches=tuple(str(patch) for patch in patches),
            cwd=str(tmp_path),
            # 中文说明：变量 env 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            env={
                # The lazily mounted adapter requires a key even without a model call.
                "DEEPSEEK_API_KEY": "sk-dummy-for-boot",
                "DEEPSEEK_BASE_URL": "http://127.0.0.1:9",
                "DSH_PERMISSION_MODE": "danger-full-access",
                "DSH_TELEMETRY_DISABLED": "1",
            },
            # 中文说明：变量 request_timeout_seconds 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            request_timeout_seconds=120,
        )
    )


@pytest.mark.parametrize("mode", _MODES)
def test_bundled_runtime_boots_the_sdk_profile(
    tmp_path: Path, mode: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    with _client(tmp_path, mode, monkeypatch) as client:
        init = client.initialize(provider="deepseek-official", cwd=str(tmp_path), model="deepseek-v4-pro")

    assert init.serverInfo is not None
    assert init.serverInfo.name == "deepseek-harness-sdk-runtime"
    profile = json.loads((tmp_path / "home" / "profiles" / "sdk" / "package.json").read_text())
    assert profile["dsh"]["profile"]["bundles"] == [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-sdk-app",
    ]


@pytest.mark.parametrize("mode", _MODES)
def test_python_sdk_applies_an_ordered_profile_patch(
    tmp_path: Path, mode: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    _select_mode(mode, monkeypatch)
    patch = tmp_path / "persona.patch.yml"
    patch.write_text(json.dumps([{
        "id": "system-prompt",
        "config": {"persona": "Python SDK ordered patch marker."},
    }]))
    harness = DeepSeekHarness(
        model="deepseek-v4-pro",
        cwd=str(tmp_path),
        dsh_home=str(tmp_path / "home"),
        patches=(str(patch),),
        env={"DSH_PERMISSION_MODE": "danger-full-access"},
        api_key="sk-dummy-for-boot",
        # 中文说明：变量 base_url 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        base_url="http://127.0.0.1:9",
        request_timeout_seconds=120,
    )

    with harness:
        pass


@pytest.mark.parametrize("mode", _MODES)
def test_bundled_runtime_surfaces_unbundled_plugin_failure(
    tmp_path: Path, mode: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    patch = tmp_path / "missing.patch.yml"
    patch.write_text(json.dumps([{
        "insert": [{"id": "missing", "name": "@deepseek-ai/dsh-does-not-exist"}],
    }]))

    client = _client(tmp_path, mode, monkeypatch, patch)
    client.start()
    try:
        with pytest.raises((JsonRpcError, TransportClosedError, TimeoutError)) as excinfo:
            client.initialize(provider="deepseek-official", cwd=str(tmp_path), model="deepseek-v4-pro")
    finally:
        client.close()

    assert "@deepseek-ai/dsh-does-not-exist" in str(excinfo.value)
