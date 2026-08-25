#!/usr/bin/env python3
"""Keyless full-turn and snapshot smoke for the Python SDK runtime."""

from __future__ import annotations

import argparse
import difflib
import json
import os
import queue
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import TYPE_CHECKING, Callable

if TYPE_CHECKING:
    from deepseek_harness import RunResult


# 中文说明：变量 EXPECTED_TEXT 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
EXPECTED_TEXT = "runtime smoke ok"
# 中文说明：变量 CODE_PROMPT 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
CODE_PROMPT = "Use run_code to compute the packaged worker smoke value."
# 中文说明：变量 CODE_WORKER_TEXT 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
CODE_WORKER_TEXT = "code worker smoke ok"
# 中文说明：变量 WORKFLOW_PROMPT 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
WORKFLOW_PROMPT = "Use workflow to compute the packaged worker smoke value without agents."
# 中文说明：变量 WORKFLOW_WORKER_TEXT 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
WORKFLOW_WORKER_TEXT = "workflow worker smoke ok"
# 中文说明：变量 MINIMAL_PROMPT 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
MINIMAL_PROMPT = "Exercise the packaged minimal agent's persistent Bash and string-replacement editor."
# 中文说明：变量 MINIMAL_TEXT 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
MINIMAL_TEXT = "minimal agent smoke ok"
# 中文说明：变量 MINIMAL_EDITOR_PATH_PREFIX 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
MINIMAL_EDITOR_PATH_PREFIX = "Editor path: "
# 中文说明：变量 FS_SEARCH_PROMPT 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
FS_SEARCH_PROMPT = "Exercise the packaged filesystem search tools."
# 中文说明：变量 FS_SEARCH_TEXT 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
FS_SEARCH_TEXT = "filesystem search smoke ok"
# 中文说明：变量 FS_SEARCH_MARKER 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
FS_SEARCH_MARKER = "PACKAGED_FS_SEARCH_OK"
# 中文说明：变量 MCP_PROMPT 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
MCP_PROMPT = "Exercise the packaged MCP client with one external stdio server."
# 中文说明：变量 MCP_TEXT 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
MCP_TEXT = "MCP client smoke ok"
# 中文说明：变量 MINIMAL_CORDIS 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
MINIMAL_CORDIS = (
    Path(__file__).resolve().parent.parent / "examples" / "jsonrpc-agent" / "minimal.cordis.yml"
)
# 中文说明：变量 MINIMAL_BASH_COMMAND 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
MINIMAL_BASH_COMMAND = (
    "counter=$(( ${counter:-0} + 1 )); export counter; "
    "printf 'COUNT=%s CWD=%s\\n' \"$counter\" \"$PWD\"; "
    "if [ \"$counter\" -eq 1 ]; then cd /tmp; fi"
)
# 中文说明：变量 SNAPSHOT_PROMPT 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
SNAPSHOT_PROMPT = "Run the advanced packaged-runtime snapshot scenario."
# 中文说明：变量 SNAPSHOT_SESSION_ID 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
SNAPSHOT_SESSION_ID = "advanced-executable"
# 中文说明：变量 SNAPSHOT_DIRECT_CHILD_PROMPT 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
SNAPSHOT_DIRECT_CHILD_PROMPT = "Reply with exactly DIRECT_CHILD_OK and nothing else."
# 中文说明：变量 SNAPSHOT_WORKFLOW_CHILD_PROMPT 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
SNAPSHOT_WORKFLOW_CHILD_PROMPT = "Reply with exactly WORKFLOW_CHILD_OK and nothing else."
# 中文说明：变量 SNAPSHOT_FINAL_TEXT 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
SNAPSHOT_FINAL_TEXT = "ADVANCED_EXECUTABLE_OK"
# 中文说明：变量 SNAPSHOT_PLUGIN_CODE 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
SNAPSHOT_PLUGIN_CODE = """\
# 文件职责：实现 smoke-python-runtime.py 覆盖的 Python Runtime 冒烟校验职责。
# 技术维度：使用 Python、子进程、JSON-RPC 与标准输入输出通信。
# 产品维度：保障发布前 Python SDK 能启动捆绑运行时并完成最小协议往返。
# 逻辑维度：定位运行时，启动进程，发送测试请求，再核对响应和退出状态。
# 关键边界：运行时产物可能缺失；进程输出不可信；超时或协议错误必须显式失败。
# 新手阅读建议：先看启动参数，再读请求与响应处理，最后关注超时、退出和清理。
return (ctx) => {
  harness.registerTool(ctx, harness.defineTool({
    name: 'snapshot_double',
    description: 'Double a number for executable snapshot verification.',
    parameters: { value: { type: 'number', required: true } },
    output: {
      schema: { type: 'number' },
      render(_args, value) {
        return [{ type: 'text', text: String(value) }]
      }
    },
    async execute(args) {
      return args.value * 2
    }
  }))
}
"""
# 中文说明：变量 SNAPSHOT_WORKFLOW_SCRIPT 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
SNAPSHOT_WORKFLOW_SCRIPT = (
    "phase('Delegate')\n"
    f"const reply = await agent('{SNAPSHOT_WORKFLOW_CHILD_PROMPT}', {{ label: 'workflow-child' }})\n"
    "return { reply }"
)
# 中文说明：变量 ADVANCED_SNAPSHOT_DIRECTORY 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
ADVANCED_SNAPSHOT_DIRECTORY = (
    Path(__file__).resolve().parent / "snapshots" / "python-sdk-single-exe" / "advanced"
)
# 中文说明：变量 ADVANCED_SNAPSHOT_FILENAMES 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
ADVANCED_SNAPSHOT_FILENAMES = ("result.json", "session.jsonl", "session.1.jsonl", "session.2.jsonl")
# 中文说明：变量 MINIMAL_SNAPSHOT_DIRECTORY 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
MINIMAL_SNAPSHOT_DIRECTORY = (
    Path(__file__).resolve().parent / "snapshots" / "python-sdk-single-exe" / "minimal"
)
# 中文说明：变量 MINIMAL_SNAPSHOT_FILENAMES 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
MINIMAL_SNAPSHOT_FILENAMES = ("model-visible.json",)
# The agent loop's dynamic runtime-context snapshot is the one model-visible message this
# expected output cannot carry: the same composition emits it on macOS and not on Linux
# (deepseek-harness#2488), and the file must replay on both. Everything else is compared.
# 中文说明：变量 RUNTIME_CONTEXT_PREFIX 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
RUNTIME_CONTEXT_PREFIX = "Current runtime context"
# 中文说明：变量 CUSTOM_CORDIS 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
CUSTOM_CORDIS = """\
- id: sdk-jsonrpc-server
  name: '@deepseek-ai/dsh-sdk-jsonrpc-server'
- id: agent-core
  name: '@deepseek-ai/dsh-agent-spine-demo'
  config:
    workspaceContext: false
    skills:
      enabled: false
    toolBash: false
    tools:
      mode: both
- id: sessions
  name: '@deepseek-ai/dsh-session-persistence-jsonl'
  config:
    root: !!js process.env.DSH_SESSION_ROOT
    compression: 'none'
- id: code-runtime
  name: '@deepseek-ai/dsh-code-runtime-worker-thread'
- id: subagents
  name: '@deepseek-ai/dsh-subagent'
- id: subagent-spawn-in-process
  name: '@deepseek-ai/dsh-subagent-spawn-in-process'
  config:
    providerName: spawn
- id: subagent-tool
  name: '@deepseek-ai/dsh-tool-subagent'
  config:
    provider: spawn
- id: workflow-engine
  name: '@deepseek-ai/dsh-workflow-worker-thread'
  config:
    provider: spawn
- id: workflow-tool
  name: '@deepseek-ai/dsh-tool-workflow'
- id: cordis-host-runner
  name: '@deepseek-ai/dsh-cordis-host-runner'
- id: cordis-tool
  name: '@deepseek-ai/dsh-tool-cordis'
"""
# 中文说明：变量 FS_SEARCH_CORDIS 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
FS_SEARCH_CORDIS = """\
- id: sdk-jsonrpc-server
  name: '@deepseek-ai/dsh-sdk-jsonrpc-server'
- id: agent-core
  name: '@deepseek-ai/dsh-agent-spine-demo'
  config:
    workspaceContext: false
    skills:
      enabled: false
    toolBash: false
    toolJobs: false
- id: sessions
  name: '@deepseek-ai/dsh-session-persistence-jsonl'
  config:
    root: !!js process.env.DSH_SESSION_ROOT
    compression: 'none'
- id: subprocess
  name: '@deepseek-ai/dsh-subprocess-local'
- id: fs-search
  name: '@deepseek-ai/dsh-tool-fs-search'
  config:
    sampleOverCapGlobResults: false
"""
# 中文说明：变量 MCP_SERVER_SCRIPT 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
MCP_SERVER_SCRIPT = """\
import json
import os
import sys
import time


log_path = os.environ.get("MCP_SMOKE_LOG")


def send(message):
    sys.stdout.write(json.dumps(message, separators=(",", ":")) + "\\n")
    sys.stdout.flush()


for line in sys.stdin:
    request = json.loads(line)
    if log_path is not None:
        with open(log_path, "a", encoding="utf-8") as log:
            log.write(str(request.get("method")) + "\\n")
    request_id = request.get("id")
    if request_id is None:
        continue
    method = request.get("method")
    if method == "initialize":
        send({
            "jsonrpc": "2.0",
            "id": request_id,
            "result": {
                "protocolVersion": request["params"]["protocolVersion"],
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {"name": "python-wheel-fixture", "version": "1.0.0"},
            },
        })
    elif method == "tools/list":
        # Keep discovery pending longer than the old smoke's 100 ms grace
        # period. An SDK runtime that answers initialize too early will make
        # its first model request without this tool and fail deterministically.
        time.sleep(0.25)
        send({
            "jsonrpc": "2.0",
            "id": request_id,
            "result": {
                "tools": [{
                    "name": "add",
                    "description": "Add two numbers.",
                    "inputSchema": {
                        "type": "object",
                        "properties": {"a": {"type": "number"}, "b": {"type": "number"}},
                        "required": ["a", "b"],
                        "additionalProperties": False,
                    },
                }],
            },
        })
    elif method == "tools/call":
        params = request["params"]
        if params.get("name") != "add" or params.get("arguments") != {"a": 19, "b": 23}:
            send({
                "jsonrpc": "2.0",
                "id": request_id,
                "error": {"code": -32602, "message": "unexpected tool call"},
            })
            continue
        send({
            "jsonrpc": "2.0",
            "id": request_id,
            "result": {"content": [{"type": "text", "text": "42"}]},
        })
    else:
        send({
            "jsonrpc": "2.0",
            "id": request_id,
            "error": {"code": -32601, "message": f"unsupported method: {method}"},
        })
"""


# 中文说明：函数 mcp_cordis 承担本脚本的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def mcp_cordis(server_script: Path) -> str:
    """Build an external config that mounts the packaged MCP client."""
    return json.dumps([
        {
            "id": "sdk-jsonrpc-server",
            "name": "@deepseek-ai/dsh-sdk-jsonrpc-server",
        },
        {
            "id": "agent-core",
            "name": "@deepseek-ai/dsh-agent-spine-demo",
            "config": {
                "workspaceContext": False,
                "skills": {"enabled": False},
                "toolBash": False,
            },
        },
        {
            "id": "sessions",
            "name": "@deepseek-ai/dsh-session-persistence-jsonl",
            "config": {"root": "./sessions", "compression": "none"},
        },
        {
            "id": "mcp-fixture",
            "name": "@deepseek-ai/dsh-mcp-client",
            "config": {
                "serverName": "fixture",
                "transport": "stdio",
                "command": sys.executable,
                "args": [str(server_script)],
                "env": {"MCP_SMOKE_LOG": str(server_script.with_suffix(".log"))},
                "failOnStartupError": True,
                "reconnect": {"enabled": False},
            },
        },
    ], indent=2)


class MockModelHandler(BaseHTTPRequestHandler):
    """Return deterministic text, worker, and orchestration completions."""

    # 中文说明：变量 requests 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    requests: list[dict[str, object]] = []

    # 中文说明：函数 do_POST 承担本脚本的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
    def do_POST(self) -> None:
        # 中文说明：变量 content_length 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        content_length = int(self.headers.get("content-length", "0"))
        # 中文说明：变量 body 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        body = json.loads(self.rfile.read(content_length))
        self.requests.append(body)
        self.send_response(200)
        self.send_header("content-type", "text/event-stream")
        self.end_headers()
        # 中文说明：变量 chunks 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        chunks = completion_chunks(body)
        # 中文说明：该循环依次处理协议数据；循环变量仅在当前循环中有效。
        for chunk in chunks:
            self.wfile.write(f"data: {json.dumps(chunk)}\n\n".encode())
        self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()

    # 中文说明：函数 log_message 承担本脚本的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
    def log_message(self, _format: str, *_args: object) -> None:
        return


# 中文说明：函数 completion_chunks 承担本脚本的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def completion_chunks(body: dict[str, object]) -> list[dict[str, object]]:
    """Choose the next deterministic model response from request history."""
    # 中文说明：变量 messages 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    messages = body.get("messages")
    if not isinstance(messages, list) or not messages:
        raise AssertionError(f"model request has no messages: {body}")
    # 中文说明：变量 latest 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    latest = messages[-1]
    if not isinstance(latest, dict):
        raise AssertionError(f"model request has an invalid latest message: {body}")

    if latest.get("role") == "tool":
        call_id, tool_name = latest_tool_call(messages)
        # 中文说明：变量 tool_text 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        tool_text = message_text(latest.get("content"))
        # 中文说明：变量 mcp 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        mcp = mcp_tool_followup(call_id, tool_name, tool_text)
        if mcp is not None:
            return mcp
        # 中文说明：变量 fs_search 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        fs_search = fs_search_tool_followup(call_id, tool_name, tool_text)
        if fs_search is not None:
            return fs_search
        # 中文说明：变量 minimal 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        minimal = minimal_tool_followup(body, call_id, tool_name, tool_text)
        if minimal is not None:
            return minimal
        # 中文说明：变量 advanced 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        advanced = advanced_tool_followup(body, call_id, tool_name, tool_text)
        if advanced is not None:
            return advanced
        if "42" not in tool_text:
            raise AssertionError(f"{tool_name} worker returned no expected value: {latest}")
        if tool_name == "run_code":
            return text_chunks(CODE_WORKER_TEXT)
        if tool_name == "workflow":
            return text_chunks(WORKFLOW_WORKER_TEXT)
        raise AssertionError(f"unexpected tool follow-up: {tool_name}")

    # 中文说明：变量 user_prompts 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    user_prompts = [
        message_text(message.get("content"))
        # 中文说明：该循环依次处理协议数据；循环变量仅在当前循环中有效。
        for message in reversed(messages)
        if isinstance(message, dict) and message.get("role") == "user"
    ]
    # 中文说明：变量 minimal_prompt 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    minimal_prompt = next(
        (
            prompt
            # 中文说明：该循环依次处理协议数据；循环变量仅在当前循环中有效。
            for prompt in user_prompts
            if prompt.startswith(f"{MINIMAL_PROMPT}\n{MINIMAL_EDITOR_PATH_PREFIX}")
        ),
        None,
    )
    # The minimal composition's assembled system prompt, advertised tool schemas, and
    # model-visible messages are pinned by its snapshot, not asserted here.
    if minimal_prompt is not None:
        return tool_call_chunks(
            "minimal-bash-1",
            "bash",
            {"command": MINIMAL_BASH_COMMAND},
        )
    # 中文说明：变量 scenario_prompts 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    scenario_prompts = {
        SNAPSHOT_DIRECT_CHILD_PROMPT,
        SNAPSHOT_WORKFLOW_CHILD_PROMPT,
        SNAPSHOT_PROMPT,
        CODE_PROMPT,
        WORKFLOW_PROMPT,
        FS_SEARCH_PROMPT,
        MCP_PROMPT,
    }
    # 中文说明：变量 prompt 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    prompt = next(
        (candidate for candidate in user_prompts if candidate in scenario_prompts),
        message_text(latest.get("content")),
    )
    if prompt == SNAPSHOT_DIRECT_CHILD_PROMPT:
        return text_chunks("DIRECT_CHILD_OK")
    if prompt == SNAPSHOT_WORKFLOW_CHILD_PROMPT:
        return text_chunks("WORKFLOW_CHILD_OK")
    if prompt == SNAPSHOT_PROMPT:
        assert_advertised_tool(body, "cordis_define")
        return tool_call_chunks(
            "advanced-define",
            "cordis_define",
            {
                "plugin": {"kind": "new", "idPrefix": "snap"},
                "name": "Snapshot Double",
                "purpose": "Expose a deterministic doubling tool for executable snapshot verification.",
                "code": {"host": SNAPSHOT_PLUGIN_CODE},
            },
        )
    if prompt == CODE_PROMPT:
        assert_advertised_tool(body, "run_code")
        return tool_call_chunks(
            "call-code-worker",
            "run_code",
            {"code": "return 6 * 7", "description": "Compute the smoke value"},
        )
    if prompt == WORKFLOW_PROMPT:
        assert_advertised_tool(body, "workflow")
        return tool_call_chunks(
            "call-workflow-worker",
            "workflow",
            {
                "script": "return 6 * 7",
                "meta": {
                    "name": "pkg-worker-smoke",
                    "description": "exercise the packaged workflow worker",
                },
            },
        )
    if prompt == FS_SEARCH_PROMPT:
        assert_advertised_tool(body, "grep")
        assert_advertised_tool(body, "glob")
        return tool_call_chunks(
            "fs-search-grep",
            "grep",
            {"pattern": FS_SEARCH_MARKER, "path": "."},
        )
    if prompt == MCP_PROMPT:
        assert_advertised_tool(body, "mcp__fixture__add")
        return tool_call_chunks(
            "mcp-add",
            "mcp__fixture__add",
            {"a": 19, "b": 23},
        )
    return text_chunks(EXPECTED_TEXT)


# 中文说明：函数 mcp_tool_followup 承担本脚本的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def mcp_tool_followup(
    call_id: str,
    tool_name: str,
    tool_text: str,
) -> list[dict[str, object]] | None:
    """Verify one tool call through the packaged MCP client."""
    if call_id != "mcp-add":
        return None
    if tool_name != "mcp__fixture__add" or "42" not in tool_text:
        raise AssertionError(f"packaged MCP call returned an unexpected result: {tool_name}: {tool_text}")
    return text_chunks(MCP_TEXT)


# 中文说明：函数 fs_search_tool_followup 承担本脚本的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def fs_search_tool_followup(
    call_id: str,
    tool_name: str,
    tool_text: str,
) -> list[dict[str, object]] | None:
    """Exercise both ripgrep-backed tools through the packaged executable."""
    if not call_id.startswith("fs-search-"):
        return None
    if call_id == "fs-search-grep" and tool_name == "grep":
        if "needle.txt" not in tool_text or FS_SEARCH_MARKER not in tool_text:
            raise AssertionError(f"packaged grep returned no marker: {tool_text}")
        return tool_call_chunks(
            "fs-search-glob",
            "glob",
            {"pattern": "**/*.txt"},
        )
    if call_id == "fs-search-glob" and tool_name == "glob":
        if "needle.txt" not in tool_text:
            raise AssertionError(f"packaged glob returned no fixture path: {tool_text}")
        return text_chunks(FS_SEARCH_TEXT)
    raise AssertionError(f"unexpected filesystem-search follow-up: {call_id} {tool_name}: {tool_text}")


# 中文说明：函数 minimal_tool_followup 承担本脚本的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def minimal_tool_followup(
    body: dict[str, object],
    call_id: str,
    tool_name: str,
    tool_text: str,
) -> list[dict[str, object]] | None:
    """Verify the checked-in minimal composition's PTY and editor."""
    if not call_id.startswith("minimal-"):
        return None
    if call_id == "minimal-bash-1" and tool_name == "bash":
        if "COUNT=1" not in tool_text:
            raise AssertionError(f"first persistent bash call lost its output: {tool_text}")
        return tool_call_chunks(
            "minimal-bash-2",
            "bash",
            {"command": MINIMAL_BASH_COMMAND},
        )
    if call_id == "minimal-bash-2" and tool_name == "bash":
        if "COUNT=2 CWD=/tmp" not in tool_text:
            raise AssertionError(f"persistent bash did not retain state: {tool_text}")
        # 中文说明：变量 messages 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        messages = body.get("messages")
        if not isinstance(messages, list):
            raise AssertionError("persistent editor smoke request has no messages")
        # 中文说明：变量 editor_path 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        editor_path = next(
            (
                text.split(MINIMAL_EDITOR_PATH_PREFIX, 1)[1].strip()
                # 中文说明：该循环依次处理协议数据；循环变量仅在当前循环中有效。
                for message in messages
                if isinstance(message, dict) and message.get("role") == "user"
                # 中文说明：该循环依次处理协议数据；循环变量仅在当前循环中有效。
                for text in [message_text(message.get("content"))]
                if MINIMAL_EDITOR_PATH_PREFIX in text
            ),
            None,
        )
        if editor_path is None:
            raise AssertionError("persistent editor smoke prompt has no editor path")
        return tool_call_chunks(
            "minimal-editor",
            "str_replace_editor",
            {
                "command": "create",
                "path": editor_path,
                "file_text": "created by packaged editor\n",
            },
        )
    if call_id == "minimal-editor" and tool_name == "str_replace_editor":
        if "New file created successfully" not in tool_text:
            raise AssertionError(f"packaged editor did not create its file: {tool_text}")
        return text_chunks(MINIMAL_TEXT)
    raise AssertionError(f"unexpected minimal-agent follow-up: {call_id} {tool_name}: {tool_text}")


# 中文说明：函数 advanced_tool_followup 承担本脚本的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def advanced_tool_followup(
    body: dict[str, object],
    call_id: str,
    tool_name: str,
    tool_text: str,
) -> list[dict[str, object]] | None:
    """Advance the executable snapshot's deterministic parent tool chain."""
    if not call_id.startswith("advanced-"):
        return None
    if call_id == "advanced-define" and tool_name == "cordis_define":
        if "Defined snap-1/pkg-1 (Snapshot Double)" not in tool_text:
            raise AssertionError(f"cordis_define returned no dynamic Package ids: {tool_text}")
        if "snapshot_double" in advertised_tool_names(body):
            raise AssertionError("snapshot_double was advertised before cordis_run")
        assert_advertised_tool(body, "cordis_run")
        return tool_call_chunks(
            "advanced-run",
            "cordis_run",
            {"pluginId": "snap-1", "packageId": "pkg-1", "mode": "run"},
        )
    if call_id == "advanced-run" and tool_name == "cordis_run":
        if "snap-1/pkg-1 is running (run-1)" not in tool_text:
            raise AssertionError(f"cordis_run returned no running Package ids: {tool_text}")
        assert_advertised_tool(body, "run_code")
        assert_advertised_tool(body, "snapshot_double")
        return tool_call_chunks(
            "advanced-code",
            "run_code",
            {
                "code": "return await tools.snapshot_double({ value: 21 })",
                "description": "Run the temporary Plugin tool",
            },
        )
    if call_id == "advanced-code" and tool_name == "run_code":
        if "42" not in tool_text:
            raise AssertionError(f"run_code returned no dynamic-tool value: {tool_text}")
        assert_advertised_tool(body, "subagent")
        return tool_call_chunks(
            "advanced-direct-child",
            "subagent",
            {
                "description": "Check direct child",
                "prompt": SNAPSHOT_DIRECT_CHILD_PROMPT,
            },
        )
    if call_id == "advanced-direct-child" and tool_name == "subagent":
        if "DIRECT_CHILD_OK" not in tool_text:
            raise AssertionError(f"subagent returned no expected child value: {tool_text}")
        assert_advertised_tool(body, "workflow")
        return tool_call_chunks(
            "advanced-workflow",
            "workflow",
            {
                "script": SNAPSHOT_WORKFLOW_SCRIPT,
                "meta": {
                    "name": "advanced-exe-snapshot",
                    "description": "exercise one packaged workflow child",
                },
            },
        )
    if call_id == "advanced-workflow" and tool_name == "workflow":
        if "WORKFLOW_CHILD_OK" not in tool_text:
            raise AssertionError(f"workflow returned no expected child value: {tool_text}")
        assert_advertised_tool(body, "cordis_undefine")
        return tool_call_chunks(
            "advanced-undefine",
            "cordis_undefine",
            {"pluginId": "snap-1"},
        )
    if call_id == "advanced-undefine" and tool_name == "cordis_undefine":
        if "Removed dynamic Plugin snap-1 and all of its Packages." not in tool_text:
            raise AssertionError(f"cordis_undefine returned no removal result: {tool_text}")
        if "snapshot_double" in advertised_tool_names(body):
            raise AssertionError("snapshot_double remained advertised after cordis_undefine")
        return text_chunks(SNAPSHOT_FINAL_TEXT)
    raise AssertionError(f"unexpected advanced tool follow-up: {call_id} {tool_name}: {tool_text}")


# 中文说明：函数 text_chunks 承担本脚本的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def text_chunks(text: str) -> list[dict[str, object]]:
    """Build a complete streaming text response."""
    return [
        {"choices": [{"delta": {"role": "assistant", "content": None, "reasoning_content": ""}}]},
        {"choices": [{"delta": {"content": text}}]},
        {
            "choices": [{"delta": {"content": ""}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 3, "completion_tokens": 3},
        },
    ]


# 中文说明：函数 tool_call_chunks 承担本脚本的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def tool_call_chunks(call_id: str, name: str, arguments: dict[str, object]) -> list[dict[str, object]]:
    """Build a complete streaming function-call response."""
    return [
        {"choices": [{"delta": {"role": "assistant", "content": None, "reasoning_content": ""}}]},
        {
            "choices": [{
                "delta": {
                    "tool_calls": [{
                        "index": 0,
                        "id": call_id,
                        "type": "function",
                        "function": {"name": name, "arguments": json.dumps(arguments)},
                    }],
                },
            }],
        },
        {
            "choices": [{"delta": {"content": ""}, "finish_reason": "tool_calls"}],
            "usage": {"prompt_tokens": 3, "completion_tokens": 3},
        },
    ]


# 中文说明：函数 latest_tool_call 承担本脚本的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def latest_tool_call(messages: list[object]) -> tuple[str, str]:
    """Find the assistant call id and name paired with the latest tool result."""
    # 中文说明：该循环依次处理协议数据；循环变量仅在当前循环中有效。
    for message in reversed(messages[:-1]):
        if not isinstance(message, dict):
            continue
        # 中文说明：变量 calls 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        calls = message.get("tool_calls")
        if not isinstance(calls, list):
            continue
        # 中文说明：该循环依次处理协议数据；循环变量仅在当前循环中有效。
        for call in reversed(calls):
            if not isinstance(call, dict):
                continue
            # 中文说明：变量 function 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            function = call.get("function")
            # 中文说明：变量 call_id 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            call_id = call.get("id")
            if (
                isinstance(call_id, str)
                and isinstance(function, dict)
                and isinstance(function.get("name"), str)
            ):
                return call_id, function["name"]
    raise AssertionError(f"tool result has no preceding assistant tool call: {messages}")


# 中文说明：函数 message_text 承担本脚本的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def message_text(content: object) -> str:
    """Read OpenAI text content in either string or block-list form."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            block.get("text", "")
            # 中文说明：该循环依次处理协议数据；循环变量仅在当前循环中有效。
            for block in content
            if isinstance(block, dict) and isinstance(block.get("text"), str)
        )
    return ""


# 中文说明：函数 advertised_tool_names 承担本脚本的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def advertised_tool_names(body: dict[str, object]) -> set[str]:
    """Return the model-facing tool names advertised on one request."""
    # 中文说明：变量 tools 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    tools = body.get("tools")
    if not isinstance(tools, list):
        raise AssertionError(f"model request advertised no tools: {body}")
    # 中文说明：变量 names 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    names: set[str] = set()
    # 中文说明：该循环依次处理协议数据；循环变量仅在当前循环中有效。
    for tool in tools:
        if not isinstance(tool, dict):
            continue
        # 中文说明：变量 function 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        function = tool.get("function")
        if isinstance(function, dict) and isinstance(function.get("name"), str):
            names.add(function["name"])
    return names


# 中文说明：函数 assert_advertised_tool 承担本脚本的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def assert_advertised_tool(body: dict[str, object], expected: str) -> None:
    """Require the packaged deployment to expose the requested tool."""
    # 中文说明：变量 names 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    names = advertised_tool_names(body)
    if expected not in names:
        raise AssertionError(f"model request did not advertise {expected}: {names}")


class MockModel:
    # 中文说明：函数 __enter__ 承担本脚本的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
    def __enter__(self) -> "MockModel":
        MockModelHandler.requests.clear()
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), MockModelHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        host, port = self.server.server_address
        self.url = f"http://{host}:{port}"
        return self

    # 中文说明：函数 __exit__ 承担本脚本的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
    def __exit__(self, _exc_type: object, _exc: object, _tb: object) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)


# 中文说明：函数 main 承担本脚本的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def main() -> None:
    # 中文说明：变量 parser 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--scenario",
        # 中文说明：变量 choices 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        choices=("all", "sdk-default", "sdk-custom", "sdk-minimal", "sdk-fs-search", "sdk-mcp", "sdk-snapshot", "direct"),
        # 中文说明：变量 default 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        default="all",
    )
    parser.add_argument("--exe", type=Path)
    parser.add_argument("--update-snapshots", action="store_true")
    # 中文说明：变量 args 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    args = parser.parse_args()
    if args.scenario in {"all", "sdk-custom", "sdk-minimal", "sdk-fs-search", "sdk-snapshot", "direct"} and args.exe is None:
        parser.error("--exe is required for custom, minimal, snapshot, and direct scenarios")
    if args.update_snapshots and args.scenario not in {"all", "sdk-minimal", "sdk-snapshot"}:
        parser.error("--update-snapshots requires --scenario sdk-minimal, sdk-snapshot, or all")
    if args.exe is not None and not args.exe.is_file():
        parser.error(f"runtime executable does not exist: {args.exe}")

    with MockModel() as model:
        if args.scenario in {"all", "sdk-default"}:
            smoke_sdk_default(model.url)
        if args.scenario in {"all", "sdk-custom"}:
            assert args.exe is not None
            smoke_sdk_custom(model.url, args.exe.resolve())
        if args.scenario in {"all", "sdk-minimal"}:
            assert args.exe is not None
            smoke_sdk_minimal(model.url, args.exe.resolve(), args.update_snapshots)
        if args.scenario in {"all", "sdk-fs-search"}:
            assert args.exe is not None
            smoke_sdk_fs_search(model.url, args.exe.resolve())
        if args.scenario in {"all", "sdk-mcp"}:
            smoke_sdk_mcp(model.url, None if args.exe is None else args.exe.resolve())
        if args.scenario in {"all", "sdk-snapshot"}:
            assert args.exe is not None
            smoke_sdk_snapshot(model.url, args.exe.resolve(), args.update_snapshots)
        if args.scenario in {"all", "direct"}:
            assert args.exe is not None
            smoke_direct(model.url, args.exe.resolve())
        if not MockModelHandler.requests:
            raise AssertionError("mock model endpoint received no requests")
    print(f"smoke-python-runtime: {args.scenario} passed")


# 中文说明：函数 smoke_sdk_default 承担本脚本的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def smoke_sdk_default(base_url: str) -> None:
    from deepseek_harness import DeepSeekHarness

    with tempfile.TemporaryDirectory(prefix="dsh-sdk-default-") as temporary:
        # 中文说明：变量 root 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        root = Path(temporary).resolve()
        # 中文说明：变量 sessions 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        sessions = root / "sessions"
        with DeepSeekHarness(
            # 中文说明：变量 provider 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            provider="deepseek-official",
            # 中文说明：变量 model 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            model="smoke-model",
            # 中文说明：变量 cwd 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            cwd=str(root),
            # 中文说明：变量 session_root 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            session_root=str(sessions),
            # 中文说明：变量 api_key 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            api_key="sk-keyless-smoke",
            # 中文说明：变量 base_url 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            base_url=base_url,
            # 中文说明：变量 request_timeout_seconds 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            request_timeout_seconds=60,
        ) as harness:
            # 中文说明：变量 result 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            result = harness.run("reply with the smoke text", session_id="default-smoke")
        assert result.final_response == EXPECTED_TEXT, result.final_response
        assert_zstd_session_log(sessions)


# 中文说明：函数 smoke_sdk_custom 承担本脚本的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def smoke_sdk_custom(base_url: str, executable: Path) -> None:
    from deepseek_harness import DeepSeekHarness

    with tempfile.TemporaryDirectory(prefix="dsh-sdk-custom-") as temporary:
        # 中文说明：变量 root 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        root = Path(temporary).resolve()
        # 中文说明：变量 sessions 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        sessions = root / "sessions"
        # 中文说明：变量 cordis 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        cordis = root / "cordis.yml"
        cordis.write_text(CUSTOM_CORDIS)
        with DeepSeekHarness(
            # 中文说明：变量 provider 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            provider="deepseek-official",
            # 中文说明：变量 model 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            model="smoke-model",
            # 中文说明：变量 cwd 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            cwd=str(root),
            # 中文说明：变量 session_root 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            session_root=str(sessions),
            # 中文说明：变量 cordis 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            cordis=str(cordis),
            # 中文说明：变量 runtime_bin 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            runtime_bin=str(executable),
            # 中文说明：变量 api_key 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            api_key="sk-keyless-smoke",
            # 中文说明：变量 base_url 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            base_url=base_url,
            # 中文说明：变量 request_timeout_seconds 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            request_timeout_seconds=60,
        ) as harness:
            # 中文说明：变量 text_result 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            text_result = harness.run("reply with the smoke text", session_id="custom-smoke")
            # 中文说明：变量 code_result 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            code_result = harness.run(CODE_PROMPT, session_id="custom-smoke")
            # 中文说明：变量 workflow_result 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            workflow_result = harness.run(WORKFLOW_PROMPT, session_id="custom-smoke")
        assert text_result.final_response == EXPECTED_TEXT, text_result.final_response
        assert code_result.final_response == CODE_WORKER_TEXT, code_result.final_response
        assert workflow_result.final_response == WORKFLOW_WORKER_TEXT, workflow_result.final_response
        assert_session_log(sessions, root, EXPECTED_TEXT, CODE_WORKER_TEXT, WORKFLOW_WORKER_TEXT)


# 中文说明：函数 smoke_sdk_minimal 承担本脚本的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def smoke_sdk_minimal(base_url: str, executable: Path, update_snapshots: bool) -> None:
    """Exercise the checked-in minimal composition through the packaged executable."""
    from deepseek_harness import DeepSeekHarness

    # One mock model serves every scenario of a run, so the snapshot takes this turn's slice.
    # 中文说明：变量 first_request 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    first_request = len(MockModelHandler.requests)
    with tempfile.TemporaryDirectory(prefix="dsh-sdk-minimal-") as temporary:
        # 中文说明：变量 root 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        root = Path(temporary).resolve()
        # 中文说明：变量 editor_path 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        editor_path = root / "created.txt"
        # 中文说明：变量 prompt 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        prompt = f"{MINIMAL_PROMPT}\n{MINIMAL_EDITOR_PATH_PREFIX}{editor_path}"
        # 中文说明：变量 sessions 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        sessions = root / "sessions"
        with DeepSeekHarness(
            # 中文说明：变量 provider 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            provider="deepseek-official",
            # 中文说明：变量 model 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            model="smoke-model",
            # 中文说明：变量 cwd 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            cwd=str(root),
            # 中文说明：变量 session_root 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            session_root=str(sessions),
            # 中文说明：变量 cordis 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            cordis=str(MINIMAL_CORDIS),
            # 中文说明：变量 runtime_bin 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            runtime_bin=str(executable),
            # 中文说明：变量 api_key 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            api_key="sk-keyless-smoke",
            # 中文说明：变量 base_url 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            base_url=base_url,
            # 中文说明：变量 request_timeout_seconds 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            request_timeout_seconds=60,
        ) as harness:
            # 中文说明：变量 result 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            result = harness.run(prompt, session_id="minimal-agent-smoke")

        # 中文说明：变量 event_text 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        event_text = json.dumps(result.events)
        if MINIMAL_TEXT not in event_text:
            raise AssertionError(f"minimal agent run emitted no final response: {result.events}")
        if editor_path.read_text() != "created by packaged editor\n":
            raise AssertionError(f"packaged editor wrote unexpected content: {editor_path.read_text()!r}")
        assert_session_log(sessions, root, MINIMAL_TEXT, "COUNT=1", "COUNT=2 CWD=/tmp")

        # 中文说明：变量 files 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        files = build_minimal_snapshot_files(MockModelHandler.requests[first_request:], root)
        compare_snapshot_files(
            files, update_snapshots, MINIMAL_SNAPSHOT_DIRECTORY, MINIMAL_SNAPSHOT_FILENAMES,
        )


# 中文说明：函数 smoke_sdk_fs_search 承担本脚本的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def smoke_sdk_fs_search(base_url: str, executable: Path) -> None:
    """Exercise real grep and glob spawns through the packaged executable."""
    from deepseek_harness import DeepSeekHarness

    with tempfile.TemporaryDirectory(prefix="dsh-sdk-fs-search-") as temporary:
        # 中文说明：变量 root 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        root = Path(temporary).resolve()
        (root / "needle.txt").write_text(f"{FS_SEARCH_MARKER}\n")
        # 中文说明：变量 sessions 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        sessions = root / "sessions"
        # 中文说明：变量 cordis 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        cordis = root / "cordis.yml"
        cordis.write_text(FS_SEARCH_CORDIS)
        with DeepSeekHarness(
            # 中文说明：变量 provider 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            provider="deepseek-official",
            # 中文说明：变量 model 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            model="smoke-model",
            # 中文说明：变量 cwd 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            cwd=str(root),
            # 中文说明：变量 session_root 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            session_root=str(sessions),
            # 中文说明：变量 cordis 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            cordis=str(cordis),
            # 中文说明：变量 runtime_bin 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            runtime_bin=str(executable),
            # 中文说明：变量 api_key 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            api_key="sk-keyless-smoke",
            # 中文说明：变量 base_url 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            base_url=base_url,
            # 中文说明：变量 request_timeout_seconds 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            request_timeout_seconds=60,
        ) as harness:
            # 中文说明：变量 result 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            result = harness.run(FS_SEARCH_PROMPT, session_id="fs-search-smoke")

        assert result.final_response == FS_SEARCH_TEXT, result.final_response
        assert_session_log(sessions, root, FS_SEARCH_TEXT, FS_SEARCH_MARKER, "needle.txt")


# 中文说明：函数 smoke_sdk_mcp 承担本脚本的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def smoke_sdk_mcp(base_url: str, executable: Path | None) -> None:
    """Discover and call an external stdio MCP tool through the packaged client."""
    from deepseek_harness import DeepSeekHarness

    with tempfile.TemporaryDirectory(prefix="dsh-sdk-mcp-") as temporary:
        # 中文说明：变量 root 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        root = Path(temporary).resolve()
        # 中文说明：变量 sessions 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        sessions = root / "sessions"
        # 中文说明：变量 server_script 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        server_script = root / "mcp_server.py"
        server_script.write_text(MCP_SERVER_SCRIPT)
        # 中文说明：变量 cordis 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        cordis = root / "cordis.yml"
        cordis.write_text(mcp_cordis(server_script))
        # 中文说明：变量 discovery_log 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        discovery_log = server_script.with_suffix(".log")
        with DeepSeekHarness(
            # 中文说明：变量 provider 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            provider="deepseek-official",
            # 中文说明：变量 model 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            model="smoke-model",
            # 中文说明：变量 cwd 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            cwd=str(root),
            # 中文说明：变量 session_root 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            session_root=str(sessions),
            # 中文说明：变量 cordis 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            cordis=str(cordis),
            # 中文说明：变量 runtime_bin 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            runtime_bin=None if executable is None else str(executable),
            # 中文说明：变量 api_key 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            api_key="sk-keyless-smoke",
            # 中文说明：变量 base_url 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            base_url=base_url,
            # 中文说明：变量 request_timeout_seconds 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            request_timeout_seconds=60,
        ) as harness:
            # 中文说明：变量 result 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            result = harness.run(MCP_PROMPT, session_id="mcp-smoke")

        assert result.final_response == MCP_TEXT, result.final_response
        assert discovery_log.read_text().splitlines() == [
            "initialize",
            "notifications/initialized",
            "tools/list",
            "tools/call",
        ]
        assert_session_log(sessions, root, MCP_TEXT, "mcp__fixture__add", "42")


# 中文说明：函数 smoke_sdk_snapshot 承担本脚本的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def smoke_sdk_snapshot(base_url: str, executable: Path, update_snapshots: bool) -> None:
    """Drive and compare the advanced SDK/executable behavioral snapshot."""
    from deepseek_harness import DeepSeekHarness

    with tempfile.TemporaryDirectory(prefix="dsh-sdk-snapshot-") as temporary:
        # 中文说明：变量 root 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        root = Path(temporary).resolve()
        # 中文说明：变量 sessions 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        sessions = root / "sessions"
        # 中文说明：变量 cordis 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        cordis = root / "cordis.yml"
        cordis.write_text(CUSTOM_CORDIS)
        with DeepSeekHarness(
            # 中文说明：变量 provider 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            provider="deepseek-official",
            # 中文说明：变量 model 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            model="smoke-model",
            # 中文说明：变量 cwd 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            cwd=str(root),
            # 中文说明：变量 session_root 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            session_root=str(sessions),
            # 中文说明：变量 cordis 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            cordis=str(cordis),
            # 中文说明：变量 runtime_bin 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            runtime_bin=str(executable),
            # 中文说明：变量 api_key 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            api_key="sk-keyless-smoke",
            # 中文说明：变量 base_url 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            base_url=base_url,
            # 中文说明：变量 request_timeout_seconds 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            request_timeout_seconds=60,
        ) as harness:
            # 中文说明：变量 result 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            result = harness.run(SNAPSHOT_PROMPT, session_id=SNAPSHOT_SESSION_ID)

        assert result.final_response == SNAPSHOT_FINAL_TEXT, result.final_response
        # 中文说明：变量 methods 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        methods = [notification.method for notification in result.notifications]
        if methods.count("subagent.started") != 2 or methods.count("subagent.finished") != 2:
            raise AssertionError(f"advanced snapshot emitted unexpected subagent lifecycle: {methods}")
        if not any(event.get("type") == "tool/code-dispatch" for event in result.events):
            raise AssertionError("advanced snapshot emitted no tool/code-dispatch event")

        # 中文说明：变量 logs 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        logs = read_session_logs(sessions)
        # 中文说明：变量 child_ids 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        child_ids = snapshot_child_ids(result)
        # 中文说明：变量 expected_ids 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        expected_ids = {SNAPSHOT_SESSION_ID, *child_ids}
        if set(logs) != expected_ids:
            raise AssertionError(f"advanced snapshot expected parent plus two child logs: {sorted(logs)}")
        if "DIRECT_CHILD_OK" not in render_jsonl(logs[child_ids[0]]):
            raise AssertionError("first advanced child log has no direct-subagent result")
        if "WORKFLOW_CHILD_OK" not in render_jsonl(logs[child_ids[1]]):
            raise AssertionError("second advanced child log has no workflow-subagent result")

        # 中文说明：变量 files 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        files = build_snapshot_files(result, logs, child_ids, root)
        compare_snapshot_files(
            files, update_snapshots, ADVANCED_SNAPSHOT_DIRECTORY, ADVANCED_SNAPSHOT_FILENAMES,
        )


# 中文说明：函数 smoke_direct 承担本脚本的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def smoke_direct(base_url: str, executable: Path) -> None:
    with tempfile.TemporaryDirectory(prefix="dsh-direct-") as temporary:
        # 中文说明：变量 root 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        root = Path(temporary).resolve()
        # 中文说明：变量 sessions 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        sessions = root / "sessions"
        # 中文说明：变量 cordis 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        cordis = root / "cordis.yml"
        cordis.write_text(CUSTOM_CORDIS)
        # 中文说明：变量 environment 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        environment = {
            **os.environ,
            "DSH_CORDIS_CONFIG": str(cordis),
            "DSH_SESSION_ROOT": str(sessions),
            "DSH_CWD": str(root),
            "DEEPSEEK_API_KEY": "sk-keyless-smoke",
            "DEEPSEEK_BASE_URL": base_url,
        }
        # 中文说明：变量 peer 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        peer = RuntimePeer([str(executable)], root, environment)
        try:
            peer.send({"jsonrpc": "2.0", "id": "initialize", "method": "initialize", "params": {"cwd": str(root), "provider": "deepseek-official", "model": "smoke-model"}})
            peer.read_until(lambda message: message.get("id") == "initialize")
            peer.send({
                "jsonrpc": "2.0",
                "id": "prompt",
                "method": "session/prompt",
                "params": {"sessionId": "direct-smoke", "contentBlocks": [{"type": "text", "text": "reply with the smoke text"}]},
            })
            # 中文说明：变量 messages 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            messages = peer.read_until(lambda message: message.get("id") == "prompt")
            if not any(is_idle_notification(message) for message in messages):
                messages.extend(peer.read_until(is_idle_notification))
            # 中文说明：变量 event_text 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            event_text = json.dumps(messages)
            if EXPECTED_TEXT not in event_text:
                raise AssertionError(f"direct runtime emitted no final response: {messages}")
            peer.send({"jsonrpc": "2.0", "id": "shutdown", "method": "shutdown"})
            peer.read_until(lambda message: message.get("id") == "shutdown")
        finally:
            peer.close()
        assert_session_log(sessions, root, EXPECTED_TEXT)


# 中文说明：函数 is_idle_notification 承担本脚本的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def is_idle_notification(message: dict[str, object]) -> bool:
    """Return whether a JSON-RPC notification marks a session idle."""
    # 中文说明：变量 params 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    params = message.get("params")
    return (
        message.get("method") == "session.status"
        and isinstance(params, dict)
        and params.get("status") == "idle"
    )


class RuntimePeer:
    # 中文说明：函数 __init__ 承担本脚本的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
    def __init__(self, argv: list[str], cwd: Path, environment: dict[str, str]) -> None:
        self.process = subprocess.Popen(
            argv,
            # 中文说明：变量 cwd 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            cwd=cwd,
            # 中文说明：变量 env 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            env=environment,
            # 中文说明：变量 stdin 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            stdin=subprocess.PIPE,
            # 中文说明：变量 stdout 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            stdout=subprocess.PIPE,
            # 中文说明：变量 stderr 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            stderr=subprocess.PIPE,
            # 中文说明：变量 text 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            text=True,
            # 中文说明：变量 encoding 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            encoding="utf-8",
            # 中文说明：变量 bufsize 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            bufsize=1,
        )
        self.stdout: queue.Queue[str | None] = queue.Queue()
        self.stderr: list[str] = []
        threading.Thread(target=self._read_stdout, daemon=True).start()
        threading.Thread(target=self._read_stderr, daemon=True).start()

    # 中文说明：函数 send 承担本脚本的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
    def send(self, message: dict[str, object]) -> None:
        if self.process.stdin is None:
            raise RuntimeError("runtime stdin is unavailable")
        self.process.stdin.write(json.dumps(message) + "\n")
        self.process.stdin.flush()

    # 中文说明：函数 read_until 承担本脚本的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
    def read_until(self, predicate: Callable[[dict[str, object]], bool]) -> list[dict[str, object]]:
        # 中文说明：变量 deadline 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        deadline = time.monotonic() + 60
        # 中文说明：变量 messages 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        messages: list[dict[str, object]] = []
        while time.monotonic() < deadline:
            try:
                # 中文说明：变量 line 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
                line = self.stdout.get(timeout=min(0.25, deadline - time.monotonic()))
            except queue.Empty:
                continue
            if line is None:
                raise RuntimeError(f"runtime exited before expected message; stderr: {''.join(self.stderr)}")
            try:
                # 中文说明：变量 message 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
                message = json.loads(line)
            except json.JSONDecodeError:
                continue
            messages.append(message)
            if predicate(message):
                return messages
        raise TimeoutError(f"runtime timed out; messages={messages}; stderr={''.join(self.stderr)}")

    # 中文说明：函数 close 承担本脚本的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
    def close(self) -> None:
        if self.process.stdin is not None and not self.process.stdin.closed:
            self.process.stdin.close()
        try:
            self.process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait()
        if self.process.returncode not in {0, -15}:
            raise RuntimeError(f"runtime exited {self.process.returncode}; stderr: {''.join(self.stderr)}")

    # 中文说明：函数 _read_stdout 承担本脚本的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
    def _read_stdout(self) -> None:
        assert self.process.stdout is not None
        # 中文说明：该循环依次处理协议数据；循环变量仅在当前循环中有效。
        for line in self.process.stdout:
            self.stdout.put(line)
        self.stdout.put(None)

    # 中文说明：函数 _read_stderr 承担本脚本的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
    def _read_stderr(self) -> None:
        assert self.process.stderr is not None
        self.stderr.extend(self.process.stderr)


# 中文说明：函数 assert_session_log 承担本脚本的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def assert_session_log(sessions: Path, cwd: Path, *expected_texts: str) -> None:
    # 中文说明：变量 logs 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    logs = list(sessions.rglob("*.jsonl"))
    if len(logs) != 1:
        raise AssertionError(f"expected one JSONL session log under {sessions}, found {logs}")
    # 中文说明：变量 lines 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    lines = logs[0].read_text().splitlines()
    # 中文说明：变量 header 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    header = json.loads(lines[0])
    if header.get("cwd") != str(cwd):
        raise AssertionError(f"session header cwd is not absolute/canonical: {header}")
    # 中文说明：变量 rendered 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    rendered = "\n".join(lines)
    # 中文说明：该循环依次处理协议数据；循环变量仅在当前循环中有效。
    for expected in expected_texts:
        if expected not in rendered:
            raise AssertionError(f"session log has no {expected!r} response: {logs[0]}")


# 中文说明：函数 assert_zstd_session_log 承担本脚本的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def assert_zstd_session_log(sessions: Path) -> None:
    # 中文说明：变量 logs 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    logs = list(sessions.rglob("*.jsonl.zstd"))
    if len(logs) != 1:
        raise AssertionError(f"expected one Zstandard JSONL session log under {sessions}, found {logs}")
    if not logs[0].read_bytes().startswith(bytes.fromhex("28b52ffd")):
        raise AssertionError(f"session log has no Zstandard magic: {logs[0]}")


# 中文说明：函数 read_session_logs 承担本脚本的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def read_session_logs(sessions: Path) -> dict[str, list[dict[str, object]]]:
    """Parse every persisted JSONL session into a map keyed by header id."""
    # 中文说明：变量 logs 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    logs: dict[str, list[dict[str, object]]] = {}
    # 中文说明：该循环依次处理协议数据；循环变量仅在当前循环中有效。
    for path in sorted(sessions.rglob("*.jsonl")):
        # 中文说明：变量 records 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        records = [
            json.loads(line)
            # 中文说明：该循环依次处理协议数据；循环变量仅在当前循环中有效。
            for line in path.read_text(encoding="utf-8").splitlines()
            if line
        ]
        if not records or records[0].get("type") != "session":
            raise AssertionError(f"session log has no header: {path}")
        # 中文说明：变量 session_id 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        session_id = records[0].get("id")
        if not isinstance(session_id, str):
            raise AssertionError(f"session log header has no string id: {path}")
        if session_id in logs:
            raise AssertionError(f"duplicate persisted session id: {session_id}")
        logs[session_id] = records
    return logs


# 中文说明：函数 snapshot_child_ids 承担本脚本的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def snapshot_child_ids(result: "RunResult") -> list[str]:
    """Return the two child session ids in their SDK notification order."""
    # 中文说明：变量 child_ids 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    child_ids: list[str] = []
    # 中文说明：该循环依次处理协议数据；循环变量仅在当前循环中有效。
    for notification in result.notifications:
        if notification.method != "subagent.started":
            continue
        # 中文说明：变量 payload 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        payload = notification.payload
        if payload.get("parentSessionId") != SNAPSHOT_SESSION_ID:
            continue
        # 中文说明：变量 child_id 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        child_id = payload.get("childSessionId")
        if isinstance(child_id, str) and child_id not in child_ids:
            child_ids.append(child_id)
    if len(child_ids) != 2:
        raise AssertionError(f"advanced snapshot expected two child session ids: {child_ids}")
    return child_ids


# 中文说明：函数 build_minimal_snapshot_files 承担本脚本的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def build_minimal_snapshot_files(
    requests: list[dict[str, object]],
    cwd: Path,
) -> dict[str, str]:
    """Render the minimal composition's model-visible surface as expected output.

    Every assembled system prompt, advertised tool schema, and system or user message is
    kept verbatim: they carry what the deployment actually shows the model, so a plugin
    that contributes an unintended system section or user message cannot pass unnoticed.
    Assistant and tool payloads keep only their call identity, and the dynamic
    runtime-context snapshot is dropped, because their text differs across the platforms
    this expected output must replay on.
    """
    # 中文说明：变量 snapshot 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    snapshot = []
    # 中文说明：该循环依次处理协议数据；循环变量仅在当前循环中有效。
    for body in requests:
        # 中文说明：变量 messages 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        messages = body.get("messages")
        if not isinstance(messages, list):
            raise AssertionError(f"minimal model request has no messages: {body}")
        snapshot.append({
            "tools": minimal_snapshot_text(body.get("tools"), cwd),
            "messages": [
                minimal_snapshot_message(message, cwd)
                # 中文说明：该循环依次处理协议数据；循环变量仅在当前循环中有效。
                for message in messages
                if not is_runtime_context_message(message)
            ],
        })
    return {"model-visible.json": json.dumps(snapshot, indent=2, ensure_ascii=False) + "\n"}


# 中文说明：函数 is_runtime_context_message 承担本脚本的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def is_runtime_context_message(message: object) -> bool:
    """Identify the agent loop's dynamic runtime-context snapshot, current or cleared."""
    return (
        isinstance(message, dict)
        and message.get("role") == "user"
        and message_text(message.get("content")).startswith(RUNTIME_CONTEXT_PREFIX)
    )


# 中文说明：函数 minimal_snapshot_message 承担本脚本的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def minimal_snapshot_message(message: object, cwd: Path) -> dict[str, object]:
    """Reduce one model-visible message to its stable, behavior-carrying parts."""
    if not isinstance(message, dict):
        raise AssertionError(f"minimal model request has an invalid message: {message}")
    # 中文说明：变量 role 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    role = message.get("role")
    if role in ("system", "user"):
        return {"role": role, "text": minimal_snapshot_text(message_text(message.get("content")), cwd)}
    if role == "assistant":
        # 中文说明：变量 calls 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        calls = message.get("tool_calls")
        if not isinstance(calls, list):
            raise AssertionError(f"minimal assistant message has no tool calls: {message}")
        return {
            "role": role,
            "toolCalls": [
                {"id": call.get("id"), "name": (call.get("function") or {}).get("name")}
                # 中文说明：该循环依次处理协议数据；循环变量仅在当前循环中有效。
                for call in calls
                if isinstance(call, dict)
            ],
        }
    if role == "tool":
        return {"role": role, "toolCallId": message.get("tool_call_id"), "text": "{{tool-result}}"}
    raise AssertionError(f"minimal model request has an unexpected message role: {message}")


# 中文说明：函数 minimal_snapshot_text 承担本脚本的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def minimal_snapshot_text(value: object, cwd: Path) -> object:
    """Replace the scenario's temporary working directory everywhere it appears."""
    if isinstance(value, str):
        return value.replace(str(cwd), "{{cwd}}")
    if isinstance(value, list):
        return [minimal_snapshot_text(item, cwd) for item in value]
    if isinstance(value, dict):
        return {key: minimal_snapshot_text(item, cwd) for key, item in value.items()}
    return value


# 中文说明：函数 build_snapshot_files 承担本脚本的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def build_snapshot_files(
    result: "RunResult",
    logs: dict[str, list[dict[str, object]]],
    child_ids: list[str],
    cwd: Path,
) -> dict[str, str]:
    """Render the SDK result and three persisted logs into stable expected outputs."""
    # 中文说明：变量 replacements 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    replacements = [(str(cwd), "{{cwd}}"), (SNAPSHOT_SESSION_ID, "{{parent}}")]
    replacements.append((snapshot_workflow_run_id(result), "{{workflow-run}}"))
    # 中文说明：该循环依次处理协议数据；循环变量仅在当前循环中有效。
    for index, child_id in enumerate(child_ids, start=1):
        replacements.append((child_id, f"{{{{child-{index}}}}}"))
        # 中文说明：变量 agent_id 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        agent_id = snapshot_agent_id(result, child_id)
        replacements.append((agent_id, f"{{{{agent-{index}}}}}"))
    replacements.sort(key=lambda pair: len(pair[0]), reverse=True)

    # 中文说明：变量 result_value 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    result_value = {
        "session_id": result.session_id,
        "final_response": result.final_response,
        "events": result.events,
        "notifications": [
            {"method": notification.method, "payload": notification.payload}
            # 中文说明：该循环依次处理协议数据；循环变量仅在当前循环中有效。
            for notification in result.notifications
        ],
        "session_root": result.session_root,
    }
    # 中文说明：变量 normalized_result 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    normalized_result = normalize_snapshot_value(result_value, replacements)
    # 中文说明：变量 files 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    files = {
        "result.json": json.dumps(normalized_result, indent=2, ensure_ascii=False) + "\n",
        "session.jsonl": render_jsonl(
            project_session_snapshot([
                normalize_snapshot_value(record, replacements) for record in logs[SNAPSHOT_SESSION_ID]
            ])
        ),
    }
    # 中文说明：该循环依次处理协议数据；循环变量仅在当前循环中有效。
    for index, child_id in enumerate(child_ids, start=1):
        files[f"session.{index}.jsonl"] = render_jsonl(
            project_session_snapshot([
                normalize_snapshot_value(record, replacements) for record in logs[child_id]
            ])
        )
    return files


# 中文说明：函数 snapshot_workflow_run_id 承担本脚本的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def snapshot_workflow_run_id(result: "RunResult") -> str:
    """Return the one workflow run id emitted by the advanced scenario."""
    # 中文说明：变量 run_ids 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    run_ids: set[str] = set()
    # 中文说明：该循环依次处理协议数据；循环变量仅在当前循环中有效。
    for event in result.events:
        # 中文说明：变量 event_type 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        event_type = event.get("type")
        # 中文说明：变量 data 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        data = event.get("data")
        if not isinstance(event_type, str) or not event_type.startswith("tool-workflow/"):
            continue
        if isinstance(data, dict) and isinstance(data.get("runId"), str):
            run_ids.add(data["runId"])
    if len(run_ids) != 1:
        raise AssertionError(f"advanced snapshot expected one workflow run id: {sorted(run_ids)}")
    return next(iter(run_ids))


# 中文说明：函数 snapshot_agent_id 承担本脚本的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def snapshot_agent_id(result: "RunResult", child_id: str) -> str:
    """Find the successful subagent id paired with one child session."""
    # 中文说明：该循环依次处理协议数据；循环变量仅在当前循环中有效。
    for notification in result.notifications:
        if notification.method != "subagent.finished":
            continue
        # 中文说明：变量 payload 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        payload = notification.payload
        if payload.get("childSessionId") != child_id:
            continue
        if payload.get("provider") != "spawn" or payload.get("status") != "ok":
            raise AssertionError(f"advanced child did not finish successfully: {payload}")
        # 中文说明：变量 agent_id 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        agent_id = payload.get("agentId")
        if isinstance(agent_id, str):
            return agent_id
    raise AssertionError(f"advanced snapshot has no finished agent for child {child_id}")


# 中文说明：函数 normalize_snapshot_value 承担本脚本的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def normalize_snapshot_value(
    value: object,
    replacements: list[tuple[str, str]],
) -> object:
    """Scrub volatile values and bulky request headers without losing behavior."""
    if isinstance(value, str):
        # 中文说明：变量 normalized 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        normalized = value
        # 中文说明：该循环依次处理协议数据；循环变量仅在当前循环中有效。
        for actual, token in replacements:
            # 中文说明：变量 normalized 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            normalized = normalized.replace(actual, token)
        return normalized
    if isinstance(value, list):
        return [normalize_snapshot_value(item, replacements) for item in value]
    if not isinstance(value, dict):
        return value

    # 中文说明：变量 normalized 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    normalized = {
        key: normalize_snapshot_value(item, replacements)
        # 中文说明：该循环依次处理协议数据；循环变量仅在当前循环中有效。
        for key, item in value.items()
    }
    if normalized.get("type") == "session" and "createdAt" in normalized:
        normalized["createdAt"] = 0
    if "seq" in normalized and "time" in normalized:
        normalized["time"] = 0
    if isinstance(normalized.get("id"), str) and normalized.get("role") in ("assistant", "user"):
        normalized["id"] = "{{messageId}}"
    scrub_snapshot_header(normalized)
    return normalized


# 中文说明：函数 scrub_snapshot_header 承担本脚本的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def scrub_snapshot_header(value: dict[object, object]) -> None:
    """Tokenize full request-header bulk while retaining tool names."""
    # 中文说明：变量 data 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    data = value.get("data")
    if not isinstance(data, dict):
        return
    if value.get("type") == "request/header":
        # 中文说明：变量 header 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        header = data.get("header")
        if not isinstance(header, dict):
            return
        if "system" in header:
            header["system"] = "{{system}}"
        # 中文说明：变量 tools 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        tools = header.get("tools")
        if isinstance(tools, list):
            header["tools"] = [
                tool.get("name") if isinstance(tool, dict) else "{{tools}}"
                # 中文说明：该循环依次处理协议数据；循环变量仅在当前循环中有效。
                for tool in tools
            ]


# 中文说明：函数 render_jsonl 承担本脚本的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def render_jsonl(records: list[object]) -> str:
    """Render parsed JSON values as compact, newline-terminated JSONL."""
    return "".join(
        json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n"
        # 中文说明：该循环依次处理协议数据；循环变量仅在当前循环中有效。
        for record in records
    )


# 中文说明：函数 project_session_snapshot 承担本脚本的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def project_session_snapshot(records: list[dict[str, object]]) -> list[dict[str, object]]:
    """Omit storage sequence/time envelopes from snapshot body records."""
    # 中文说明：变量 projected 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    projected = [dict(record) for record in records]
    # 中文说明：该循环依次处理协议数据；循环变量仅在当前循环中有效。
    for record in projected[1:]:
        # 中文说明：该循环依次处理协议数据；循环变量仅在当前循环中有效。
        for key in ("seq", "time", "seq0", "time0"):
            record.pop(key, None)
    return projected


# 中文说明：函数 compare_snapshot_files 承担本脚本的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def compare_snapshot_files(
    files: dict[str, str],
    update: bool,
    directory: Path,
    filenames: tuple[str, ...],
) -> None:
    """Write or exactly compare one scenario's expected snapshot files."""
    # 中文说明：变量 scenario 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    scenario = directory.name
    if tuple(files) != filenames:
        raise AssertionError(f"{scenario} snapshot builder produced {tuple(files)}, expected {filenames}")
    if update:
        directory.mkdir(parents=True, exist_ok=True)
        # 中文说明：该循环依次处理协议数据；循环变量仅在当前循环中有效。
        for name, content in files.items():
            (directory / name).write_text(content, encoding="utf-8")
        print(f"smoke-python-runtime: updated snapshots in {directory}")

    # 中文说明：变量 existing 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    existing = {
        path.name
        # 中文说明：该循环依次处理协议数据；循环变量仅在当前循环中有效。
        for path in directory.iterdir()
        if path.is_file()
    } if directory.is_dir() else set()
    # 中文说明：变量 expected 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    expected = set(filenames)
    if existing != expected:
        raise AssertionError(
            f"{scenario} snapshot files differ: "
            f"missing={sorted(expected - existing)}, unexpected={sorted(existing - expected)}"
        )
    # 中文说明：该循环依次处理协议数据；循环变量仅在当前循环中有效。
    for name, actual in files.items():
        # 中文说明：变量 expected_text 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        expected_text = (directory / name).read_text(encoding="utf-8")
        if actual == expected_text:
            continue
        # 中文说明：变量 diff 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        diff = "".join(difflib.unified_diff(
            expected_text.splitlines(keepends=True),
            actual.splitlines(keepends=True),
            # 中文说明：变量 fromfile 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            fromfile=f"expected/{name}",
            # 中文说明：变量 tofile 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            tofile=f"actual/{name}",
        ))
        raise AssertionError(
            f"{scenario} executable snapshot mismatch in {name}; "
            "rerun with --update-snapshots after reviewing the behavior\n"
            f"{diff}"
        )


if __name__ == "__main__":
    main()
