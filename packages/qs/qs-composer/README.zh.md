---
description: "奇术工作台输入区：草稿、发送、停止、队列处理与无会话创建的交接。"
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-composer

[English](README.md) | 中文

## 概述

在当前会话编辑并发送消息，也可在首次发送时创建会话。运行中的会话接收排队消息；队列项可编辑、移除或引导当前轮。创建失败保留草稿及预分配的会话标识。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用本包

在 [Web 组合](../../bundle/web-app/cordis.patch.yml) 中与其他奇术插件行一起挂载 `@deepseek-ai/dsh-qs-composer`。本包没有部署配置字段。

首条消息交接过程中出现阻塞时，草稿保持可编辑。恢复后需要再次明确发送；重新连接不会自动提交保留的草稿。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节</summary>

客户端将发送委托给官方输入机。取消或卸载会使尚未完成的创建失效，阻止迟到导航；请求失败不代表创建成功。错误提示与阻塞原因由官方会话状态提供。本适配层没有可独立比较的持久化投影，因此不发布运行时 invariant 伴随入口。

</details>

<a id="model-experience"></a>
## 模型体验

### 浏览器呈现

#### 模型可见内容

`@deepseek-ai/dsh-qs-composer`：无；浏览器视图将用户动作委托给官方服务，不构造模型请求。

#### Token 影响

本包不添加自有提示词或工具 schema；用户提交内容由官方服务处理。

#### KV 缓存影响

无；两个入口均不组装或发送提供方请求。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 本阶段不支持附件或模型选择，模型名称只读显示。首次发送失败后重试复用同一标识；取消不会删除 Host 已创建的会话。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文</summary>

验证状态见[复核修复记录](../../../qishu/PRD/1-AI工作台/复核测试/02-复核修复与全量验证.md)。

</details>
