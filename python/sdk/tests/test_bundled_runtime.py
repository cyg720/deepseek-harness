"""Keyless boot tests for the production exe and development node carrier.

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

from pathlib import Path

import pytest

from deepseek_harness import DeepSeekHarness, HarnessClient, HarnessConfig
from deepseek_harness.errors import TransportClosedError
from deepseek_harness_runtime import resolve_bundled_launch_args

# 中文说明：变量 _MODES 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
_MODES = ("exe", "node")
# 中文说明：变量 _REPO_ROOT 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
_REPO_ROOT = Path(__file__).parents[3]
# 中文说明：变量 _MINIMAL_CONFIG 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
_MINIMAL_CONFIG = _REPO_ROOT / "examples" / "jsonrpc-agent" / "minimal.cordis.yml"

# The config must include the JSON-RPC serving plugin.
# 中文说明：变量 _CORDIS_YML 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
_CORDIS_YML = """\
- id: sdk-jsonrpc-server
  name: '@deepseek-ai/dsh-sdk-jsonrpc-server'
- id: agent-core
  name: '@deepseek-ai/dsh-agent-spine-demo'
  config:
    workspaceContext: false
- id: sessions
  name: '@deepseek-ai/dsh-session-persistence-jsonl'
  config:
    root: './sessions'
- id: session-checkpoints
  name: '@deepseek-ai/dsh-session-checkpoint-policy'
- id: subprocess
  name: '@deepseek-ai/dsh-subprocess-local'
- id: bash
  name: '@deepseek-ai/dsh-bash-local'
  config:
    cwd: '.'
- id: todo
  name: '@deepseek-ai/dsh-tool-todo'
  config:
    allowParallelInProgress: true
"""


# 中文说明：函数 _launch_args 承担本测试的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def _launch_args(mode: str) -> tuple[str, ...]:
    try:
        return resolve_bundled_launch_args(mode)
    except FileNotFoundError as exc:
        pytest.skip(f"bundled {mode}-mode runtime unavailable on this machine: {exc}")


# 中文说明：函数 _client 承担本测试的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def _client(tmp_path: Path, launch_args: tuple[str, ...]) -> HarnessClient:
    return HarnessClient(
        HarnessConfig(
            # 中文说明：变量 launch_args_override 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            launch_args_override=launch_args,
            # 中文说明：变量 cwd 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            cwd=str(tmp_path),
            # 中文说明：变量 env 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            env={
                "DSH_CORDIS_CONFIG": "./cordis.yml",
                "DSH_SESSION_ROOT": str(tmp_path / "sessions"),
                "DSH_CWD": str(tmp_path),
                # The lazily mounted adapter requires a key even without a model call.
                "DEEPSEEK_API_KEY": "sk-dummy-for-boot",
                "DEEPSEEK_BASE_URL": "http://127.0.0.1:9",
            },
            # 中文说明：变量 request_timeout_seconds 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            request_timeout_seconds=120,
        )
    )


@pytest.mark.parametrize("mode", _MODES)
# 中文说明：函数 test_bundled_runtime_boots_a_cordis_config 承担本测试的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def test_bundled_runtime_boots_a_cordis_config(tmp_path: Path, mode: str) -> None:
    # 中文说明：变量 launch_args 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    launch_args = _launch_args(mode)
    (tmp_path / "cordis.yml").write_text(_CORDIS_YML)

    with _client(tmp_path, launch_args) as client:
        # 中文说明：变量 init 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        init = client.initialize(provider="deepseek-official", cwd=str(tmp_path), model="deepseek-v4-pro")

    assert init.serverInfo is not None
    assert init.serverInfo.name == "deepseek-harness-sdk-runtime"


@pytest.mark.parametrize("mode", _MODES)
# 中文说明：函数 test_python_sdk_boots_minimal_jsonrpc_config 承担本测试的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def test_python_sdk_boots_minimal_jsonrpc_config(tmp_path: Path, mode: str) -> None:
    # 中文说明：变量 launch_args 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    launch_args = _launch_args(mode)
    # 中文说明：变量 model 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    model = "minimal-environment-model"
    # 中文说明：变量 harness 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    harness = DeepSeekHarness(
        # 中文说明：变量 model 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        model=model,
        # 中文说明：变量 cwd 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        cwd=str(tmp_path),
        # 中文说明：变量 session_root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        session_root=str(tmp_path / "sessions"),
        # 中文说明：变量 cordis 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        cordis=str(_MINIMAL_CONFIG),
        # 中文说明：变量 env 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        env={
            "DSH_MODEL": model,
            "DSH_CONTEXT_WINDOW": "1000000",
            "DSH_SYSTEM_PROMPT": "You are the Python SDK minimal boot test agent.",
        },
        # 中文说明：变量 api_key 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        api_key="sk-dummy-for-boot",
        # 中文说明：变量 base_url 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        base_url="http://127.0.0.1:9",
        # 中文说明：变量 launch_args_override 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        launch_args_override=launch_args,
        # 中文说明：变量 request_timeout_seconds 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        request_timeout_seconds=120,
    )

    with harness:
        pass


@pytest.mark.parametrize("mode", _MODES)
# 中文说明：函数 test_bundled_runtime_surfaces_unbundled_plugin_failure 承担本测试的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def test_bundled_runtime_surfaces_unbundled_plugin_failure(tmp_path: Path, mode: str) -> None:
    # 中文说明：变量 launch_args 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    launch_args = _launch_args(mode)
    (tmp_path / "cordis.yml").write_text(
        "- id: missing\n  name: '@deepseek-ai/dsh-does-not-exist'\n"
    )

    # 中文说明：变量 client 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    client = _client(tmp_path, launch_args)
    client.start()
    try:
        with pytest.raises((TransportClosedError, TimeoutError)) as excinfo:
            client.initialize(provider="deepseek-official", cwd=str(tmp_path), model="deepseek-v4-pro")
    finally:
        client.close()

    assert "@deepseek-ai/dsh-does-not-exist" in str(excinfo.value)


@pytest.mark.parametrize("mode", _MODES)
@pytest.mark.parametrize("ambient_config", [None, ""], ids=["unset", "empty-counts-as-absent"])
# 中文说明：函数 test_zero_config_run_injects_bundled_default_cordis_config 承担本测试的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def test_zero_config_run_injects_bundled_default_cordis_config(
    tmp_path: Path, mode: str, ambient_config: str | None, monkeypatch: pytest.MonkeyPatch
) -> None:
    _launch_args(mode)  # skip early when this carrier is unavailable
    monkeypatch.setenv("DSH_RUNTIME_MODE", mode)
    if ambient_config is None:
        monkeypatch.delenv("DSH_CORDIS_CONFIG", raising=False)
    else:
        monkeypatch.setenv("DSH_CORDIS_CONFIG", ambient_config)

    # 中文说明：变量 harness 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    harness = DeepSeekHarness(
        # 中文说明：变量 model 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        model="deepseek-v4-pro",
        # 中文说明：变量 cwd 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        cwd=str(tmp_path),
        # 中文说明：变量 session_root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        session_root=str(tmp_path / "sessions"),
        # 中文说明：变量 api_key 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        api_key="sk-dummy-for-boot",
        # 中文说明：变量 base_url 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        base_url="http://127.0.0.1:9",
        # 中文说明：变量 request_timeout_seconds 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        request_timeout_seconds=120,
    )
    with harness:
        pass
