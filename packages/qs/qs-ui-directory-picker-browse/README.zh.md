---
description: "基于官方 Host 能力的奇术目录浏览器。"
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-ui-directory-picker-browse

[English](README.md) | 中文

## 概述

从奇术工作区的任一入口浏览 Host 目录，不创建额外的 Host provider。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用此包

本包独立对应 ui-directory-picker-browse，填充两个 QS 目录流程槽。Web 自动选择器在 browse 分支追加本包。固定装配必须包含官方浏览式 Host provider 和本 Client 呈现。路径指向 Host，它可能不是浏览器所在电脑。

<a id="understand-the-implementation"></a>
## 理解实现

弹层支持完整路径跳转、主目录及祖先导航、隐藏目录、新建和选择。仅使用 Host 返回的完整路径。被替代的扫描接收中止信号，迟到结果不能发布。每次请求拥有全新的控制器及草稿。关闭窗口阻止在途创建完成后导航，但不会撤销已在 Host 上创建的目录。读取失败禁用旧列表的确认操作。本地化错误不包含原始诊断。两个槽贡献和字典随插件释放。视图不拥有可独立观察的持久领域状态，因此不发布 invariant 配套入口。

<a id="model-experience"></a>
## 模型体验

### 浏览器呈现

#### 模型看到什么

视图调用 `uiWorkspace.listDirectory` 和 `uiWorkspace.createDirectory`，不增加模型消息。QS 工作区 owner 通过官方服务登记确认路径并打开所属会话。

#### Token 影响

不增加提示词或工具 schema。

#### KV Cache 影响

视图不构造供应商请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- Host 列表上限可能省略大型目录排序后的尾部；弹层提示截断并允许完整路径跳转。新建目录会立即操作文件系统，不是可撤销的选择预览。浏览式与原生呈现不能同时占用同一组槽。

### 开发备注

组件检查覆盖请求隔离。真实 Host 装配及完整平台矩阵需要独立验收证据。
