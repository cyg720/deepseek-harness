---
description: "复用官方会话服务的子代理目录及只读输入呈现。"
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-ui-subagent

[English](README.md) | 中文

## 概述

在奇术工作台浏览子会话并说明只读输入原因。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用本包

本独立 ui-subagent 对应插件依赖官方 Session 服务和奇术输入槽。Web 配置独立注册本插件；选择官方界面时，槽声明使其保持未激活。

<a id="understand-the-implementation"></a>
## 理解实现

子会话导航使用官方目录完整地址。展开分支取得目录观察，收起或卸载时释放。单次子会话只读；可续聊子会话仅在父级明确不可用且已经停止时只读。未知可用性不代表离线，运行中的可续聊子会话保留普通停止操作。视图没有独立领域状态，因此不发布 invariant 伴随包。

<a id="model-experience"></a>
## 模型体验

### 浏览器呈现

#### 模型可见内容

视图不创建模型消息或历史定义，导航读取已有 `subagent/descriptor` 历史。

#### Token 影响

呈现不新增提示词或工具定义 token。

#### KV Cache 影响

视图不构造提供者请求。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 目录诊断记录不可打开。运行中/当前未运行是实时活动，不表示成功或失败结果。兄弟导航、方向键、Home/End 及 760 像素边界已有浏览器证据。目录使用原生嵌套列表和按钮，不声明 ARIA tree 角色。真实 Host 场景验证父级不可用时的输入限制、子代理专用取消及 FIFO 续聊。该场景在目录响应中注入父级不可用，执行与回放消耗检查保持真实。可选目录指标仍待核查。

### 开发备注

目录观察及请求顺序由官方 Session 所有者负责，本插件仅维护呈现状态。
