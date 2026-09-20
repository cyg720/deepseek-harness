---
description: "奇术工作台提问卡：提问表单、方案确认与答案协议。"
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-questions

[English](README.md) | 中文

## 概述

回答单选、多选和自由文本问题，或阅读只读 Markdown 方案。未完成的批次定位到第一个未回答的问题；提交失败保留答案。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用本包

在 [Web 组合](../../bundle/web-app/cordis.patch.yml) 中与其他奇术插件行一起挂载 `@deepseek-ai/dsh-qs-questions`。本包没有部署配置字段。

单选的选项与自由文本互斥，最后一次选择替换先前答案。多选允许选中项与自由文本同时提交。

请求待处理时，草稿在界面切换后保留。官方请求完成或撤回时仅清除该请求的草稿，包括在工作台之外提交的回答。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节</summary>

官方提问域持有待处理请求和答复编码。草稿按会话、请求和问题存于插件内存。本包没有需要运行时 invariant 伴随入口检查的独立持久化权威状态。

</details>

官方服务持有会话权威数据，本包仅呈现这些数据，因此不发布运行时 invariant 伴随入口。

<a id="model-experience"></a>
## 模型体验

### 浏览器呈现

#### 模型可见内容

`@deepseek-ai/dsh-qs-questions`：无；浏览器视图将用户动作委托给官方服务，不构造模型请求。

#### Token 影响

本包不添加自有提示词或工具 schema；用户提交内容由官方服务处理。

#### KV 缓存影响

无；两个入口均不组装或发送提供方请求。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 问题草稿仅在已加载插件内跨会话切换保留；刷新页面或替换插件会清空草稿。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文</summary>

验证状态见[复核修复记录](../../../qishu/PRD/1-AI工作台/复核测试/02-复核修复与全量验证.md)。

</details>
