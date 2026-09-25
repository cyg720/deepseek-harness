---
description: "当前会话活动提醒的只读目录。"
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-ui-schedule

[English](README.md) | 中文

## 概述

查看活动提醒、本机目标时间、重复周期和逾期提示。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用本包

本包独立对应 ui-schedule，在奇术会话标题区贡献入口。需要官方 Schedule 投影及包含活动记录的已打开会话。Web bundle 解析本包但默认关闭；奇术 Schedule 补丁启用两套呈现并复用一个官方调度所有者，真实 Host 浏览器测试回放活动记录并通过持久化变更移除记录。

<a id="understand-the-implementation"></a>
## 理解实现

插件读取完整 schedule 投影，不调用 RPC 或修改数据。本地目标时间包含 UTC 偏移，各行显示 UTC 原始时间，便于区分夏令时回拨的重叠时刻。浏览器时间仅格式化本机时间及相对时间，不执行提醒。记录按目标时间排序，同时间保持原顺序；只在目录展开时计时，切换会话重置弹层。不发布 invariant 伴生模块，因为视图不持有独立业务状态。

<a id="model-experience"></a>
## 模型体验

### 浏览器呈现

#### 模型可见内容

`@deepseek-ai/dsh-qs-ui-schedule` 仅呈现持久化 Schedule 投影，不增加模型可见输入。

#### Token 影响

不增加提示或工具定义 token。

#### KV 缓存影响

无；视图不构造提供者请求。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 目录只读且仅包含活动记录，派发历史保留在转写中。浏览器逾期标签不等于执行失败；本只读视图不提供创建与取消控件。

### 开发备注

Escape 关闭目录并恢复入口焦点；外部指针按下关闭弹层。
