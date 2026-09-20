---
description: "奇术工作台会话导航：列表、切换、新建、重命名、归档与本地置顶。"
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-sessions

[English](README.md) | 中文

## 概述

在工作台浏览、置顶、切换、重命名及归档会话。并发创建点击共用一个请求；创建期间作出的会话选择不会被迟到结果覆盖。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用本包

在 [Web 组合](../../bundle/web-app/cordis.patch.yml) 中与其他奇术插件行一起挂载 `@deepseek-ai/dsh-qs-sessions`。本包没有部署配置字段。

关闭管理弹窗后，在途结果不会影响随后打开的弹窗。服务器已接受的重命名或归档仍会完成，并更新官方会话快照。

工作台会话列表挂载期间，Ctrl+K 或 Command+K 打开新会话。按键重复、输入法组合输入和已打开的模态对话框会阻止此快捷键。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节</summary>

会话和工作区服务持有列表与归档操作；本包只持有本地置顶与导航视图。创建期间合并重复请求；视图卸载取消本地导航，失败在页面显示并可重试。注册随插件卸载释放。会话成员关系由官方服务持有，因此本包不发布运行时 invariant 伴随入口。

</details>

<a id="model-experience"></a>
## 模型体验

### 浏览器呈现

#### 模型可见内容

`@deepseek-ai/dsh-qs-sessions`：无；浏览器视图将用户动作委托给官方服务，不构造模型请求。

#### Token 影响

本包不添加自有提示词或工具 schema；用户提交内容由官方服务处理。

#### KV 缓存影响

无；两个入口均不组装或发送提供方请求。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 本界面不提供归档恢复。置顶信息保存在当前浏览器，不提供多用户共享排序。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文</summary>

验证状态见[复核修复记录](../../../qishu/PRD/1-AI工作台/复核测试/02-复核修复与全量验证.md)。

</details>
