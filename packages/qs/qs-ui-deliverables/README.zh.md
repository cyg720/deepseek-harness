---
description: "共享官方持久文件事实和本机动作的奇术交付卡。"
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-ui-deliverables

[English](README.md) | 中文

## 概述

共享官方持久文件事实和本机动作的奇术交付卡。

## 目录

- [使用](#use-this-package)
- [实现说明](#understand-the-implementation)
- [模型体验](#model-experience)
- [限制与后续工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用

Web profile 将本插件与官方 ui-deliverables、奇术转写和工具呈现共同装配，无独立配置项。

<a id="understand-the-implementation"></a>
## 实现说明

轮次收尾和 present 工具分别注册，使用官方 deliverablesPresentation 选择器和同一个本机打开控制器。工作区预览走官方资源导航；仅用户显式打开或定位手势才向服务端 Host 请求本机动作。每次动作保留正在查看的会话及原交付事件序号、索引。描述以文本呈现，等待中禁用重复动作，Host 元数据失败可以重试。本插件不持有独立领域状态，因此不提供 invariant 入口。

<a id="model-experience"></a>
## 模型体验

### 浏览器呈现

#### 模型看见什么

`@deepseek-ai/dsh-qs-ui-deliverables` 仅改变浏览器呈现，不新增模型可见输入。

#### Token 影响

不增加提示词或工具 Schema token。

#### KV Cache 影响

无；交付呈现不构建模型请求。

## 限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 附件和轨迹导航属于其他独立插件；奇术最终回答中的行内代码文件引用使用官方提供者，打开同一工作区预览。本机操作要求服务端 Host 存在桌面，不是在浏览器所在设备执行。第二优先完整验收仍未完成。

### 开发备注

官方文件树所有者在界面切换期间保留状态。
