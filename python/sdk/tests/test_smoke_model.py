from __future__ import annotations

"""
中文说明：
- 文件职责：验证 Python 运行时冒烟模型能识别子代理提示顺序并模拟 MCP 工具调用与结果。
- 技术维度：使用 pytest 参数化、runpy 动态加载脚本、字典式请求和流式 completion chunk。
- 产品维度：保障 Python SDK 快照流程可稳定驱动直接子代理、工作流子代理及外部 MCP 工具。
- 逻辑维度：加载冒烟脚本，分别构造子代理消息、工具发现请求和工具结果，再扫描增量输出。
- 关键边界：这是确定性模型替身而非真实 API；测试依赖 smoke-python-runtime.py 导出的全局名称。
- 新手阅读建议：先看 ROOT/SMOKE 如何加载脚本，再跟踪三个测试传入 messages/tools 后期望的 chunk。
"""

import runpy
from pathlib import Path

import pytest


# 仓库根目录，由当前测试文件向上三级取得。
ROOT = Path(__file__).resolve().parents[3]
# 冒烟运行时脚本执行后导出的全局名称字典。
SMOKE = runpy.run_path(ROOT / "scripts" / "smoke-python-runtime.py")


@pytest.mark.parametrize(
    ("prompt_name", "expected"),
    [
        ("SNAPSHOT_DIRECT_CHILD_PROMPT", "DIRECT_CHILD_OK"),
        ("SNAPSHOT_WORKFLOW_CHILD_PROMPT", "WORKFLOW_CHILD_OK"),
    ],
)
def test_child_prompt_precedes_runtime_context(prompt_name: str, expected: str) -> None:
    """验证子代理提示优先于后续运行时上下文；参数为提示常量名和预期回复，无返回值。"""
    # 模拟模型根据两条用户消息生成的流式响应块。
    chunks = SMOKE["completion_chunks"]({
        "messages": [
            {"role": "user", "content": SMOKE[prompt_name]},
            {"role": "user", "content": "Current runtime context"},
        ],
    })

    assert any(
        choice.get("delta", {}).get("content") == expected
        for chunk in chunks
        for choice in chunk.get("choices", [])
    )


def test_mcp_smoke_requests_the_discovered_tool() -> None:
    """验证发现 MCP 工具后模型请求固定加法调用；无参数和返回值。"""
    # 带单个 MCP 函数定义的模拟响应块。
    chunks = SMOKE["completion_chunks"]({
        "messages": [{"role": "user", "content": SMOKE["MCP_PROMPT"]}],
        "tools": [{"type": "function", "function": {"name": "mcp__fixture__add"}}],
    })

    # 从所有增量选择中扁平收集工具调用。
    calls = [
        call
        for chunk in chunks
        for choice in chunk.get("choices", [])
        for call in choice.get("delta", {}).get("tool_calls", [])
    ]
    assert calls[0]["function"] == {
        "name": "mcp__fixture__add",
        "arguments": '{"a": 19, "b": 23}',
    }


def test_mcp_smoke_accepts_the_external_server_result() -> None:
    """验证外部 MCP 工具返回 42 后模型生成预期文本；无参数和返回值。"""
    # 包含用户请求、助手工具调用和工具结果的模拟响应块。
    chunks = SMOKE["completion_chunks"]({
        "messages": [
            {"role": "user", "content": SMOKE["MCP_PROMPT"]},
            {
                "role": "assistant",
                "tool_calls": [{
                    "id": "mcp-add",
                    "type": "function",
                    "function": {"name": "mcp__fixture__add", "arguments": '{}'},
                }],
            },
            {"role": "tool", "tool_call_id": "mcp-add", "content": "42"},
        ],
    })

    assert any(
        choice.get("delta", {}).get("content") == SMOKE["MCP_TEXT"]
        for chunk in chunks
        for choice in chunk.get("choices", [])
    )
