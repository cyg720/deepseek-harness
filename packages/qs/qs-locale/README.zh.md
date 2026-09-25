---
description: "复用官方语言服务的奇术语言选择。"
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-locale

[English](README.md) | 中文

## 概述

在奇术设置中选择界面语言，选项来自官方语言注册表。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与未完成项](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用本包

本包独立对应官方 locale 的设置行，向 qs.settings.general.item 贡献呈现。Web 装配保留官方 locale 服务作为唯一语言与偏好所有者，无额外插件配置。

<a id="understand-the-implementation"></a>
## 理解实现

设置行直接读取官方服务注册的语言名称与当前选择，通过 setLocale 委派选择，不复制 store 或持久化逻辑。Host 加载中和只读状态禁用控件，memory 连接允许明确标注的临时选择。卸载呈现释放其槽和词典，不销毁官方语言服务。注册表与偏好仍由官方服务持有，因此不发布 invariant 伴随模块。

<a id="model-experience"></a>
## 模型体验

### 浏览器呈现

#### 模型看到什么

`@deepseek-ai/dsh-qs-locale` 不增加模型消息或工具定义。

#### Token 影响

不增加提示词 token。

#### KV 缓存影响

设置行不构造模型请求。

## 已知限制与未完成项

<a id="known-limitations-and-deferred-work"></a>

- 选择立即改变当前界面。官方 setLocale 命令不返回持久化确认，设置行不会声称保存成功。持久写入失败反馈仍属于完整设置验收工作。

### 开发备注

语言包扩展官方注册表，呈现层不要硬编码另一份支持语言清单。
