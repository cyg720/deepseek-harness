# 第一优先七插件框架

## 概述

奇术工作台由 packages/qs 下七个独立工作区包组成，qs 目录仅作为包分组，不创建第八个包。当前七包已包含页面、状态、槽位贡献和测试，不能再按空框架理解。包的配置、接口和限制以各包 README 为准；本页说明整体组织与接入关系，不作为全部需求已验收的证明。

## 七包职责

| 包 | 当前职责 |
| --- | --- |
| [qs-shell](qs-shell/README.zh.md) | 外壳、顶层槽位、样式令牌、连接状态、提示宿主及开发者界面切换 |
| [qs-login](qs-login/README.zh.md) | 静态演示登录页与本地登录状态，不接入真实登录接口 |
| [qs-sessions](qs-sessions/README.zh.md) | 会话列表、切换、菜单操作及本地置顶 |
| [qs-composer](qs-composer/README.zh.md) | 草稿、首次发送交接、官方输入机提交与队列操作 |
| [qs-transcript](qs-transcript/README.zh.md) | 历史和流式消息呈现、内部节点过滤、过程披露及滚动跟随 |
| [qs-approval](qs-approval/README.zh.md) | 审批请求呈现、详情展示与官方审批动作调用 |
| [qs-questions](qs-questions/README.zh.md) | 单选、多选、自定义回答和方案审阅呈现与提交 |

## 入口与状态归属

每包包含 package.json、tsconfig.json、tsdown.config.ts、README 中英配对、Host 与 Client 入口及真实测试。七个 Client 入口均有实际插件行为；qs-shell 的 Host 入口负责解析界面配置并注入浏览器，其余六包保留无宿主行为的 apply 入口，以满足现有包导出和构建接入。

外壳声明顶层 qs 槽，其余视图通过槽位注入接入；审批与提问依赖官方请求及回答服务。会话权威数据、发送与队列由官方服务持有，二开包不维护另一套会话日志或代理循环。跨包类型、槽位及服务连接与样式共享规则见 [qs-shell 实现说明](qs-shell/README.zh.md#understand-the-implementation)。

无当前会话时，输入草稿由 [qs-composer 客户端入口](qs-composer/src/client/index.ts) 的本地快照管理；有会话后由官方输入机管理。首次发送由 Composer 持有创建操作并执行交接，不依赖额外的草稿 store。

## 工程接入

七包使用 ESM、Cordis peer/dev 依赖、官方 clientBundle 和客户端 TypeScript 基础配置；根源码路径映射和 Client 聚合纳入七包。每包的 CSS 模块声明参与类型检查，测试目录包含实际用例，不需要空目录占位文件。

当前 [Web 装配](../bundle/web-app/cordis.patch.yml) 注册七个 QS 插件，[装配依赖](../bundle/web-app/package.json) 声明七包解析依赖。官方 UI 插件仍保留。初始界面与开发者切换入口由 qs-shell 配置决定，具体配置语义见 [qs-shell 使用说明](qs-shell/README.zh.md#use-this-package)。独立 QS bundle/profile 尚不是当前接入方式。

## 验证与支持范围

七包已有单元和 DOM 测试，浏览器组合场景位于 apps/web/tests/qs。测试验证与产品验收分开记录：不能把有测试、构建通过或页面能打开等同于所有第一优先需求均已完成。

静态登录不能替代后端认证；非文本历史和部分媒体能力仍有明确限制，具体范围见 [qs-transcript 限制说明](qs-transcript/README.zh.md#known-limitations-and-deferred-work)。官方功能升级仍需同步上游并验证兼容性。

已执行的修复、覆盖率、浏览器及性能证据分别见 [整体复核](../../qishu/PRD/1-AI工作台/复核测试/02-复核修复与全量验证.md)、[六项修复与验证](../../qishu/PRD/1-AI工作台/复核测试/09-六项修复与验证.md) 和 [安全还原评估与验证](../../qishu/PRD/1-AI工作台/复核测试/14-安全还原评估与验证.md)。这些报告有各自的执行范围与未通过事项，不能合并为一次全量验收。

## 开发备注

需求与后续验收以 [第一优先计划](../../qishu/dev-components/第一优先开发计划评审/00-评审总纲.md) 为准。框架阶段曾发现的构建残留及工作区约束问题保留在整体复核报告中；历史空入口检查不是当前七包实现状态。
