---
description: "由独立页面贡献组成的奇术插件设置导航。"
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-ui-settings-plugins

[English](README.md) | 中文

## 概述

在独立贡献的插件设置页面间导航，保留已挂载页面的草稿。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与未完成项](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用本包

本包对应 ui-settings-plugins。目前实现 Plugins 分区和 qs.settings.plugins.tab，独立清单插件已接入，Shell 与 AgentLoop 数值卡已接入；导航本身不代表完整设置功能。

<a id="understand-the-implementation"></a>
## 理解实现

标签目录监听槽与语言版本。页面首次选择后挂载，隐藏时保留，贡献移除时释放。方向键、Home 和 End 移动焦点并选择标签。贡献标识由槽目录持有，因此不发布 invariant 伴随入口。

配置标签将动态卡 key 与官方共享设置镜像实际服务的命名空间求交，区分初始加载、连接不可用、初次读取失败重试、只读视图和空卡目录。WebSearch 配置卡已接入，真实 Host 保存和仅凭据重试已通过浏览器验证。

配置卡提交器使用开始编辑时的版本原子提交一批字段，明确区分成功回执、冲突和拒绝；同一卡不重复发送在途保存，释放后忽略回执。成功回执早于镜像新版本时不覆盖新数据。Shell 与 AgentLoop 表单使用该提交器；子代理表单也使用该提交器，WebSearch 已接入，真实 Host 保存和仅凭据重试已通过浏览器验证。

WebSearch 凭据访问器仅读取 configured/writable 元数据，必须收到本次 set 明确成功回执，隔离过期引用，释放后不采用迟到结果，不发布密钥字面量。组合保存器分别报告配置和凭据结果，配置失败或引用变化时不写凭据，允许只重试凭据。编辑器只清理明确成功字段，保留失败草稿，并在卡片卸载、放弃、重连和释放时清除密钥明文。这些组件已有隔离测试，可见 WebSearch 表单与凭据失效事件订阅已接入，真实 Host 浏览器已验证配置成功但凭据请求中断、仅重试凭据、刷新持久化及密码框为空。

子代理配置目录读取器在刷新、连接重置和释放时使旧请求失效。实时目录缺失的已保存路由仍予保留，以便移除。编辑器将开关与允许路由暂存为同一版本的一次提交，失败保留草稿，连接重置清除旧连接草稿。子代理配置卡及适配器、设置和连接事件订阅已接入。DOM 与编辑器测试覆盖暂存动作，真实 Host 浏览器已验证原子授权载荷、成功回执和刷新持久化；真实重连浏览器验收仍待完成。

<a id="model-experience"></a>
## 模型体验

### 浏览器呈现

#### 模型看到什么

`@deepseek-ai/dsh-qs-ui-settings-plugins` 不增加模型消息或工具定义。

#### Token 影响

不增加提示词 token。

#### KV 缓存影响

设置行不构造模型请求。

## 已知限制与未完成项

<a id="known-limitations-and-deferred-work"></a>

- Shell 和 AgentLoop 数值卡在本地暂存编辑，并携带最初编辑版本一次保存全部修改字段。冲突保留草稿，采用当前版本必须由用户明确操作。重置会移除用户覆盖。子代理授权卡已接入，WebSearch 配置卡已接入，真实 Host 保存和仅凭据重试已通过浏览器验证。清单归独立插件所有。真实 Host 浏览器已验证数值保存和刷新持久化，完整配置验收仍待完成。

### 开发备注

页面状态保留在对应贡献内，导航不得复制设置镜像或凭据存储。
