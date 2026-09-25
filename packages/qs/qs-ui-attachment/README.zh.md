---
description: "通过会话授权读取呈现已有附件。"
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-ui-attachment

[English](README.md) | 中文

## 概述

已有图片附件的重试和原图查看。

## 目录

- [使用](#use-this-package)
- [实现说明](#understand-the-implementation)
- [模型体验](#model-experience)
- [限制与后续工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用

Web profile 与奇术转写、工具呈现一同装配此插件，没有包级配置。

<a id="understand-the-implementation"></a>
## 实现说明

消息、工具和轨迹槽分别注册。官方会话授权加载器拥有 URL 及缓存；本包只拥有显示状态和原图弹层。卸载视图后忽略迟到响应。不发布 invariant，因为没有独立领域状态。 原图通过 body portal 覆盖视口，打开时聚焦关闭按钮；Escape、按下遮罩或关闭按钮均可关闭，并恢复打开前的焦点。

<a id="model-experience"></a>
## 模型体验

### 浏览器呈现

#### 模型看见什么

`@deepseek-ai/dsh-qs-ui-attachment` 仅改变浏览器呈现，不新增模型可见输入。

#### Token 影响

不增加提示词或工具 Schema token。

#### KV Cache 影响

无；图片呈现不构建模型请求。

## 限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 不实现新增上传；轨迹接线等待对应宿主。真实浏览器及完整第二优先验收仍待完成。

### 开发备注

官方 Conversation 所有者在界面切换期间保留图片 URL。
