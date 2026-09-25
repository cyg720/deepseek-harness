---
description: "复用官方主题服务的奇术外观与字号选择。"
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-ui-theme

[English](README.md) | 中文

## 概述

在奇术设置中使用官方主题服务选择外观与正文字号。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与未完成项](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用本包

本包独立对应 ui-theme，向 qs.settings.general.item 分别贡献外观及字号行。官方主题服务仍是唯一偏好所有者，无需额外插件配置。

<a id="understand-the-implementation"></a>
## 理解实现

两行读取 ThemeSnapshot 并委派 setTheme 和 setFontSize，不复制状态或持久化。Host 加载中和只读时禁用控件；memory 连接允许明确标注的临时选择。卸载释放行、词典及订阅，不释放官方服务。偏好所有权仍归该服务，因此不发布 invariant 伴随入口。

<a id="model-experience"></a>
## 模型体验

### 浏览器呈现

#### 模型看到什么

`@deepseek-ai/dsh-qs-ui-theme` 不增加模型消息或工具定义。

#### Token 影响

不增加提示词 token。

#### KV 缓存影响

设置行不构造模型请求。

## 已知限制与未完成项

<a id="known-limitations-and-deferred-work"></a>

- 选择立即改变当前界面。官方 setTheme/setFontSize 命令不返回持久化确认，设置行不会声称保存成功。持久写入失败反馈仍属于完整设置验收工作。

### 开发备注

12–17px 整数选项与官方接受范围一致；测试逐项对照官方常量。system 偏好与其解析后的明暗状态保持区分。
