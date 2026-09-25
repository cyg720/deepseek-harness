---
description: "共享官方文件状态的奇术工作区目录树。"
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-ui-sidebar-files

[English](README.md) | 中文

## 概述

共享官方文件状态的奇术工作区目录树。

## 目录

- [使用](#use-this-package)
- [实现说明](#understand-the-implementation)
- [模型体验](#model-experience)
- [限制与后续工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用

Web profile 将本插件与官方文件树数据所有者及奇术右栏共同装配，无独立配置项。

<a id="understand-the-implementation"></a>
## 实现说明

正文与标题按官方 files 定义身份注册在奇术 keyed 槽。sidebarFilesPresentation 持有 store 句柄和请求代次；本插件只读取其 session/tab 状态并调用操作。文件通过标签资源导航打开，目录权限与条目上限仍由 Host 控制。未知 Remote 失败使用本地化通用文案，不回显原始诊断。本视图没有独立领域状态，因此不提供 invariant 入口。

<a id="model-experience"></a>
## 模型体验

### 浏览器呈现

#### 模型看见什么

`@deepseek-ai/dsh-qs-ui-sidebar-files` 仅改变浏览器呈现，不新增模型可见输入。

#### Token 影响

不增加提示词或工具 Schema token。

#### KV Cache 影响

无；目录读取不构建模型请求。

## 限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 文件预览正文属于独立文档预览插件，本包未实现；不提供重命名、删除、文件监听或目录搜索。工作区选择流程和文件预览仍待完成。

### 开发备注

官方文件树所有者在界面切换期间保留状态。
