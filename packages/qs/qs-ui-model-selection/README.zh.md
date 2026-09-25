---
description: "奇术模型及推理强度选择，复用唯一官方目录。"
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-ui-model-selection

[English](README.md) | 中文

## 概述

在输入区或 /model 菜单中选择当前会话模型及其支持的推理强度。两个入口复用官方会话目录，保留供应商定义的标识。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与未完成项](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用本包

QS Web 组合挂载本插件，独立对应 ui-model-selection。输入区采用原型下拉布局。已寻址子会话不提供绑定 Agent 的选择操作。本包没有部署配置字段。

<a id="understand-the-implementation"></a>
## 理解实现

官方 modelDirectories 服务保持唯一。槽贡献及优先级为一的命令装饰器随 QS 输入槽生命周期装卸，移除后恢复官方呈现。模型标识按完整选项键查找，选择相同模型保留明确推理强度，切换模型采用该模型声明的默认值。本呈现不拥有独立权威模型状态，因此不需要 invariant 伴随插件。

<a id="model-experience"></a>
## 模型体验

### 模型选择

#### 模型看到什么

官方 `session.selectModel` 操作控制后续模型请求；本呈现不添加模型消息或工具。

#### Token 影响

不增加提示词 token。

#### KV Cache 影响

更换供应商或模型可能改变后续请求路由，缓存行为由供应商决定。

## 已知限制与未完成项

<a id="known-limitations-and-deferred-work"></a>

- 无会话时的模型选择与供应商凭据编辑不属于本呈现，后者归独立 settings-models 插件。断连重连和迟到选择回执仍需完整验收，不能据此将 W10 标为完成。

### 开发备注

模型配置及凭据归独立 settings-models 呈现所有，不在本包创建另一个 modelDirectories 解析器。
