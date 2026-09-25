---
description: "奇术命令候选菜单。"
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-ui-input-trigger

[English](README.md) | 中文

## 概述

通过官方会话级输入触发控制器呈现命令候选。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [Model Experience](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用本包

Web 组合将本插件与 qs-composer 一同装配。它仅贡献 qs.composer.overlay，官方界面保留原菜单。

<a id="understand-the-implementation"></a>
## 理解实现

输入宿主持有消费者租约。本插件绑定光标与键盘适配器，并订阅官方菜单状态；卸载时移除适配器并关闭菜单，不创建第二个控制器或来源注册表。本插件不拥有独立可变的领域状态，因此不提供 invariant 伴生模块。

<a id="model-experience"></a>
## Model Experience

### @deepseek-ai/dsh-qs-ui-input-trigger

#### 模型看见什么

`@deepseek-ai/dsh-qs-ui-input-trigger`: 不新增模型可见行为；命令与输入执行仍由官方服务负责。

#### Token effect

不增加提示词或 schema token。

#### KV Cache effect

无；本插件不组装模型请求。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 命令选项弹层与确认归独立 qs-ui-commands 呈现插件。目录失败和空结果恢复仍需集成验证；本包不能单独代表 D7 完成。

### 开发备注

插件对应关系与验证记录见 [FRAMEWORK.md](../FRAMEWORK.md)。
