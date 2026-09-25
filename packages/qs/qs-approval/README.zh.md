---
description: "奇术工作台审批卡：待答复审批呈现、callId 派生详情与 qs.stage.interaction 贡献。"
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-approval

[English](README.md) | 中文

## 概述

查看待处理的工具审批，选择允许一次或拒绝。答复失败后保留请求以供重试，详情可通过键盘滚动。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用本包

在 [Web 组合](../../bundle/web-app/cordis.patch.yml) 中与其他奇术插件行一起挂载 `@deepseek-ai/dsh-qs-approval`。本包没有部署配置字段。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节</summary>

官方审批域持有待处理请求和答复。失败重试沿用原来的审批决定。本包贡献按请求键隔离的交互卡，并从工具调用记录提取详情；没有需要运行时 invariant 伴随入口检查的独立权威状态。

每个请求持有同步提交锁，直到答复失败或卡片被替换；重复事件不会再次发送答案。

</details>

官方服务持有会话权威数据，本包仅呈现这些数据，因此不发布运行时 invariant 伴随入口。

<a id="model-experience"></a>
## 模型体验

### 浏览器呈现

#### 模型可见内容

`@deepseek-ai/dsh-qs-approval`：无；浏览器视图将用户动作委托给官方服务，不构造模型请求。

#### Token 影响

本包不添加自有提示词或工具 schema；用户提交内容由官方服务处理。

#### KV 缓存影响

无；两个入口均不组装或发送提供方请求。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 仅提供允许一次和拒绝；持久化权限规则编辑不属于本卡片。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文</summary>

验证状态见[复核修复记录](../../../qishu/PRD/1-AI工作台/复核测试/02-复核修复与全量验证.md)。

</details>
