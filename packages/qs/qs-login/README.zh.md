---
description: "奇术工作台登录视图：静态登录状态、qsAuth 服务与 qs.gate 贡献。"
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-login

[English](README.md) | 中文

## 概述

用户可通过静态登录表单进入本地演示工作台。该表单不保护 API 访问，也未接入后端登录接口。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用本包

在 Web 组合中与其他奇术插件一起挂载。本地演示使用 `admin` 和 `Demo@2026`，它们不是真实认证凭据。

勾选保持登录后，刷新会恢复静态演示会话。仅保存演示用户名和选择标记，不保存密码；退出登录清除两者。此功能只控制界面展示，不授予 Host 身份或权限。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节</summary>

登录表单与根视图共享插件持有的认证状态。静态网关校验演示凭据，不保存密码。登录门仅有一个状态源，因此不发布运行时 invariant 伴随入口。

</details>

<a id="model-experience"></a>
## 模型体验

### 浏览器呈现

#### 模型可见内容

`@deepseek-ai/dsh-qs-login`：无；静态登录门不贡献模型可见输入。

#### Token 影响

本包不添加自有提示词或工具 schema；用户提交内容由官方服务处理。

#### KV 缓存影响

无；两个入口均不组装或发送提供方请求。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 尚未接入真实认证、授权或账号恢复。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文</summary>

[第一优先计划](../../../qishu/dev-components/第一优先开发计划评审/00-评审总纲.md) 定义后续功能；这些占位入口不代表相应里程碑已经完成。

</details>
