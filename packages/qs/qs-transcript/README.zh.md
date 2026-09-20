---
description: "奇术工作台转写：按 kind 的行订阅、交互卡片链宿主与历史分页。"
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-transcript

[English](README.md) | 中文

## 概述

在工作台阅读用户消息、助手输出和待处理交互卡。助手正文复用官方 Markdown 渲染器，支持代码块与安全链接；无法识别的记录仍可查看。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用本包

在 [Web 组合](../../bundle/web-app/cordis.patch.yml) 中与其他奇术插件行一起挂载 `@deepseek-ai/dsh-qs-transcript`。本包没有部署配置字段。

系统提示、参考上下文、思考过程与未知扩展负载默认折叠，展开后使用限制高度、自动换行的文本面板。已关闭轮次的过程行显示已记录的活动数量；尾部显示完成状态及可用的精确 Token 总量，不重复回复正文。这些折叠只影响呈现，不会从模型请求中删除上下文。未知负载只在展开时序列化，收起时释放格式化展示文本。

主动发送消息或追加说明会恢复跟随。被动输出与历史前插保留用户上滚后的阅读位置。程序滚动立即生效，其延迟事件不会因内容增长而取消跟随。

历史加载与失败具有可见状态；重试会重新连接官方传输。每个 Session 绑定在内存中保留跨界面切换的阅读位置。加载更早历史会保持可见行锚点。整条复制包含用户文本或助手正文，不包含思考内容。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节</summary>

每行订阅按键索引的聊天节点源，历史分页读取会话快照。尺寸观察覆盖正文和交互卡。持久化记录由官方对话投影持有，因此本视图包不发布运行时 invariant 伴随入口。

</details>

官方服务持有会话权威数据，本包仅呈现这些数据，因此不发布运行时 invariant 伴随入口。

<a id="model-experience"></a>
## 模型体验

### 浏览器呈现

#### 模型可见内容

`@deepseek-ai/dsh-qs-transcript`：无；浏览器视图将用户动作委托给官方服务，不构造模型请求。

#### Token 影响

本包不添加自有提示词或工具 schema；用户提交内容由官方服务处理。

#### KV 缓存影响

无；两个入口均不组装或发送提供方请求。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 工具专属视图使用通用负载兜底。图片块与其他非文本历史显示明确限制提示，原始记录保持完整。Markdown 支持 HTTP(S) 图片，以及通过官方鉴权文件 API 读取 POSIX/Windows 绝对路径图片；本包未实现相对路径、附件画廊和正文文件引用操作。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文</summary>

验证状态见[复核修复记录](../../../qishu/PRD/1-AI工作台/复核测试/02-复核修复与全量验证.md)。

</details>
