---
description: "奇术原生目录选择，复用官方 Host 能力。"
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-ui-directory-picker-native

[English](README.md) | 中文

## 概述

通过 OS 对话框从奇术欢迎区或侧栏选择 Host 目录。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用本包

本包独立对应 ui-directory-picker-native，填充两个 QS 目录流程槽。Web 自动解析器仅在原生 backend 分支追加本包。固定组合必须搭配官方原生 Host provider；本包不提供 OS 服务。

<a id="understand-the-implementation"></a>
## 理解实现

每个请求身份只启动一次官方 uiWorkspace.pickDirectory 调用；effect 重放重新监听同一个 promise。关闭、更换请求或卸载会丢弃旧成功及失败回调。该 Client 方法没有暴露 Host 对话框取消操作，关闭 QS 入口只撤销采纳，OS 对话框可能继续打开直到被回答。QS 工作区所有者登记返回的目录并控制导航。两项槽注册共同释放。组件不持有独立持久领域状态，因此不发布 invariant 伴随入口。

<a id="model-experience"></a>
## 模型体验

### 浏览器呈现

#### 模型可见内容

本视图调用 `uiWorkspace.pickDirectory`，不创建模型消息。选中目录仅通过官方工作区所有者成为工作区。

#### Token 影响

不增加提示词或工具 schema。

#### KV 缓存影响

本视图不构造提供方请求。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 本包需要本地 Host 显示环境及原生能力。远端浏览属于另一个插件。组件测试替换 OS 选择 promise，Web 测试只替换 Host 能力结果，均不证明平台 OS 对话框的视觉行为。

### 开发备注

目录访问校验与会话创建仍由官方 Host 和 Client 服务负责。
