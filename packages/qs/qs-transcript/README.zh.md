---
description: "奇术会话转写的构建框架。"
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-transcript

[English](README.md) | 中文

## 概述

开发者可以编译和打包空的会话转写插件。该包没有用户可见行为，也未挂载到默认 Web 组合。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用本包

这是开发框架，不是可安装的应用。包位置与范围见[框架说明](../FRAMEWORK.md)。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节</summary>

[Host](src/index.ts) 与 [Client](src/client/index.ts) 均导出空的具名 apply 函数。TypeScript 工程复用客户端配置，打包使用官方 clientBundle 预设。两个入口均不持有状态或可独立观察的关系，因此不发布运行时 invariant 伴随入口。

</details>

<a id="model-experience"></a>
## 模型体验

无，因为两个框架入口均不注册模型可见内容。

#### KV 缓存影响

无；两个入口均不组装或发送提供方请求。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 尚未实现视图、配置、服务、本地化字典和行为测试。
- 默认 Web 挂载及其依赖接线留待运行逻辑实现时完成。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文</summary>

[第一优先计划](../../../qishu/dev-components/第一优先开发计划评审/00-评审总纲.md) 定义后续功能；这些占位入口不代表相应里程碑已经完成。

</details>
