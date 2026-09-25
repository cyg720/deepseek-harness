---
description: "奇术设置导航与通用偏好组合。"
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-ui-settings-general

[English](README.md) | 中文

## 概述

从奇术侧栏打开设置；弹窗组合独立注册的分区和通用偏好行。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与未完成项](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用本包

Web bundle 将本包作为 ui-settings-general 的独立对应插件装配，并共用官方 settingsScope 服务。只显示已注册的 QS 分区，配置编辑归注册分区的功能插件。

<a id="understand-the-implementation"></a>
## 理解实现

侧栏持有入口槽；本包持有弹窗、分区与操作槽、有序引导以及通用设置分区。Host 配置和修订来自官方 describe 镜像。本机文件操作只在回环连接且提供者确有配置文件时显示，不接受客户端路径；打开失败显示本地化反馈。原生对话框负责模态焦点和 Escape。配置与连接权威仍由官方服务持有，因此不发布 invariant 伴随模块。

<a id="model-experience"></a>
## 模型体验

### 浏览器呈现

#### 模型看到什么

`@deepseek-ai/dsh-qs-ui-settings-general` 不增加模型消息或工具定义。

#### Token 影响

不增加提示词 token。

#### KV 缓存影响

设置壳不构造模型请求。

## 已知限制与未完成项

<a id="known-limitations-and-deferred-work"></a>

- 设置壳不实现模型、插件、库存、权限、模型选择或预设表单；它们由各自独立 QS 插件贡献分区与操作。主题、语言和会话偏好同样归对应功能插件。设置壳可用不表示 W10 完整验收。

### 开发备注

设置值和文件可用性仍由官方服务提供；本插件只持有呈现及本地弹窗状态。
