# Agent Note: 回放参数的 JSON 安全替换

Status: implemented

[English](2026-09-17-replay-json-string-substitution.md) | 中文

## Problem

录制的工具参数包含 JSON 字符串值。直接插入请求中的 Windows 路径或带引号的值会破坏 JSON，导致回放在浏览器场景验证目标行为之前就拒绝工具调用。

## Decision

回放解析器对 `tool-call.arguments` 和 `tool-call-delta.argumentsDelta` 中的请求捕获值进行 JSON 转义。这些字段内的占位符位于 JSON 字符串值中。普通文本占位符保留捕获原值。完整块和流增量使用相同转义，保留录制工具调用及其可观察结果。

[浏览器测试决策](../../../implemented/testing/2026-07-24-web-gui-browser-e2e-lane.zh.md)继续负责装配、夹具消费和黄金文件比较。本规则作为补充，不替代该测试流程，也不授权重写录制 Session。

## Alternatives considered

**相对路径回放覆盖。** 它能生成文件，却改变录制参数和文件操作标签。保留绝对路径行为可以保留已有的独立验收依据。

**放宽快照或参数校验。** 它们会掩盖非法回放输入，无法证明目标工具操作已经执行。

## Consequences

反斜杠、引号和控制字符以合法参数字符串内容通过回放。参数 JSON 中的占位符是字符串替换，不用于插入原始 JSON 片段。所属包内的回归使用同一捕获值验证增量、完整块及普通文本。
