---
description: "奇术只读 Host 插件清单。"
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-ui-settings-plugin-inventory

[English](README.md) | 中文

## 概述

通过官方只读清单 RPC 查看全局插件和各预设的组合。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与未完成项](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用本包

本包独立对应 ui-settings-plugin-inventory，向 qs.settings.plugins.tab 贡献 all 标签。与 qs-ui-settings-plugins 一起在 Web 组合中装配，官方 Host 清单服务保持唯一，无额外配置。

<a id="understand-the-implementation"></a>
## 理解实现

页面延迟加载，读取所有者释放后忽略回执。失败显示本地化重试，不暴露原始 RPC 错误。搜索覆盖全局及预设分组的模块名和 entryId，全局失败项优先。预设条件和损坏信息仅按文本展示，不执行脚本。页面没有独立维护的清单，因此不发布 invariant 伴随入口。

<a id="model-experience"></a>
## 模型体验

### 浏览器呈现

#### 模型看到什么

`@deepseek-ai/dsh-qs-ui-settings-plugin-inventory` 不增加模型消息或工具定义。

#### Token 影响

不增加提示词 token。

#### KV 缓存影响

设置行不构造模型请求。

## 已知限制与未完成项

<a id="known-limitations-and-deferred-work"></a>

- 清单是读取时快照，关闭并重开设置会刷新。本页不启用、禁用或卸载插件；null 运行状态表示未观察到，不代表确认停止。

### 开发备注

区分全局启用、预设条件启用和已观察的 Fiber 状态。预设名称使用官方 display 解析器，保留用户自定义名称。
