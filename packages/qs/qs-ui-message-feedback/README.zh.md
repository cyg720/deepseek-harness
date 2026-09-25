---
description: "奇术message-feedback呈现插件。"
kind: "package-reference"
---

# qs-ui-message-feedback

[English](README.md) | 中文

## 概述

通过官方共享反馈 owner 提供持久助手消息评价及会话反馈。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用本包

Web bundle 将消息动作挂在 qs.chat.assistant-actions，会话表单挂在 qs.composer.overlay。只有收尾助手消息具有持久 messageId 时才提供评价按钮。点击未记录评价打开表单；点击已记录评价撤回该评价。裸 /feedback 经官方装饰打开会话反馈，带参命令仍归 Host 所有。

<a id="understand-the-implementation"></a>
## 理解实现

messageFeedbackPresentation 提供官方界面同源的会话动作与表单。本插件不拥有控制器、命令注册或持久状态。分类、文本及反馈对象保留在共享表单中。失败保留草稿，版本冲突显示权威结果，关闭提交中的表单不取消已接受的写入。输入冻结仅在表单打开且已挂载时持有。切换会话释放视图冻结，保留官方会话草稿。本包没有独立可变领域状态，因此不提供 invariant 伴随包。

<a id="model-experience"></a>
## 模型体验

### @deepseek-ai/dsh-qs-ui-message-feedback

#### 模型看见什么

`@deepseek-ai/dsh-qs-ui-message-feedback`: 不新增模型可见输入。反馈通过官方持久事件写入，不启动模型轮次。

#### Token 影响

不增加提示词或 schema token。

#### KV Cache 影响

无；本插件不组装模型请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 反馈确认提示与任务完成通知独立。本插件不观察作业完成，也不发送系统通知。任务通知仍归布局消费者，采用独立的去重和重连规则。

### 开发备注

插件对应关系与验证记录见 [FRAMEWORK.md](../FRAMEWORK.md)。
