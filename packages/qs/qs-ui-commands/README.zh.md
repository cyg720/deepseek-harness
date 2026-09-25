---
description: "奇术commands呈现插件。"
kind: "package-reference"
---

# qs-ui-commands

[English](README.md) | 中文

## 概述

通过官方会话级命令控制器呈现命令选项和风险确认。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用本包

Web bundle 在 qs-composer 旁装配本插件。本插件贡献 qs.composer.overlay 并复用唯一的官方 commandUi 服务；官方界面保留自身呈现。

<a id="understand-the-implementation"></a>
## 理解实现

官方控制器负责选项加载、筛选、选择、风险确认与草稿命令消费。视图打开时冻结输入宿主，恢复对应会话的焦点，卸载时释放冻结和焦点订阅。关闭撤销迟到结果的界面写入及草稿消费权，不撤销已经提交的业务操作。本包没有独立可变的领域状态，因此不提供 invariant 伴随包。

风险确认使用奇术主题根内的原生模态对话框。浏览器约束焦点，Escape 返回选项且不执行，官方控制器仍要求显式勾选确认。

<a id="model-experience"></a>
## 模型体验

### @deepseek-ai/dsh-qs-ui-commands

#### 模型看见什么

`@deepseek-ai/dsh-qs-ui-commands`: 不新增模型可见行为；所选命令通过官方命令服务执行。

#### Token 影响

不增加提示词或 schema token。

#### KV Cache 影响

无；本插件不组装模型请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 命令目录失败属于命令候选呈现职责；本视图处理选项加载及执行失败。第二优先完整验收仍需要其他计划插件及集成场景。

### 开发备注

插件对应关系与验证记录见 [FRAMEWORK.md](../FRAMEWORK.md)。
