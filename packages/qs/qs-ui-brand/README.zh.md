---
description: "奇术品牌标识与名称。"
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-ui-brand

[English](README.md) | 中文

## 概述

通过独立插件显示奇术品牌标识与名称，同时保留官方服务与官方界面。

## 目录

- [使用](#use-this-package)
- [实现说明](#understand-the-implementation)
- [模型体验](#model-experience)
- [限制与后续工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用

Web 装配在 `qs-shell` 旁加载 `@deepseek-ai/dsh-qs-ui-brand`。本插件使用奇术样式令牌，等待父槽声明，无独立配置项。

<a id="understand-the-implementation"></a>
## 实现说明

<details>
<summary>注册与归属</summary>

布局通过槽传入实时业主参数。本插件拥有视图、字典和可撤销注册，不导入其他功能插件组件，不创建第二个会话服务。没有需要核对的独立持久化观测，因此不提供 invariant 入口。

</details>

<a id="model-experience"></a>
## 模型体验

### 浏览器呈现

#### 模型看见什么

`@deepseek-ai/dsh-qs-ui-brand` 仅改变浏览器呈现。

#### Token 影响

不增加提示词或工具 Schema token。

#### KV Cache 影响

无；本插件不构建模型请求。

## 限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 品牌资产仅用于工作台；官方品牌保持不变。

### 开发备注

插件对应与验收见 packages/qs/FRAMEWORK.md。
