---
description: "奇术工作台外壳：root 占位、qs.* 槽声明、--qs-* 令牌契约与开发者界面切换。"
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-shell

[English](README.md) | 中文

## 概述

开发者得到奇术工作台外壳：`root` 槽的唯一占位者、全部顶层 `qs.*` 槽的声明方、其余奇术包据以取色的 `--qs-*` 设计令牌与全局类名契约，以及工作台与官方界面之间的开发者切换。外壳以负优先级注册，从而遮蔽官方 `AppFrame`；停用七行 `qs-*` 即恢复原样的官方界面。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用本包

挂载名为 `@deepseek-ai/dsh-qs-shell` 的插件行。正常部署同时挂载另外六个 `qs-*` 行；本包单独不可用，因为登录门、会话导航、输入区、转写、审批与提问视图都由那些行提供。

对话滚动容器采用即时程序滚动，避免动画中间事件干扰流式内容的持续跟随。

行配置决定首屏：

```yaml
- id: qs-shell
  name: '@deepseek-ai/dsh-qs-shell'
  config:
    defaultUi: workbench      # workbench | official
    showOfficialUiEntry: false
```

`defaultUi: official` 保持七行加载但不注册工作台 root，官方界面无需重启即胜出。停用全部七行是另一条路径：它会释放全部工作台注册；把优先级改正数只是把渲染交还官方画面，工作台注册仍然留在账上。

里程碑状态见[第一优先计划](../../../qishu/dev-components/第一优先开发计划评审/00-评审总纲.md)，槽树见[槽位与状态设计](../../../qishu/dev-components/第一优先开发计划评审/06-槽位与状态设计.md)。

桌面侧栏支持指针拖拽与方向键调宽。侧栏宽度、显隐和辅助面板标签在刷新后保留；退出登录会重置这些布局偏好。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节</summary>

Host 半边（[src/index.ts](src/index.ts)）用 `Schema` 校验行配置，并把它作为索引页注入全局 `__QS_UI_CONFIG__` 交给浏览器。`dsh.client` 行的浏览器半边由客户端模块系统装载，读不到 Loader 行配置，因此索引页注入是唯一通路。

浏览器半边（[src/client/index.ts](src/client/index.ts)）以 `-1000` 优先级注册 `root`。`single` 槽拒绝同优先级的第二个条目，只在不同优先级间渲染优胜者，所以负优先级才是工作台胜出的原因。这一次注册声明 `qs.gate`、`qs.chrome`、`qs.nav`、`qs.stage`、`qs.inspector`、`qs.status`、`qs.overlay`；另一次 `qs.stage` 注册声明 `qs.stage.body`、`qs.stage.transcript`、`qs.composer`，使 `Stage` 组件成为它们的渲染宿主。其余六个包通过 `ctx.slots.inject` 等待这些声明，因此加载顺序不构成约束。

跨包共享只有两条通道。外观走 [styles/tokens.css](src/client/styles/tokens.css) 与 [styles/contract.css](src/client/styles/contract.css)：外壳把它们作为作用域限定在 `.qs-root` 的全局样式表注入；行为走槽或 Cordis 服务。bundle 纯净度门禁拒绝 `@deepseek-ai/dsh-qs-*` 之间的运行值导入，因此没有奇术包会 import 另一个包的组件。

`qsShell` 服务持有开发者切换控制器，其生命周期独立于工作台 root 注册：切到官方界面时释放工作台注册而保留控制器，返回时重新注册。官方侧返回入口是对官方 `sidebar.footer.action` 槽的贡献，不是往 `AppFrame` 里插 DOM。

`useQsAuth` 按可选座席读取而不是写进 `inject`：必需服务缺失会让 fiber 永久等待，而一个永久等待的外壳永远走不到"登录组件未加载"故障页。

</details>

官方服务持有会话权威数据，本包仅呈现这些数据，因此不发布运行时 invariant 伴随入口。

<a id="model-experience"></a>
## 模型体验

### 浏览器呈现

#### 模型可见内容

`@deepseek-ai/dsh-qs-shell`：无，因为外壳只注册槽、全局样式与查看状态控制器，不贡献提示词片段、工具 schema 或会话事件。

#### Token 影响

本包不添加自有提示词或工具 schema；用户提交内容由官方服务处理。

#### KV 缓存影响

无；外壳从不组装或发送提供方请求。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 右栏是带空态的骨架，刻意不展示 mock 业务数据。
- 状态条报告连接态并提供手动重连，但**不**做离线排队：断连时的发送由输入区拒绝，不缓冲。
- toast 宿主只有一个 API（`qsToast.show`）。弹窗不走它——原生 `<dialog>.showModal()` 自己进顶层图层。
- 开发者切换能抵达官方界面，但除布局 store 与输入区的未归属草稿外，尚未保证每个工作台专有 store 都能往返保持。
- 可访问名、焦点恢复与 200% 缩放检查尚未执行。
- 视觉还原按令牌与布局尺寸核对，尚未做截图比对。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文</summary>

本包所需的官方文件接入登记在[官方源码改动记录清单](../../../qishu/官方源码改动记录清单/00-登记规则与索引.md)；改动清单是"改了什么、还有什么未验证"的权威来源。

</details>
