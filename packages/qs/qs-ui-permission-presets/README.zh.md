---
description: "复用官方命令与设置的奇术权限预设呈现。"
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-ui-permission-presets

[English](README.md) | 中文

## 概述

通过既有 Host 权限命令呈现权限预设。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与未完成项](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用本包

本包独立对应 ui-permission-presets，贡献裸 /permission 选择器。QS Web profile 与官方插件并行安装。本包仅在 QS 设置槽存在时注册显式更高优先级的装饰器；切换官方根界面会释放它并恢复官方呈现。

<a id="understand-the-implementation"></a>
## 理解实现

选项和活动状态来自当前会话 permissions 投影。选择目标后委派 Host /permission 命令，由推送投影确认结果状态。custom 仅作显示，完全访问携带由 QS 命令弹层消费的明确确认要求。插件释放撤销词典及命令贡献。相关标识和授权由官方命令注册表、权限域拥有，因此不发布 invariant 伴随入口。

默认权限行从官方动态 schema 派生选项，只写入 `permission.defaultPreset`。保存保留用户选择时的版本和连接代次，完全访问要求明确勾选确认，只读设置不能提交，冲突或未确认写入分别反馈。连接重置使旧确认和写入回执失效，迟到成功不能回滚共享镜像的新版本；现有会话权限保持不变。

<a id="model-experience"></a>
## 模型体验

### 浏览器呈现

#### 模型看到什么

本包不增加模型消息或工具定义。Host `/permission` 命令控制后续操作权限。

#### Token 影响

不增加提示词 token。

#### KV 缓存影响

呈现不构造模型请求。

## 已知限制与未完成项

<a id="known-limitations-and-deferred-work"></a>

- 选择默认值仅作用于之后创建的新会话，本行不批量更新现有会话；现有会话须使用当前会话权限命令。

### 开发备注

当前会话权限命令与新会话默认值分别处理，两者不能互相推断已修改。
