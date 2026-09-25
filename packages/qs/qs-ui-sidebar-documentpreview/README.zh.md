---
description: "共享官方内容读取与标签状态的奇术文档预览。"
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-ui-sidebar-documentpreview

[English](README.md) | 中文

## 概述

共享官方内容读取与标签状态的奇术文档预览。

## 目录

- [使用](#use-this-package)
- [实现说明](#understand-the-implementation)
- [模型体验](#model-experience)
- [限制与后续工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用

Web profile 将本插件与官方文档预览所有者及奇术右栏共同装配，无独立配置项。

<a id="understand-the-implementation"></a>
## 实现说明

奇术 keyed 文档宿主与官方界面共享 documentPreviewPresentation。官方元数据决定读取方式，Host 保留文件权限和大小限制。宿主负责重新读取、版本提示、分页、换行和源文件行号导航；text 子插件以转义文本呈现源行；独立 Markdown 和代码子插件使用公共 MarkdownText 与 CodeBlock，代码阅读位置和行号导航使用内部滚动容器。图片子插件通过 img Blob URL 按原始尺寸显示完整字节，SVG 不进入应用 DOM；替换或卸载图片会释放 URL。HTML 使用官方 prepareHtml 操作收集有限静态脚本和样式表，再在仅设置 sandbox="allow-scripts" 的 iframe 中运行；取消时淘汰旧准备并释放 frame URL，不向 iframe 提供 Host 回调。PDF 使用官方 documentPdfPresentation 的页码状态、worker 和受限画布绘制；页面按可见区域延迟绘制，正文卸载取消绘制并释放 worker。本视图不持有独立领域状态，因此不提供 invariant 入口。

<a id="model-experience"></a>
## 模型体验

### 浏览器呈现

#### 模型看见什么

`@deepseek-ai/dsh-qs-ui-sidebar-documentpreview` 仅改变浏览器呈现，不新增模型可见输入。

#### Token 影响

不增加提示词或工具 Schema token。

#### KV Cache 影响

无；目录读取不构建模型请求。

## 限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 当前已实现纯文本、Markdown、代码、图片、HTML 和 PDF 正文。与当前官方阅读器一致，PDF 不提供独立缩放、密码输入或字节视图滚动位置恢复。文件树打开与查看方式切换已有定向浏览器验证，本包逐文件覆盖率已通过，第二优先完整验收仍未完成；工作区目录选择器属于另一独立插件。

### 开发备注

官方预览所有者在界面切换期间保留内容、请求代次和阅读状态。
