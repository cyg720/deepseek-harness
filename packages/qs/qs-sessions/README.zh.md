---
description: "奇术工作台会话导航：列表、切换、新建、重命名、归档与本地置顶。"
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-sessions

[English](README.md) | 中文

## 概述

本插件对应官方 ui-workspace 的第一优先会话浏览界面，通过 qs-ui-sidebar 拥有的子槽贡献；继续复用官方 ui-session 服务。

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

新建会话按官方成员关系继承当前会话的已登记工作区；无匹配时使用 Host 默认目录。显式新建按钮创建新会话，另一个工作区选择入口采用共享服务的空白会话复用策略。

欢迎区和侧栏工作区入口共享官方导航服务及当前会话快照；任一入口切换后，另一入口随快照同步。Conversation 卸载只撤销欢迎区贡献，重装后恢复。

工作区选择器读取官方 Workspace 快照，并委托 `uiWorkspace.openWorkspace` 打开。共享服务复用空白会话，防止迟到导航替换较新的选择。选择器锁定并发选择，失败提示不暴露远端诊断，卸载后不再更新本地状态。

两个入口各自拥有目录流程子槽，仅在对应子槽被占用时显示添加动作。共享请求控制器允许一个选择或采纳流程活动；取消拒绝旧回调，迟到的登记结果不能为已撤销请求发起或完成导航。Host 已接受的登记不回滚。卸载及会话导航撤销本地采纳，失败显示通用重试提示。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节</summary>

会话和工作区服务持有列表与归档操作；本包只持有本地置顶与导航视图。创建期间合并重复请求；视图卸载取消本地导航，失败在页面显示并可重试。注册随插件卸载释放。会话成员关系由官方服务持有，因此本包不发布运行时 invariant 伴随入口。

菜单对在途服务调用同步加锁。失败后允许重试；关闭使排队点击和迟到界面更新失效，但不取消服务器已接受的操作。

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

- 该选择器打开已登记工作区。原生分支通过 qs-ui-directory-picker-native 提供目录添加；浏览式分支通过 qs-ui-directory-picker-browse 浏览及新建 Host 目录；完整平台验收仍待补齐。

- 本界面不提供归档恢复。置顶信息保存在当前浏览器，不提供多用户共享排序。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文</summary>

验证状态见[复核修复记录](../../../qishu/PRD/1-AI工作台/复核测试/02-复核修复与全量验证.md)。

</details>
