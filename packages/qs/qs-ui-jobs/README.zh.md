---
description: "只读会话后台作业。"
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-ui-jobs

[English](README.md) | 中文

## 概述

只读作业列表，共享控制状态和恢复。

## 目录

- [使用本包](#use-this-package)
- [实现说明](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用本包

Web profile 将这一独立 ui-jobs 对应插件装配到奇术会话标题区。没有本包专用配置。

<a id="understand-the-implementation"></a>
## 实现说明

本插件读取 jobsBySession 和 ISessions.control，不轮询或复制注册表。显示五种状态、生产者详情、UTC 时间及耗时，缺少详情或结果时明确提示。只有列表展开、连接就绪且存在活动作业时才启动时钟。会话切换重置弹层。终止重试由官方所有者串行处理，载体中断仍自动重连。视图没有独立领域状态，因此不发布 invariant 伴生入口。

内部通知跟踪器在有界身份集合中比较已观察到的活动与终态作业。首次终态、控制基线变化、Host 身份变化及清空后的观察均不通知，不保留结果正文或持久已读状态。插件通过共享控制状态与列表观察已访问且仍可访问的会话，在工作台激活时经 qsToast 展示本地化终态提示。退出和卸载清理通知及排队回调；外壳 notificationCapacity 限制记录身份与已访问会话数，不创建额外控制流。

<a id="model-experience"></a>
## 模型体验

### 浏览器呈现

#### 模型可见内容

`@deepseek-ai/dsh-qs-ui-jobs` 仅呈现进程内作业状态，不增加模型可见输入。

#### Token 影响

不增加提示词或工具 schema token。

#### KV Cache 影响

无；视图不构造 Provider 请求。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 只读视图不提供取消、重启、通用进度或结果定位。完整第二优先验收仍是独立工作。

### 开发备注

返回会话关闭当前会话弹层并将焦点还给入口。
