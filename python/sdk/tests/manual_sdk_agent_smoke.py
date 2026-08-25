"""Drive the repo-source JSON-RPC bin through the SDK and a keyless mock SSE server.

Requires ``pnpm install`` but no build. This manual test is not collected by
pytest; run ``python tests/manual_sdk_agent_smoke.py``.
"""
# 文件职责：验证 manual_sdk_agent_smoke.py 覆盖的Python SDK 与捆绑运行时职责。
# 技术维度：使用 Python、异步 I/O、JSON-RPC、构建后端或标准库文件与进程接口。
# 产品维度：保障 Agent 的Python SDK 与捆绑运行时能力可安装、可调用且可诊断。
# 逻辑维度：解析参数或数据，执行核心调用或校验，再返回结果并处理资源清理。
# 关键边界：外部进程与文件不可信；版本和平台条件必须显式；敏感环境变量不得泄露。
# 新手阅读建议：先看导入和公开类型，再读主流程，最后关注异常、平台差异和清理。

from __future__ import annotations

import argparse
import json
import shutil
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from deepseek_harness import DeepSeekHarness
from deepseek_harness_runtime import bundled_default_config_path


# 中文说明：类 MockCompletionHandler 封装本测试所需的数据和行为，用于表达Python SDK 与捆绑运行时场景。
class MockCompletionHandler(BaseHTTPRequestHandler):
    # 中文说明：变量 requests 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    requests: list[dict[str, Any]] = []

    # 中文说明：函数 do_POST 承担本测试的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
    def do_POST(self) -> None:
        # 中文说明：变量 length 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        length = int(self.headers.get("content-length", "0"))
        # 中文说明：变量 body 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        body = self.rfile.read(length).decode("utf-8")
        self.requests.append({
            "path": self.path,
            "authorization": self.headers.get("authorization"),
            "body": json.loads(body),
        })
        self.send_response(200)
        self.send_header("content-type", "text/event-stream")
        self.end_headers()
        self.wfile.write(b'data: {"choices":[{"delta":{"role":"assistant","content":null,"reasoning_content":""}}]}\n\n')
        self.wfile.write(b'data: {"choices":[{"delta":{"content":"SDK runtime reached the configured HTTP model endpoint."}}]}\n\n')
        self.wfile.write(b'data: {"choices":[{"delta":{"content":""},"finish_reason":"stop"}],"usage":{"prompt_tokens":7,"completion_tokens":9}}\n\n')
        self.wfile.write(b"data: [DONE]\n\n")

    # 中文说明：函数 log_message 承担本测试的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
    def log_message(self, _format: str, *_args: object) -> None:
        return


# 中文说明：函数 run_smoke 承担本测试的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def run_smoke(repo_root: Path, keep_sessions: bool) -> None:
    # 中文说明：变量 session_root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    session_root = Path(tempfile.mkdtemp(prefix="dsh-sdk-smoke-sessions-"))
    # 中文说明：变量 runtime_entry 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    runtime_entry = repo_root / "packages/examples/jsonrpc-demo/src/bin.ts"
    # 中文说明：变量 server 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    server = ThreadingHTTPServer(("127.0.0.1", 0), MockCompletionHandler)
    # 中文说明：变量 thread 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    thread = threading.Thread(target=server.serve_forever, name="mock-openai-compatible-server", daemon=True)
    thread.start()
    # 中文说明：变量 base_url 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    base_url = f"http://127.0.0.1:{server.server_address[1]}"

    print(f"repo_root={repo_root}")
    print(f"session_root={session_root}")
    print(f"mock_base_url={base_url}")

    try:
        with DeepSeekHarness(
            # 中文说明：变量 model 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            model="sdk-smoke-model",
            # 中文说明：变量 cwd 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            cwd=str(repo_root / "python/sdk"),
            # 中文说明：变量 runtime_cwd 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            runtime_cwd=str(repo_root),
            # 中文说明：变量 session_root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            session_root=str(session_root),
            # 中文说明：变量 cordis 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            cordis=str(bundled_default_config_path()),
            # 中文说明：变量 launch_args_override 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            launch_args_override=("node", "--import", "tsx", str(runtime_entry)),
            # 中文说明：变量 env 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            env={
                "DEEPSEEK_BASE_URL": base_url,
                "DEEPSEEK_API_KEY": "sdk-smoke-key",
            },
            # 中文说明：变量 request_timeout_seconds 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            request_timeout_seconds=20,
            # 中文说明：变量 shutdown_timeout_seconds 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            shutdown_timeout_seconds=2,
        ) as harness:
            # 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            result = harness.run(
                "Please reply with a short confirmation and do not call tools.",
                # 中文说明：变量 session_id 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
                session_id="sdk-smoke-main",
            )
        print(f"final_response={result.final_response}")
        assert "configured HTTP model endpoint" in result.final_response
        assert len(MockCompletionHandler.requests) == 1
        # 中文说明：变量 request 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        request = MockCompletionHandler.requests[0]
        print(json.dumps(request, ensure_ascii=False, indent=2)[:4000])
        assert request["authorization"] == "Bearer sdk-smoke-key"
        assert request["body"]["model"] == "sdk-smoke-model"

        # 中文说明：变量 jsonl_files 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        jsonl_files = sorted(session_root.rglob("*.jsonl.zstd"))
        assert jsonl_files, f"no Zstandard JSONL sessions were written under {session_root}"
        print("session_jsonl_zstd_files:")
        # 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。
        for path in jsonl_files:
            print(f"  {path} bytes={path.stat().st_size}")
            assert path.read_bytes().startswith(bytes.fromhex("28b52ffd"))
    finally:
        server.shutdown()
        server.server_close()

    if keep_sessions:
        print(f"kept_session_root={session_root}")
    else:
        shutil.rmtree(session_root)
        print("removed temporary session root")


# 中文说明：函数 main 承担本测试的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def main() -> None:
    # 中文说明：变量 parser 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--repo-root",
        # 中文说明：变量 type 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        type=Path,
        # 中文说明：变量 default 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        default=Path(__file__).resolve().parents[3],
        # 中文说明：变量 help 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        help="Path to the deepseek-harness checkout.",
    )
    parser.add_argument("--keep-sessions", action="store_true")
    # 中文说明：变量 args 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    args = parser.parse_args()
    run_smoke(args.repo_root.resolve(), args.keep_sessions)


if __name__ == "__main__":
    main()
