---
description: "奇术会话级分栏与标签呈现。"
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-ui-sidebar-right

[English](README.md) | 中文

## 概述

通过独立奇术插件呈现会话标签、分栏与浮窗，共享官方右栏 store 与 TabDomain。

## 目录

- [使用](#use-this-package)
- [实现说明](#understand-the-implementation)
- [模型体验](#model-experience)
- [限制与后续工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用

Web 装配在 `qs-shell` 旁加载 `@deepseek-ai/dsh-qs-ui-sidebar-right`。本插件使用奇术样式令牌，等待父槽声明，无独立配置项。

<a id="understand-the-implementation"></a>
## 实现说明

<details>
<summary>注册与归属</summary>

复用官方 sidebarRightPresentation.store、seat 和标签 hook，不创建第二个控制器。外壳传入显式开合请求序号，面板回报实际状态且不增加请求序号；官方导航打开内容也能显示折叠面板。正文和标题按官方 definition.id 注册到 qs.sidebar.right.tab 与 qs.sidebar.right.tab.title，菜单和 guide chain 分别保留扩展职责。缺失正文有可见说明，向导未装配项禁用。标签资源生命周期与跨会话导航由官方 TabDomain 持有，QS 卸载只释放自身呈现。公共 docking 组件在局部映射 QS 色彩令牌，浮窗仍位于 QS 主题根内。全屏面板填满响应式顶栏下方的外壳内容区。本包没有独立持久领域状态，因此不提供 invariant 入口。

</details>

<a id="model-experience"></a>
## 模型体验

### 浏览器呈现

#### 模型看见什么

`@deepseek-ai/dsh-qs-ui-sidebar-right` 仅改变浏览器呈现。

#### Token 影响

不增加提示词或工具 Schema token。

#### KV Cache 影响

无；本插件不构建模型请求。

## 限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 持久化在两套界面中观察共享官方 store。QS 座位挂载时负责保存和即时错误提示，座位缺席时由根级监听保存，避免一次提交重复写入。持续的存储失败在返回 QS 时可见。已删除会话清理及窄屏完整键盘验收仍未完成。文件和预览由独立插件负责。公共 docking 菜单的 portal 主题仍需专项验收。静态登录不构成认证。

QS 按会话在浏览器 localStorage 保存版本 1 布局元数据。首次恢复调用官方 store 动作，保留已有活跃停靠面，解析当前标题并要求存在已注册 QS 正文。文件地址必须通过官方解析器且属于当前会话；其他资源协议、失效标签和同一栏中的重复页面被移除并显示提示。浮窗收敛到当前视口，分栏保留官方 20% 最小比例。损坏记录和存储拒绝不阻断面板使用，并显示本地化提示。清除保存记录保留当前打开的标签。不保存标题、正文、导航参数、运行时身份或撤销历史。已登录变为未登录时清除本插件各会话记录，未登录期间的读写不能恢复或重新保存记录。登录冷态和插件卸载保留记录。浏览器拒绝删除不阻断退出，但可能留下磁盘记录；静态登录不提供数据隔离。

QS 会话座位在挂载和窗口缩放时通过共享官方 store 调整浮窗。窗口事件合并到一个动画帧，卸载取消待执行任务。几何变化保持焦点与层叠，并沿用布局保存流程。

原型的“向前移动”按钮通过官方 placeTab 动作重排活动停靠标签。首标签、空栏和浮窗禁用该操作；标签身份及资源所有权保持不变。

### 开发备注

插件对应与验收见 packages/qs/FRAMEWORK.md。
