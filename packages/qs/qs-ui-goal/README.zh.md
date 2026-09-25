---
description: "复用官方目标服务的会话目标呈现。"
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-ui-goal

[English](README.md) | 中文

## 概述

在奇术输入上方呈现持久目标状态及携带版本的操作。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用本包

本包独立对应 ui-goal，依赖官方 goalPresentation 提供者、目标投影、Remote 服务以及奇术输入和转写槽。正式 Web 配置独立注册本包；选择官方界面时，未声明的奇术槽使其不挂载呈现。

<a id="understand-the-implementation"></a>
## 理解实现

清除前通过模态弹窗确认所显示的目标正文。取消和 Escape 不提交；确认携带打开时捕获的 GoalRef，由 Host CAS 拒绝较新版本。切换会话或目标会关闭确认。

创建使用 goals.create 并提交原样目标正文。编辑捕获用户看到的 GoalRef。版本冲突保留草稿并禁止保存，只有显式刷新成功后才解除；刷新失败保持禁止状态。刷新不自动提交，也不将草稿改投其他目标。会话或目标身份变化会丢弃局部状态，并阻止旧请求结果更新界面。持久阶段与进程激活分开呈现；已完成目标和实际轮数持续可见。本视图没有独立领域状态，因此不发布 invariant 伴随插件。

<a id="model-experience"></a>
## 模型体验

### 浏览器呈现

#### 模型看到什么

视图不创建新模型消息或历史 Definition。官方目标变更保持已有 `goal/change` 日志及模型上下文行为。

#### Token 影响

呈现层不增加提示词或工具定义 Token。

#### KV Cache 影响

视图不构造提供者请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 表单仅编辑目标正文，不修改轮数上限。浏览器验收与工作台组合检查单独记录，不以组件覆盖率替代。

### 开发备注

同一实例的变更请求串行执行。历史行只装饰首个已执行的命令标记，目标正文中的命令提及按文本呈现。
