#!/usr/bin/env python3
"""Run one minimal-agent turn through the bundled Python SDK runtime."""
# 文件职责：通过捆绑的 Python SDK 启动 JSON-RPC 最小代理并执行一次用户任务。
# 技术维度：使用 argparse、上下文管理器和 DeepSeekHarness Python SDK 装配 Cordis 配置。
# 产品维度：为 Python 二次开发者提供可运行的最小示例，演示工作区、会话和模型参数传递。
# 逻辑维度：解析命令行，规范化路径，创建 harness，运行提示词并打印最终回答。
# 关键边界：需要可用提供者凭据；会话目录和工作区由调用方决定，输出只打印 final_response。
# 新手阅读建议：先看 CONFIG 与命令行选项，再跟踪 args 到 DeepSeekHarness 构造参数和 run 调用。

from __future__ import annotations

import argparse
import os
from pathlib import Path

from deepseek_harness import DeepSeekHarness


# 与示例脚本同目录的 Cordis 配置；移动脚本时必须同步移动配置文件。
CONFIG = Path(__file__).with_name("minimal.cordis.yml")


def main() -> None:
    """Parse one task and print the agent's final response."""
    # 功能：解析一个任务并输出代理最终回复。参数：无，读取进程命令行。返回值：无。示例：python minimal.py "解释项目结构"。
    # 命令行解析器；负责生成帮助文本并拒绝无效参数。
    parser = argparse.ArgumentParser()
    parser.add_argument("prompt", help="Task for the minimal agent")
    parser.add_argument("--workspace", type=Path, default=Path.cwd())
    parser.add_argument("--session-root", type=Path, default=Path(".dsh-sessions"))
    parser.add_argument("--session-id")
    parser.add_argument("--provider", default="deepseek-official")
    parser.add_argument("--model", default=os.environ.get("DSH_MODEL", "deepseek-v4-flash"))
    parser.add_argument("--max-tokens", type=int)
    # 已解析参数命名空间；字段由上方 add_argument 定义。
    args = parser.parse_args()

    # 规范化后的工作区绝对路径；代理文件操作以此为当前目录。
    workspace = args.workspace.resolve()
    # 规范化后的会话持久化根目录；可为当前工作区内的 .dsh-sessions。
    session_root = args.session_root.resolve()
    # SDK 上下文管理器；退出 with 时自动关闭 JSON-RPC 运行时和相关资源。
    with DeepSeekHarness(
        provider=args.provider,
        model=args.model,
        max_tokens=args.max_tokens,
        cwd=str(workspace),
        session_root=str(session_root),
        cordis=str(CONFIG.resolve()),
    ) as harness:
        # 单轮执行结果；session_id 可为空以创建新会话。
        result = harness.run(args.prompt, session_id=args.session_id)
    print(result.final_response)


if __name__ == "__main__":
    main()
