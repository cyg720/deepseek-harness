---
description: "奇术工作台插件组。"
kind: "package-group"
---

# 奇术工作台

[English](README.md) | 中文

## 概述

奇术插件提供外壳、静态登录、品牌与左右栏呈现、会话导航、输入、转写、工具呈现、审批和提问。它们遵循[客户端模块子系统](../../docs/subsystems/client-modules.zh.md)，并保留可配置的官方界面。

## 包列表

- [qs-ui-model-selection](qs-ui-model-selection/README.zh.md)：复用官方共享目录的模型与推理强度呈现，待验收。
- [qs-shell](qs-shell/README.zh.md)
- [qs-login](qs-login/README.zh.md)
- [qs-ui-brand](qs-ui-brand/README.zh.md)
- [qs-ui-sidebar](qs-ui-sidebar/README.zh.md)
- [qs-ui-sidebar-right](qs-ui-sidebar-right/README.zh.md)
- [qs-sessions](qs-sessions/README.zh.md)
- [qs-composer](qs-composer/README.zh.md)
- [qs-transcript](qs-transcript/README.zh.md)
- [qs-ui-tool](qs-ui-tool/README.zh.md)
- [qs-approval](qs-approval/README.zh.md)
- [qs-questions](qs-questions/README.zh.md)

[命令候选插件](qs-ui-input-trigger/README.zh.md)对应官方 ui-input-trigger，并复用其控制器。

- [qs-ui-commands](qs-ui-commands/README.zh.md): 基于官方命令控制器的选项弹层与风险确认。
- [qs-ui-permission-presets](qs-ui-permission-presets/README.zh.md): 当前会话权限选项和新会话默认值，切回官方恢复其呈现。

- [qs-ui-message-feedback](qs-ui-message-feedback/README.zh.md): 通过官方共享 owner 提供消息评价与会话反馈。

- [qs-ui-deliverables](qs-ui-deliverables/README.zh.md): 共享官方控制器的交付卡和 present 工具状态。

- [qs-ui-goal](qs-ui-goal/README.zh.md): 基于官方共享服务的目标状态及携带版本的操作。
- [qs-ui-subagent](qs-ui-subagent/README.zh.md)：共享官方 Session 服务的子目录、导航和只读输入呈现。
- [qs-ui-directory-picker-native](qs-ui-directory-picker-native/README.zh.md)：复用官方 Host 能力的原生 OS 目录选择。
- [qs-ui-directory-picker-browse](qs-ui-directory-picker-browse/README.zh.md)：通过官方工作区服务浏览和新建 Host 目录。
- [qs-ui-agent-preset](qs-ui-agent-preset/README.zh.md): 共享预设目录；选择与管理动作仍待实现。
- [qs-ui-settings-models](qs-ui-settings-models/README.zh.md)：复用官方模型设置的供应商目录，编辑与 Web 装配仍待完成。
