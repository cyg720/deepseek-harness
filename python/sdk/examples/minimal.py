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


def main() -> None:
    """Parse one task and print the agent's final response."""
    # 功能：解析一个任务并输出代理最终回复。参数：无，读取进程命令行。返回值：无。示例：python minimal.py "解释项目结构"。
    # 命令行解析器；负责生成帮助文本并拒绝无效参数。
    parser = argparse.ArgumentParser()
    configured_home = os.environ.get("DSH_HOME", "")
    parser.add_argument("prompt", help="Task for the minimal agent")
    parser.add_argument("--workspace", type=Path, default=Path.cwd())
    parser.add_argument(
        "--dsh-home",
        type=Path,
        default=Path(configured_home) if configured_home.strip() else None,
    )
    parser.add_argument("--profile", default="sdk-minimal")
    parser.add_argument("--session-id")
    parser.add_argument("--provider", default="deepseek-official")
    parser.add_argument("--model", default=os.environ.get("DSH_MODEL", "deepseek-v4-flash"))
    parser.add_argument("--max-tokens", type=int)
    # 已解析参数命名空间；字段由上方 add_argument 定义。
    args = parser.parse_args()
    if args.dsh_home is None:
        parser.error("--dsh-home or a non-empty DSH_HOME is required")

    # 规范化后的工作区绝对路径；代理文件操作以此为当前目录。
    workspace = args.workspace.resolve()
    dsh_home = args.dsh_home.resolve()
    with DeepSeekHarness(
        provider=args.provider,
        model=args.model,
        max_tokens=args.max_tokens,
        cwd=str(workspace),
        dsh_home=str(dsh_home),
        profile=args.profile,
    ) as harness:
        # 单轮执行结果；session_id 可为空以创建新会话。
        result = harness.run(args.prompt, session_id=args.session_id)
    print(result.final_response)


if __name__ == "__main__":
    main()
